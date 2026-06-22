-- Reset only this application's public schema objects after a failed first install.
-- Use only on a fresh/new Supabase project before real data exists.

drop view if exists referrals_secure cascade;
drop view if exists chp_directory_secure cascade;
drop view if exists dashboard_metrics cascade;

drop table if exists data_subject_requests cascade;
drop table if exists audit_logs cascade;
drop table if exists appointments cascade;
drop table if exists referrals cascade;
drop table if exists chp_directory cascade;
drop table if exists patients cascade;
drop table if exists users cascade;
drop table if exists facilities cascade;

drop function if exists request_patient_deletion(uuid, text, text) cascade;
drop function if exists request_patient_export(uuid, text) cascade;
drop function if exists mark_expired_patients_for_review() cascade;
drop function if exists audit_row_change() cascade;
drop function if exists upsert_chp_secure(jsonb) cascade;
drop function if exists update_referral_secure(uuid, text, text) cascade;
drop function if exists create_referral_secure(jsonb) cascade;
drop function if exists phi_decrypt(bytea) cascade;
drop function if exists phi_encrypt(text) cascade;
drop function if exists phi_key() cascade;
drop function if exists touch_updated_at() cascade;
drop function if exists same_facility(uuid) cascade;
drop function if exists is_super_admin() cascade;
drop function if exists current_user_facility() cascade;
drop function if exists current_user_role() cascade;

drop type if exists dsr_status cascade;
drop type if exists dsr_type cascade;
drop type if exists consent_status cascade;
drop type if exists opd_status cascade;
drop type if exists referral_priority cascade;
drop type if exists app_role cascade;
