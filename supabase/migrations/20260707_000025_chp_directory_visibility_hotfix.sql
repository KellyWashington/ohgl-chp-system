-- 20260707_000025_chp_directory_visibility_hotfix.sql
-- Production repair for CHP Directory visibility only.

CREATE OR REPLACE VIEW public.chp_directory_secure AS
WITH directory_rows AS (
  SELECT
    c.id,
    c.facility_id,
    c.user_id,
    c.code,
    phi_decrypt(c.full_name_ciphertext) AS full_name,
    phi_decrypt(c.national_id_ciphertext) AS national_id,
    phi_decrypt(c.phone_ciphertext) AS phone,
    c.village,
    c.community_unit,
    c.sha_trained,
    c.jumuisha_enrolled,
    c.active,
    c.notes,
    c.created_at,
    c.updated_at
  FROM chp_directory c
), approved_user_chps AS (
  SELECT
    u.id,
    u.facility_id,
    u.id AS user_id,
    coalesce(nullif(to_jsonb(u)->>'chp_code_requested', ''), 'CHP-' || substring(u.id::text from 1 for 8)) AS code,
    u.full_name,
    NULL::text AS national_id,
    u.phone,
    NULL::text AS village,
    NULL::text AS community_unit,
    false AS sha_trained,
    false AS jumuisha_enrolled,
    u.active,
    'Approved CHP user profile'::text AS notes,
    u.created_at,
    u.updated_at
  FROM users u
  WHERE u.role::text = 'chp'
    AND u.approval_status::text = 'approved'
    AND u.active = true
    AND u.facility_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM chp_directory c
      WHERE c.user_id = u.id
    )
), combined AS (
  SELECT * FROM directory_rows
  UNION ALL
  SELECT * FROM approved_user_chps
)
SELECT
  id,
  facility_id,
  user_id,
  code,
  full_name,
  national_id,
  phone,
  village,
  community_unit,
  sha_trained,
  jumuisha_enrolled,
  active,
  notes,
  created_at,
  updated_at
FROM combined
WHERE public.same_facility(facility_id);

GRANT SELECT ON public.chp_directory_secure TO authenticated;

SELECT viewname
FROM pg_views
WHERE schemaname = 'public'
  AND viewname = 'chp_directory_secure';

SELECT definition
FROM pg_views
WHERE schemaname = 'public'
  AND viewname = 'chp_directory_secure';