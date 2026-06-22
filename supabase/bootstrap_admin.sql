-- Bootstrap the first application profile after creating the Supabase Auth user.
-- Replace the values below and run as a Supabase project owner.

insert into facilities (id, name, location, level, email, phone, token_rate, financial_year)
values ('00000000-0000-0000-0000-000000000001', 'Oasis Doctors Siaya', 'Siaya', 'Level 4', 'siaya@oasishealthcaregroup.com', '+254 748 450 548', 200, 2026)
on conflict (id) do update set name = excluded.name;

insert into users (id, facility_id, role, full_name, email, active)
values (
  '20899b2a-38a5-45f5-a73d-9f2a0c1d7062',
  '00000000-0000-0000-0000-000000000001',
  'super_admin',
  'Rawlings',
  'kellandiwashington@gmail.com',
  true
)
on conflict (id) do update set role = 'super_admin', active = true;
