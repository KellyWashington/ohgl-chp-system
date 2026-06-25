-- Phase 1 RBAC migration.
-- Normalizes legacy clinician/viewer roles to the new enterprise permission model without changing stored enum values.

create or replace function normalized_user_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select case current_user_role()::text
    when 'clinician' then 'facility_officer'
    when 'viewer' then 'chp'
    else current_user_role()::text
  end
$$;

create or replace function role_permissions(p_role text)
returns text[]
language sql
stable
immutable
as $$
  select case p_role
    when 'super_admin' then array['*']::text[]
    when 'facility_admin' then array['facility:manage','facility:read','patient:read','patient:write','referral:create','referral:read','referral:update','referral:delete','chp:read','chp:create','chp:update','chp:delete','report:read','group:read','audit:read']::text[]
    when 'facility_officer' then array['facility:read','patient:read','referral:create','referral:read','referral:update','report:read']::text[]
    when 'clinician' then array['facility:read','patient:read','referral:create','referral:read','referral:update','report:read']::text[]
    when 'chp' then array['facility:read','referral:create','referral:read_own']::text[]
    when 'viewer' then array['facility:read','referral:create','referral:read_own']::text[]
    else array[]::text[]
  end
$$;

create or replace function has_permission(required text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare perms text[];
begin
  perms := public.role_permissions(public.normalized_user_role());
  if perms is null then
    return false;
  end if;
  return '*' = any(perms) or required = any(perms) or exists (select 1 from unnest(perms) as p where right(p, 2) = ':*' and required like left(p, length(p) - 1) || '%');
end; $$;

create or replace function is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.normalized_user_role() = 'super_admin'
$$;

create or replace function same_facility(fid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or fid = public.current_user_facility()
$$;

alter table public.users alter column role set default 'chp';

alter table facilities enable row level security;
alter table users enable row level security;
alter table patients enable row level security;
alter table chp_directory enable row level security;
alter table referrals enable row level security;
alter table appointments enable row level security;
alter table audit_logs enable row level security;

drop policy if exists facilities_select on facilities;
drop policy if exists facilities_admin_write on facilities;
create policy facilities_select on facilities for select using (same_facility(id) and has_permission('facility:read'));
create policy facilities_admin_write on facilities for all using (has_permission('facility:manage')) with check (has_permission('facility:manage'));

drop policy if exists users_select on users;
drop policy if exists users_admin_write on users;
create policy users_select on users for select using (is_super_admin() or id = auth.uid());
create policy users_admin_write on users for all using (has_permission('user:manage')) with check (has_permission('user:manage'));

drop policy if exists patients_select on patients;
drop policy if exists patients_write on patients;
create policy patients_select on patients for select using (same_facility(facility_id) and has_permission('patient:read'));
create policy patients_write on patients for all using (same_facility(facility_id) and has_permission('patient:write')) with check (same_facility(facility_id) and has_permission('patient:write'));

drop policy if exists chp_select on chp_directory;
drop policy if exists chp_write on chp_directory;
create policy chp_select on chp_directory for select using (same_facility(facility_id) and (has_permission('chp:read') or has_permission('facility:manage')));
create policy chp_write on chp_directory for all using (same_facility(facility_id) and has_permission('chp:create')) with check (same_facility(facility_id) and has_permission('chp:create'));

drop policy if exists referrals_select on referrals;
drop policy if exists referrals_insert on referrals;
drop policy if exists referrals_update on referrals;
drop policy if exists referrals_delete on referrals;
create policy referrals_select on referrals for select using (same_facility(facility_id) and (has_permission('referral:read') or (has_permission('referral:read_own') and (created_by = auth.uid() or chp_id in (select id from chp_directory where user_id = auth.uid())))));
create policy referrals_insert on referrals for insert with check (same_facility(facility_id) and has_permission('referral:create'));
create policy referrals_update on referrals for update using (same_facility(facility_id) and has_permission('referral:update')) with check (same_facility(facility_id) and has_permission('referral:update'));
create policy referrals_delete on referrals for delete using (same_facility(facility_id) and has_permission('referral:delete'));

drop policy if exists appt_select on appointments;
drop policy if exists appt_write on appointments;
create policy appt_select on appointments for select using (same_facility(facility_id) and has_permission('patient:read'));
create policy appt_write on appointments for all using (same_facility(facility_id) and has_permission('patient:write')) with check (same_facility(facility_id) and has_permission('patient:write'));

drop policy if exists audit_insert on audit_logs;
drop policy if exists audit_select on audit_logs;
create policy audit_insert on audit_logs for insert with check (actor_id = auth.uid());
create policy audit_select on audit_logs for select using (same_facility(facility_id) and has_permission('audit:read'));
