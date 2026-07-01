-- Sprint 2 referral workflow redesign.
-- Adds CHP -> Facility Officer -> Completion workflow support without changing reporting/dashboard/audit modules.

alter type app_role add value if not exists 'facility_officer';

do $$ begin
  create type referral_workflow_status as enum ('Submitted','Under Review','Received','In Consultation','Admitted','Completed','Closed','Cancelled');
exception when duplicate_object then null;
end $$;

create sequence if not exists referral_number_seq start 1;

alter table patients add column if not exists county text;
alter table patients add column if not exists subcounty text;
alter table patients add column if not exists village text;
alter table patients add column if not exists national_id_normalized text generated always as (nullif(regexp_replace(coalesce(national_id, ''), '\D', '', 'g'), '')) stored;

alter table referrals add column if not exists national_id text;
alter table referrals add column if not exists phone text;
alter table referrals add column if not exists county text;
alter table referrals add column if not exists subcounty text;
alter table referrals add column if not exists village text;
alter table referrals add column if not exists referral_reason text;
alter table referrals add column if not exists referral_facility_id uuid references facilities(id) on delete restrict;
alter table referrals add column if not exists referral_facility_name text;
alter table referrals add column if not exists department text;
alter table referrals add column if not exists workflow_status referral_workflow_status not null default 'Submitted';
alter table referrals add column if not exists national_id_normalized text generated always as (nullif(regexp_replace(coalesce(national_id, ''), '\D', '', 'g'), '')) stored;

create table if not exists referral_status_events (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references referrals(id) on delete cascade,
  status referral_workflow_status not null,
  responsible_user_id uuid references users(id) on delete set null,
  responsible_user_name text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_patients_facility_national_id_unique
  on patients(facility_id, national_id_normalized)
  where national_id_normalized is not null;

create unique index if not exists idx_referrals_active_national_id_unique
  on referrals(facility_id, national_id_normalized)
  where national_id_normalized is not null
    and workflow_status not in ('Completed','Closed','Cancelled');

create index if not exists idx_referral_events_referral_created on referral_status_events(referral_id, created_at);
create index if not exists idx_referrals_workflow_status on referrals(facility_id, workflow_status, created_at desc);

create or replace function next_referral_number()
returns text
language sql
security definer
set search_path = public
as $$
  select 'OHGL-' || extract(year from now())::int || '-' || lpad(nextval('referral_number_seq')::text, 6, '0')
$$;

create or replace function create_referral_secure(payload jsonb)
returns referrals
language plpgsql
security definer
set search_path = public
as $$
declare
  rec referrals;
  patient_rec patients;
  fid uuid := coalesce((payload->>'referral_facility_id')::uuid, (payload->>'facility_id')::uuid, public.current_user_facility());
  nid text := nullif(regexp_replace(coalesce(payload->>'national_id', ''), '\D', '', 'g'), '');
  slip text := coalesce(nullif(payload->>'slip_no', ''), public.next_referral_number());
  actor_name text;
begin
  if not public.has_permission('referral:create') then
    raise exception 'You do not have permission to create referrals.';
  end if;
  if fid is null or not public.same_facility(fid) then
    raise exception 'Referral facility is not available to this user.';
  end if;
  if nid is null or length(nid) < 6 or length(nid) > 12 then
    raise exception 'National ID must be 6 to 12 digits.';
  end if;
  if exists (
    select 1 from referrals
    where facility_id = fid
      and national_id_normalized = nid
      and workflow_status not in ('Completed','Closed','Cancelled')
  ) then
    raise exception 'This National ID already has an active referral.';
  end if;

  insert into patients(facility_id, full_name, national_id, phone, sex, county, subcounty, village, created_by)
  values (
    fid,
    payload->>'patient_name',
    nid,
    payload->>'phone',
    nullif(payload->>'sex', ''),
    payload->>'county',
    payload->>'subcounty',
    payload->>'village',
    auth.uid()
  )
  on conflict (facility_id, national_id_normalized) where national_id_normalized is not null do update set
    full_name = excluded.full_name,
    phone = excluded.phone,
    sex = excluded.sex,
    county = excluded.county,
    subcounty = excluded.subcounty,
    village = excluded.village,
    updated_at = now()
  returning * into patient_rec;

  insert into referrals(
    facility_id, patient_id, slip_no, referral_date, patient_name_ciphertext, national_id, phone,
    age, sex, county, subcounty, village, category, priority, presenting_concern_ciphertext,
    referral_reason, clinical_notes_ciphertext, referral_facility_id, referral_facility_name,
    department, workflow_status, opd_status, created_by
  ) values (
    fid, patient_rec.id, slip, coalesce((payload->>'referral_date')::date, current_date),
    pgp_sym_encrypt(coalesce(payload->>'patient_name', ''), current_setting('app.encryption_key', true)), nid, payload->>'phone',
    nullif(payload->>'age', '')::int, nullif(payload->>'sex', ''), payload->>'county', payload->>'subcounty', payload->>'village',
    coalesce(array[payload->>'department'], '{}'), 'Routine',
    pgp_sym_encrypt(coalesce(payload->>'presenting_concern', ''), current_setting('app.encryption_key', true)),
    payload->>'referral_reason',
    pgp_sym_encrypt(coalesce(payload->>'clinical_notes', ''), current_setting('app.encryption_key', true)),
    fid, payload->>'referral_facility_name', payload->>'department', 'Submitted', 'Pending', auth.uid()
  ) returning * into rec;

  select full_name into actor_name from users where id = auth.uid();
  insert into referral_status_events(referral_id, status, responsible_user_id, responsible_user_name)
  values (rec.id, 'Submitted', auth.uid(), actor_name);

  return rec;
end; $$;

create or replace function update_referral_secure(p_referral_id uuid, p_field text, p_value text)
returns referrals
language plpgsql
security definer
set search_path = public
as $$
declare
  rec referrals;
  actor_name text;
  next_status referral_workflow_status;
begin
  if not public.has_permission('referral:update') then
    raise exception 'Only Facility Officers can update referrals.';
  end if;

  select * into rec from referrals where id = p_referral_id and public.same_facility(facility_id);
  if rec.id is null then
    raise exception 'Referral not found.';
  end if;

  if p_field = 'workflow_status' then
    next_status := p_value::referral_workflow_status;
    update referrals set workflow_status = next_status, updated_by = auth.uid(), updated_at = now() where id = p_referral_id returning * into rec;
    select full_name into actor_name from users where id = auth.uid();
    insert into referral_status_events(referral_id, status, responsible_user_id, responsible_user_name)
    values (p_referral_id, next_status, auth.uid(), actor_name);
  elsif p_field = 'received_by' then
    update referrals set received_by = p_value, updated_by = auth.uid(), updated_at = now() where id = p_referral_id returning * into rec;
  elsif p_field = 'file_no' then
    update referrals set file_no = p_value, updated_by = auth.uid(), updated_at = now() where id = p_referral_id returning * into rec;
  elsif p_field = 'sha_no' then
    update referrals set sha_no_ciphertext = pgp_sym_encrypt(coalesce(p_value, ''), current_setting('app.encryption_key', true)), updated_by = auth.uid(), updated_at = now() where id = p_referral_id returning * into rec;
  elsif p_field = 'clinical_notes' or p_field = 'notes' then
    update referrals set clinical_notes_ciphertext = pgp_sym_encrypt(coalesce(p_value, ''), current_setting('app.encryption_key', true)), updated_by = auth.uid(), updated_at = now() where id = p_referral_id returning * into rec;
  else
    raise exception 'Field % cannot be updated through referral workflow.', p_field;
  end if;
  return rec;
end; $$;

create or replace view referrals_secure with (security_invoker = true) as
select
  r.id,
  r.facility_id,
  r.patient_id,
  r.chp_id,
  r.slip_no,
  r.referral_date,
  r.chp_code,
  r.chp_unit,
  pgp_sym_decrypt(r.patient_name_ciphertext, current_setting('app.encryption_key', true)) as patient_name,
  r.national_id,
  r.phone,
  r.age,
  r.sex,
  r.county,
  r.subcounty,
  r.village,
  r.category,
  r.priority,
  r.sha_registered,
  pgp_sym_decrypt(r.presenting_concern_ciphertext, current_setting('app.encryption_key', true)) as presenting_concern,
  r.referral_reason,
  pgp_sym_decrypt(r.clinical_notes_ciphertext, current_setting('app.encryption_key', true)) as clinical_notes,
  r.referral_facility_id,
  r.referral_facility_name,
  r.department,
  r.workflow_status,
  r.opd_status,
  r.received_by,
  r.file_no,
  pgp_sym_decrypt(r.sha_no_ciphertext, current_setting('app.encryption_key', true)) as sha_no,
  r.created_by,
  creator.full_name as created_by_name,
  r.updated_by,
  updater.full_name as updated_by_name,
  r.created_at,
  r.updated_at,
  coalesce((
    select jsonb_agg(jsonb_build_object('status', e.status, 'at', e.created_at, 'by', coalesce(e.responsible_user_name, u.full_name)) order by e.created_at)
    from referral_status_events e
    left join users u on u.id = e.responsible_user_id
    where e.referral_id = r.id
  ), '[]'::jsonb) as timeline
from referrals r
left join users creator on creator.id = r.created_by
left join users updater on updater.id = r.updated_by
where public.same_facility(r.facility_id)
  and (public.has_permission('referral:read') or (public.has_permission('referral:read_own') and r.created_by = auth.uid()));

grant select on referrals_secure to authenticated;
grant select, insert on referral_status_events to authenticated;
grant execute on function next_referral_number() to authenticated;
grant execute on function create_referral_secure(jsonb) to authenticated;
grant execute on function update_referral_secure(uuid, text, text) to authenticated;
