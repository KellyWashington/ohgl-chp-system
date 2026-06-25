-- Auth user provisioning migration.
-- Ensures every Supabase auth user gets a matching app profile so login does not fail on missing users rows.

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_role text := lower(coalesce(new.raw_user_meta_data->>'role', ''));
  inferred_role app_role := 'chp';
begin
  inferred_role := case raw_role
    when 'super_admin' then 'super_admin'
    when 'super admin' then 'super_admin'
    when 'facility_admin' then 'facility_admin'
    when 'facility administrator' then 'facility_admin'
    when 'facility_officer' then 'facility_officer'
    when 'facility officer' then 'facility_officer'
    when 'clinician' then 'facility_officer'
    when 'viewer' then 'chp'
    when 'chp' then 'chp'
    else 'chp'
  end;

  insert into public.users (id, facility_id, role, full_name, email, active)
  values (
    new.id,
    null,
    inferred_role,
    coalesce(nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')), ''), split_part(new.email, '@', 1), new.email),
    new.email,
    true
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    active = true;

  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

insert into public.users (id, facility_id, role, full_name, email, active)
select
  au.id,
  null,
  case lower(coalesce(au.raw_user_meta_data->>'role', ''))
    when 'super_admin' then 'super_admin'::app_role
    when 'super admin' then 'super_admin'::app_role
    when 'facility_admin' then 'facility_admin'::app_role
    when 'facility administrator' then 'facility_admin'::app_role
    when 'facility_officer' then 'facility_officer'::app_role
    when 'facility officer' then 'facility_officer'::app_role
    when 'clinician' then 'facility_officer'::app_role
    when 'viewer' then 'chp'::app_role
    when 'chp' then 'chp'::app_role
    else 'chp'::app_role
  end,
  coalesce(nullif(trim(coalesce(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', '')), ''), split_part(au.email, '@', 1), au.email),
  au.email,
  true
from auth.users au
left join public.users pu on pu.id = au.id
where pu.id is null
on conflict (id) do nothing;
