-- OHGL CHP Production Schema for Supabase/PostgreSQL
-- Apply in Supabase SQL editor as a project owner. Supabase provides TLS in transit.

create extension if not exists pgcrypto;
create extension if not exists citext;

create type app_role as enum ('super_admin','facility_admin','clinician','chp','viewer');
create type referral_priority as enum ('Routine','Urgent','Emergency');
create type opd_status as enum ('Pending','Attended','DNA');
create type consent_status as enum ('granted','withdrawn','not_required','unknown');

create table facilities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text not null,
  subcounty text,
  level text not null check (level in ('Level 2','Level 3','Level 4','Level 5','Level 6')),
  email citext,
  phone text,
  token_rate numeric(10,2) not null default 200,
  financial_year int not null default extract(year from now()),
  compiler text,
  coic text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  facility_id uuid references facilities(id) on delete set null,
  role app_role not null default 'viewer',
  full_name text not null,
  email citext not null unique,
  phone text,
  active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

create table patients (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references facilities(id) on delete restrict,
  full_name text not null,
  national_id text,
  sha_number text,
  phone text,
  sex text check (sex in ('M','F','Other') or sex is null),
  date_of_birth date,
  consent_status consent_status not null default 'unknown',
  consent_recorded_at timestamptz,
  consent_recorded_by uuid references users(id),
  retention_until date not null default (current_date + interval '7 years'),
  deletion_requested_at timestamptz,
  export_requested_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table chp_directory (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references facilities(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  code text not null,
  full_name_ciphertext bytea not null,
  national_id_ciphertext bytea,
  phone_ciphertext bytea,
  village text,
  community_unit text,
  sha_trained boolean not null default false,
  jumuisha_enrolled boolean not null default false,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(facility_id, code)
);

create table referrals (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references facilities(id) on delete restrict,
  patient_id uuid references patients(id) on delete set null,
  chp_id uuid references chp_directory(id) on delete set null,
  slip_no text not null unique,
  referral_date date not null,
  chp_code text,
  chp_unit text,
  patient_name_ciphertext bytea not null,
  age int check (age between 0 and 120 or age is null),
  sex text check (sex in ('M','F','Other') or sex is null),
  category text[] not null default '{}',
  priority referral_priority not null,
  sha_registered boolean not null default false,
  presenting_concern_ciphertext bytea,
  clinical_notes_ciphertext bytea,
  opd_status opd_status not null default 'Pending',
  received_by text,
  file_no text,
  sha_no_ciphertext bytea,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references facilities(id) on delete cascade,
  patient_id uuid references patients(id) on delete set null,
  referral_id uuid references referrals(id) on delete set null,
  scheduled_at timestamptz not null,
  status text not null default 'scheduled',
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);


create table audit_logs (
  id bigserial primary key,
  facility_id uuid references facilities(id) on delete set null,
  actor_id uuid references users(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id text,
  ip_address inet,
  user_agent text,
  changes jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index idx_users_facility_role on users(facility_id, role);
create index idx_patients_facility_name on patients(facility_id, lower(full_name));
create index idx_patients_national_id on patients(national_id) where national_id is not null;
create index idx_referrals_facility_date on referrals(facility_id, referral_date desc);
create index idx_referrals_status_priority on referrals(opd_status, priority);
create index idx_referrals_patient on referrals(patient_id);
create index idx_chp_facility_code on chp_directory(facility_id, code);
create index idx_audit_facility_created on audit_logs(facility_id, created_at desc);

create or replace function current_user_role()
returns app_role
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  return (select role from public.users where id = auth.uid() and active = true);
end; $$;

create or replace function current_user_facility()
returns uuid
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  return (select facility_id from public.users where id = auth.uid() and active = true);
end; $$;

create or replace function is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_user_role() = 'super_admin'
$$;
create or replace function same_facility(fid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or fid = public.current_user_facility()
$$;

create or replace view dashboard_metrics with (security_invoker = true) as
select facility_id, date_trunc('month', referral_date)::date as month,
  count(*) as total_referrals,
  count(*) filter (where opd_status='Attended') as attended,
  count(*) filter (where opd_status='Pending') as pending,
  count(*) filter (where priority='Emergency') as emergencies,
  count(*) filter (where sha_registered) as sha_registered
from referrals
where same_facility(facility_id)
group by facility_id, date_trunc('month', referral_date);
alter table facilities enable row level security;
alter table users enable row level security;
alter table patients enable row level security;
alter table chp_directory enable row level security;
alter table referrals enable row level security;
alter table appointments enable row level security;
alter table audit_logs enable row level security;

create policy facilities_select on facilities for select using (same_facility(id));
create policy facilities_admin_write on facilities for all using (current_user_role() in ('super_admin','facility_admin')) with check (current_user_role() in ('super_admin','facility_admin'));

create policy users_select on users for select using (is_super_admin() or facility_id = current_user_facility() or id = auth.uid());
create policy users_admin_write on users for all using (current_user_role() in ('super_admin','facility_admin')) with check (current_user_role() in ('super_admin','facility_admin'));

create policy patients_select on patients for select using (same_facility(facility_id) and current_user_role() in ('super_admin','facility_admin','clinician'));
create policy patients_write on patients for all using (same_facility(facility_id) and current_user_role() in ('super_admin','facility_admin','clinician')) with check (same_facility(facility_id) and current_user_role() in ('super_admin','facility_admin','clinician'));

create policy chp_select on chp_directory for select using (same_facility(facility_id));
create policy chp_write on chp_directory for all using (same_facility(facility_id) and current_user_role() in ('super_admin','facility_admin')) with check (same_facility(facility_id) and current_user_role() in ('super_admin','facility_admin'));

create policy referrals_select on referrals for select using (same_facility(facility_id));
create policy referrals_insert on referrals for insert with check (same_facility(facility_id) and current_user_role() in ('super_admin','facility_admin','clinician','chp'));
create policy referrals_update on referrals for update using (same_facility(facility_id) and current_user_role() in ('super_admin','facility_admin','clinician')) with check (same_facility(facility_id));
create policy referrals_delete on referrals for delete using (same_facility(facility_id) and current_user_role() in ('super_admin','facility_admin'));

create policy appt_select on appointments for select using (same_facility(facility_id));
create policy appt_write on appointments for all using (same_facility(facility_id) and current_user_role() in ('super_admin','facility_admin','clinician')) with check (same_facility(facility_id));

create policy audit_insert on audit_logs for insert with check (actor_id = auth.uid());
create policy audit_select on audit_logs for select using (same_facility(facility_id) and current_user_role() in ('super_admin','facility_admin'));

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger trg_facilities_updated before update on facilities for each row execute function touch_updated_at();
create trigger trg_patients_updated before update on patients for each row execute function touch_updated_at();
create trigger trg_chp_updated before update on chp_directory for each row execute function touch_updated_at();
create trigger trg_referrals_updated before update on referrals for each row execute function touch_updated_at();

-- Field-level PHI encryption helpers.
-- Production setup: set a 32+ byte secret outside source control, for example:
--   alter database postgres set app.phi_key = 'replace-with-random-secret-from-secret-manager';
create or replace function phi_key() returns text language plpgsql stable as $$
declare k text;
begin
  k := current_setting('app.phi_key', true);
  if k is null or length(k) < 32 then
    raise exception 'app.phi_key is not configured or is too short';
  end if;
  return k;
end; $$;

create or replace function phi_encrypt(value text) returns bytea language sql stable as $$
  select case when value is null or value = '' then null else pgp_sym_encrypt(value, phi_key(), 'cipher-algo=aes256,compress-algo=1') end
$$;

create or replace function phi_decrypt(value bytea) returns text language sql stable as $$
  select case when value is null then null else pgp_sym_decrypt(value, phi_key()) end
$$;

create or replace view chp_directory_secure with (security_invoker = true) as
select id, facility_id, user_id, code,
  phi_decrypt(full_name_ciphertext) as full_name,
  phi_decrypt(national_id_ciphertext) as national_id,
  phi_decrypt(phone_ciphertext) as phone,
  village, community_unit, sha_trained, jumuisha_enrolled, active, notes, created_at, updated_at
from chp_directory
where same_facility(facility_id);

create or replace view referrals_secure with (security_invoker = true) as
select id, facility_id, patient_id, chp_id, slip_no, referral_date, chp_code, chp_unit,
  phi_decrypt(patient_name_ciphertext) as patient_name,
  age, sex, category, priority, sha_registered,
  phi_decrypt(presenting_concern_ciphertext) as presenting_concern,
  phi_decrypt(clinical_notes_ciphertext) as clinical_notes,
  opd_status, received_by, file_no,
  phi_decrypt(sha_no_ciphertext) as sha_no,
  created_by, updated_by, created_at, updated_at
from referrals
where same_facility(facility_id);

create or replace function create_referral_secure(payload jsonb)
returns referrals_secure
language plpgsql
security invoker
as $$
declare rec referrals;
begin
  insert into referrals (
    facility_id, slip_no, referral_date, chp_code, chp_unit, patient_name_ciphertext,
    age, sex, category, priority, sha_registered, presenting_concern_ciphertext,
    clinical_notes_ciphertext, opd_status, received_by, file_no, sha_no_ciphertext, created_by
  ) values (
    (payload->>'facility_id')::uuid,
    payload->>'slip_no',
    (payload->>'referral_date')::date,
    payload->>'chp_code',
    payload->>'chp_unit',
    phi_encrypt(payload->>'patient_name'),
    nullif(payload->>'age','')::int,
    payload->>'sex',
    coalesce(array(select jsonb_array_elements_text(payload->'category')), '{}'),
    (payload->>'priority')::referral_priority,
    coalesce((payload->>'sha_registered')::boolean, false),
    phi_encrypt(payload->>'presenting_concern'),
    phi_encrypt(payload->>'clinical_notes'),
    coalesce((payload->>'opd_status')::opd_status, 'Pending'::opd_status),
    payload->>'received_by',
    payload->>'file_no',
    phi_encrypt(payload->>'sha_no'),
    auth.uid()
  ) returning * into rec;

  return (select r from referrals_secure r where r.id = rec.id);
end; $$;

create or replace function update_referral_secure(p_referral_id uuid, p_field text, p_value text)
returns referrals_secure
language plpgsql
security invoker
as $$
declare rec referrals;
begin
  if p_field = 'patient' then
    update referrals set patient_name_ciphertext = phi_encrypt(p_value), updated_by = auth.uid() where id = p_referral_id returning * into rec;
  elsif p_field = 'notes' then
    update referrals set clinical_notes_ciphertext = phi_encrypt(p_value), updated_by = auth.uid() where id = p_referral_id returning * into rec;
  elsif p_field = 'date' then
    update referrals set referral_date = p_value::date, updated_by = auth.uid() where id = p_referral_id returning * into rec;
  elsif p_field = 'age' then
    update referrals set age = nullif(p_value,'')::int, updated_by = auth.uid() where id = p_referral_id returning * into rec;
  elsif p_field = 'sex' then
    update referrals set sex = p_value, updated_by = auth.uid() where id = p_referral_id returning * into rec;
  elsif p_field = 'priority' then
    update referrals set priority = p_value::referral_priority, updated_by = auth.uid() where id = p_referral_id returning * into rec;
  elsif p_field = 'sha' then
    update referrals set sha_registered = (p_value = 'Yes'), updated_by = auth.uid() where id = p_referral_id returning * into rec;
  elsif p_field = 'opd_status' then
    update referrals set opd_status = p_value::opd_status, updated_by = auth.uid() where id = p_referral_id returning * into rec;
  else
    raise exception 'Unsupported secure referral field: %', p_field;
  end if;
  return (select r from referrals_secure r where r.id = rec.id);
end; $$;

create or replace function upsert_chp_secure(payload jsonb)
returns chp_directory_secure
language plpgsql
security invoker
as $$
declare rec chp_directory;
begin
  if payload ? 'id' and payload->>'id' is not null and payload->>'id' <> '' then
    update chp_directory set
      code = payload->>'code',
      full_name_ciphertext = phi_encrypt(payload->>'full_name'),
      national_id_ciphertext = phi_encrypt(payload->>'national_id'),
      phone_ciphertext = phi_encrypt(payload->>'phone'),
      village = payload->>'village',
      community_unit = payload->>'community_unit',
      sha_trained = coalesce((payload->>'sha_trained')::boolean, false),
      jumuisha_enrolled = coalesce((payload->>'jumuisha_enrolled')::boolean, false),
      active = coalesce((payload->>'active')::boolean, true),
      notes = payload->>'notes'
    where id = (payload->>'id')::uuid returning * into rec;
  else
    insert into chp_directory (facility_id, code, full_name_ciphertext, national_id_ciphertext, phone_ciphertext, village, community_unit, sha_trained, jumuisha_enrolled, active, notes)
    values ((payload->>'facility_id')::uuid, payload->>'code', phi_encrypt(payload->>'full_name'), phi_encrypt(payload->>'national_id'), phi_encrypt(payload->>'phone'), payload->>'village', payload->>'community_unit', coalesce((payload->>'sha_trained')::boolean, false), coalesce((payload->>'jumuisha_enrolled')::boolean, false), coalesce((payload->>'active')::boolean, true), payload->>'notes')
    returning * into rec;
  end if;
  return (select c from chp_directory_secure c where c.id = rec.id);
end; $$;


-- Data subject requests for access, export, correction, and deletion workflows.
create type dsr_type as enum ('access','export','correction','deletion','restriction');
create type dsr_status as enum ('submitted','verified','in_progress','completed','rejected');

create table if not exists data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references facilities(id) on delete restrict,
  patient_id uuid references patients(id) on delete set null,
  request_type dsr_type not null,
  status dsr_status not null default 'submitted',
  requested_by text not null,
  request_notes text,
  verified_by uuid references users(id),
  completed_by uuid references users(id),
  rejection_reason text,
  due_at timestamptz not null default (now() + interval '30 days'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table data_subject_requests enable row level security;
create policy dsr_select on data_subject_requests for select using (same_facility(facility_id) and current_user_role() in ('super_admin','facility_admin','clinician'));
create policy dsr_write on data_subject_requests for all using (same_facility(facility_id) and current_user_role() in ('super_admin','facility_admin')) with check (same_facility(facility_id) and current_user_role() in ('super_admin','facility_admin'));
create trigger trg_dsr_updated before update on data_subject_requests for each row execute function touch_updated_at();
create index idx_dsr_facility_status_due on data_subject_requests(facility_id, status, due_at);

-- Server-side audit trigger backstop for direct SQL/API changes.
create or replace function audit_row_change() returns trigger language plpgsql security definer as $$
declare
  rid text;
  fid uuid;
begin
  if tg_table_name = 'facilities' then
    rid := coalesce(new.id::text, old.id::text);
    fid := coalesce(new.id, old.id);
  else
    rid := coalesce(new.id::text, old.id::text);
    fid := coalesce(new.facility_id, old.facility_id);
  end if;

  insert into audit_logs(facility_id, actor_id, action, table_name, record_id, changes)
  values (fid, auth.uid(), lower(tg_op), tg_table_name, rid, jsonb_build_object('source','db_trigger'));
  return coalesce(new, old);
end; $$;

drop trigger if exists audit_facilities_changes on facilities;
drop trigger if exists audit_patients_changes on patients;
drop trigger if exists audit_chp_changes on chp_directory;
drop trigger if exists audit_referrals_changes on referrals;
drop trigger if exists audit_appointments_changes on appointments;
drop trigger if exists audit_dsr_changes on data_subject_requests;
create trigger audit_facilities_changes after insert or update or delete on facilities for each row execute function audit_row_change();
create trigger audit_patients_changes after insert or update or delete on patients for each row execute function audit_row_change();
create trigger audit_chp_changes after insert or update or delete on chp_directory for each row execute function audit_row_change();
create trigger audit_referrals_changes after insert or update or delete on referrals for each row execute function audit_row_change();
create trigger audit_appointments_changes after insert or update or delete on appointments for each row execute function audit_row_change();
create trigger audit_dsr_changes after insert or update or delete on data_subject_requests for each row execute function audit_row_change();

-- Retention and data-rights operational helpers.
create or replace function mark_expired_patients_for_review()
returns integer language plpgsql security invoker as $$
declare n integer;
begin
  update patients
  set deletion_requested_at = coalesce(deletion_requested_at, now())
  where retention_until < current_date
    and deletion_requested_at is null
    and same_facility(facility_id);
  get diagnostics n = row_count;
  return n;
end; $$;

create or replace function request_patient_export(p_patient_id uuid, p_requested_by text)
returns data_subject_requests language plpgsql security invoker as $$
declare rec data_subject_requests;
begin
  insert into data_subject_requests(facility_id, patient_id, request_type, requested_by)
  select facility_id, id, 'export', p_requested_by from patients where id = p_patient_id and same_facility(facility_id)
  returning * into rec;
  update patients set export_requested_at = now() where id = p_patient_id;
  return rec;
end; $$;

create or replace function request_patient_deletion(p_patient_id uuid, p_requested_by text, p_notes text default null)
returns data_subject_requests language plpgsql security invoker as $$
declare rec data_subject_requests;
begin
  insert into data_subject_requests(facility_id, patient_id, request_type, requested_by, request_notes)
  select facility_id, id, 'deletion', p_requested_by, p_notes from patients where id = p_patient_id and same_facility(facility_id)
  returning * into rec;
  update patients set deletion_requested_at = now() where id = p_patient_id;
  return rec;
end; $$;

-- Supabase API grants. RLS still decides which rows each authenticated user can access.
grant usage on schema public to authenticated;
grant select on facilities, users, dashboard_metrics, chp_directory_secure, referrals_secure, audit_logs, data_subject_requests to authenticated;
grant insert, update, delete on facilities, patients, referrals, chp_directory, appointments, data_subject_requests to authenticated;
grant insert on audit_logs to authenticated;
grant execute on function create_referral_secure(jsonb) to authenticated;
grant execute on function update_referral_secure(uuid, text, text) to authenticated;
grant execute on function upsert_chp_secure(jsonb) to authenticated;
grant execute on function mark_expired_patients_for_review() to authenticated;
grant execute on function request_patient_export(uuid, text) to authenticated;
grant execute on function request_patient_deletion(uuid, text, text) to authenticated;
grant usage, select on sequence audit_logs_id_seq to authenticated;

