-- 20260707_000024_referral_facilities_rpc.sql
-- Production repair for Destination Referral Facility dropdown loading only.

CREATE OR REPLACE FUNCTION public.list_referral_facilities_secure()
RETURNS TABLE (
  id uuid,
  name text,
  location text,
  subcounty text,
  level text,
  email text,
  phone text,
  year integer,
  active boolean,
  token_rate numeric,
  financial_year integer,
  compiler text,
  coic text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    f.id,
    f.name,
    f.location,
    f.subcounty,
    f.level,
    f.email,
    f.phone,
    f.financial_year AS year,
    true AS active,
    f.token_rate,
    f.financial_year,
    f.compiler,
    f.coic,
    f.created_at,
    f.updated_at
  FROM facilities f
  WHERE auth.uid() IS NOT NULL
    AND (
      public.has_permission('facility:read')
      OR public.has_permission('referral:create')
    )
  ORDER BY f.location, f.name;
$$;

REVOKE EXECUTE ON FUNCTION public.list_referral_facilities_secure() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_referral_facilities_secure() TO authenticated;

SELECT proname
FROM pg_proc
WHERE proname = 'list_referral_facilities_secure';

SELECT pg_get_functiondef(
  'list_referral_facilities_secure()'::regprocedure
);