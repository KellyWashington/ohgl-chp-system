-- Sprint 3 Database Migrations
-- Implements Notifications Table, restricts Audit Log access to Super Admin,
-- and automates IP/UserAgent tracking and notification generation.

-- 1. Create Notifications Table
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid references facilities(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  title text not null,
  message text not null,
  type text not null,
  read boolean not null default false,
  resource_id text,
  created_at timestamptz not null default now()
);

-- Enable RLS on notifications
alter table notifications enable row level security;

-- Drop existing policies if any
drop policy if exists notifications_select on notifications;
drop policy if exists notifications_update on notifications;
drop policy if exists notifications_insert on notifications;

-- RLS Policies for Notifications
create policy notifications_select on notifications
  for select using (user_id = auth.uid() or (facility_id = public.current_user_facility() and user_id is null));

create policy notifications_update on notifications
  for update using (user_id = auth.uid() or (facility_id = public.current_user_facility() and user_id is null))
  with check (user_id = auth.uid() or (facility_id = public.current_user_facility() and user_id is null));

create policy notifications_insert on notifications
  for insert with check (true);

-- Grant privileges
grant select, update, insert on notifications to authenticated;


-- 2. Restrict Audit Logs access strictly to Super Admin only
drop policy if exists audit_select on audit_logs;

create policy audit_select on audit_logs
  for select using (public.is_super_admin());

-- Redefine role_permissions to remove audit:read from facility_admin
create or replace function role_permissions(p_role text)
returns text[]
language sql
stable
immutable
as $$
  select case p_role
    when 'super_admin' then array['*']::text[]
    when 'facility_admin' then array['facility:manage','facility:read','patient:read','patient:write','referral:create','referral:read','referral:update','referral:delete','chp:read','chp:create','chp:update','chp:delete','report:read','group:read']::text[]
    when 'facility_officer' then array['facility:read','patient:read','referral:create','referral:read','referral:update','report:read']::text[]
    when 'clinician' then array['facility:read','patient:read','referral:create','referral:read','referral:update','report:read']::text[]
    when 'chp' then array['facility:read','referral:create','referral:read_own']::text[]
    when 'viewer' then array['facility:read','referral:create','referral:read_own']::text[]
    else array[]::text[]
  end
$$;


-- 3. Dynamic IP Address & User Agent capture trigger on insert
create or replace function populate_audit_metadata()
returns trigger
language plpgsql
security definer
as $$
declare
  headers text;
  ua text;
  ip text;
begin
  headers := current_setting('request.headers', true);
  if headers is not null and headers <> '' then
    ua := headers::json->>'user-agent';
    ip := headers::json->>'x-forwarded-for';
    if ip is not null then
      -- Split by comma in case of multiple proxies (e.g. Cloudflare, Vercel)
      ip := split_part(ip, ',', 1);
      new.ip_address := ip::inet;
    end if;
    if ua is not null then
      new.user_agent := ua;
    end if;
  end if;
  return new;
exception when others then
  return new;
end; $$;

drop trigger if exists trg_populate_audit_metadata on audit_logs;
create trigger trg_populate_audit_metadata
before insert on audit_logs
for each row execute function populate_audit_metadata();


-- 4. Enable auditing for the users table
drop trigger if exists audit_users_changes on users;
create trigger audit_users_changes
after insert or update or delete on users
for each row execute function audit_row_change();


-- 5. Trigger for User Creation & Suspension notifications
create or replace function notify_user_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_rec record;
begin
  if (tg_op = 'INSERT') then
    -- Notify all super admins
    for admin_rec in select id from users where role = 'super_admin' and active = true loop
      insert into notifications (facility_id, user_id, title, message, type, resource_id)
      values (null, admin_rec.id, 'User Created', 'A new user profile for ' || new.full_name || ' (' || new.email || ') has been created.', 'user_created', new.id::text);
    end loop;

    -- Notify facility admins of the user's facility
    if new.facility_id is not null then
      for admin_rec in select id from users where facility_id = new.facility_id and role = 'facility_admin' and active = true loop
        insert into notifications (facility_id, user_id, title, message, type, resource_id)
        values (new.facility_id, admin_rec.id, 'User Created', 'A new user profile for ' || new.full_name || ' (' || new.email || ') has been created for your facility.', 'user_created', new.id::text);
      end loop;
    end if;

  elsif (tg_op = 'UPDATE') then
    -- Check if suspended (active changed from true to false)
    if old.active = true and new.active = false then
      -- Notify all super admins
      for admin_rec in select id from users where role = 'super_admin' and active = true loop
        insert into notifications (facility_id, user_id, title, message, type, resource_id)
        values (null, admin_rec.id, 'User Suspended', 'The user account for ' || new.full_name || ' (' || new.email || ') has been suspended.', 'user_suspended', new.id::text);
      end loop;

      -- Notify facility admins of the user's facility
      if new.facility_id is not null then
        for admin_rec in select id from users where facility_id = new.facility_id and role = 'facility_admin' and active = true loop
          insert into notifications (facility_id, user_id, title, message, type, resource_id)
          values (new.facility_id, admin_rec.id, 'User Suspended', 'The user account for ' || new.full_name || ' (' || new.email || ') has been suspended.', 'user_suspended', new.id::text);
        end loop;
      end if;
    end if;
  end if;

  return new;
end; $$;

drop trigger if exists trg_notify_user_changes on users;
create trigger trg_notify_user_changes
after insert or update on users
for each row execute function notify_user_changes();


-- 6. Trigger for Referral status changes notifications
create or replace function notify_referral_status_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ref_rec record;
  pat_name text;
  recipient_rec record;
  notif_title text;
  notif_msg text;
  notif_type text;
begin
  -- Fetch referral details
  select * into ref_rec from referrals where id = new.referral_id;
  if ref_rec.id is null then
    return new;
  end if;

  -- Decrypt patient name safely
  begin
    pat_name := pgp_sym_decrypt(ref_rec.patient_name_ciphertext, current_setting('app.encryption_key', true));
  exception when others then
    pat_name := 'Patient';
  end;

  -- Map status to notification type, title, and message
  case new.status::text
    when 'Submitted' then
      notif_type := 'referral_submitted';
      notif_title := 'Referral Submitted';
      notif_msg := 'New referral ' || ref_rec.slip_no || ' for ' || pat_name || ' has been submitted.';
    when 'Under Review' then
      notif_type := 'referral_approved';
      notif_title := 'Referral Approved';
      notif_msg := 'Referral ' || ref_rec.slip_no || ' for ' || pat_name || ' has been approved for review.';
    when 'Received' then
      notif_type := 'referral_received';
      notif_title := 'Referral Received';
      notif_msg := 'Referral ' || ref_rec.slip_no || ' for ' || pat_name || ' has been received at the facility.';
    when 'Completed' then
      notif_type := 'referral_completed';
      notif_title := 'Referral Completed';
      notif_msg := 'Referral ' || ref_rec.slip_no || ' for ' || pat_name || ' has been completed.';
    when 'Cancelled' then
      notif_type := 'referral_rejected';
      notif_title := 'Referral Rejected';
      notif_msg := 'Referral ' || ref_rec.slip_no || ' for ' || pat_name || ' was cancelled.';
    when 'Closed' then
      notif_type := 'referral_rejected';
      notif_title := 'Referral Rejected';
      notif_msg := 'Referral ' || ref_rec.slip_no || ' for ' || pat_name || ' was closed.';
    else
      return new;
  end case;

  -- Notify the CHP who created the referral (if they are not the actor who updated it)
  if ref_rec.created_by is not null and ref_rec.created_by != coalesce(new.responsible_user_id, '00000000-0000-0000-0000-000000000000'::uuid) then
    insert into notifications (facility_id, user_id, title, message, type, resource_id)
    values (ref_rec.facility_id, ref_rec.created_by, notif_title, notif_msg, notif_type, ref_rec.id::text);
  end if;

  -- Notify facility officers and facility administrators at the destination facility
  for recipient_rec in 
    select id from users 
    where facility_id = ref_rec.facility_id 
      and role in ('facility_officer', 'facility_admin') 
      and active = true
      and id != coalesce(new.responsible_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
  loop
    insert into notifications (facility_id, user_id, title, message, type, resource_id)
    values (ref_rec.facility_id, recipient_rec.id, notif_title, notif_msg, notif_type, ref_rec.id::text);
  end loop;

  -- Also notify all super admins
  for recipient_rec in 
    select id from users 
    where role = 'super_admin' 
      and active = true
      and id != coalesce(new.responsible_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
  loop
    insert into notifications (facility_id, user_id, title, message, type, resource_id)
    values (null, recipient_rec.id, notif_title, notif_msg, notif_type, ref_rec.id::text);
  end loop;

  return new;
end; $$;

drop trigger if exists trg_notify_referral_status_changes on referral_status_events;
create trigger trg_notify_referral_status_changes
after insert on referral_status_events
for each row execute function notify_referral_status_changes();
