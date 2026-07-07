-- 20260707_000021_chp_referral_visibility_hotfix.sql
-- OCHP security hotfix: CHPs may only read referrals they created.

CREATE OR REPLACE FUNCTION can_read_referral(p_facility_id uuid, p_created_by uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  role_name text := public.normalized_user_role();
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF role_name = 'super_admin' THEN
    RETURN true;
  END IF;

  IF role_name = 'chp' THEN
    RETURN p_created_by = auth.uid()
      AND public.has_permission('referral:read_own');
  END IF;

  RETURN public.same_facility(p_facility_id)
    AND public.has_permission('referral:read');
END;
$$;

REVOKE EXECUTE ON FUNCTION can_read_referral(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION can_read_referral(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS referrals_select ON referrals;
CREATE POLICY referrals_select ON referrals
  FOR SELECT USING (public.can_read_referral(facility_id, created_by));

DROP POLICY IF EXISTS events_select ON referral_status_events;
CREATE POLICY events_select ON referral_status_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM referrals r
      WHERE r.id = referral_id
        AND public.can_read_referral(r.facility_id, r.created_by)
    )
  );

CREATE OR REPLACE VIEW referrals_secure WITH (security_invoker = true) AS
SELECT
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
  r.opd_status as workflow_status,
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
    SELECT jsonb_agg(jsonb_build_object('status', e.status, 'at', e.changed_at, 'by', coalesce(e.responsible_user_name, u.full_name)) ORDER BY e.changed_at)
    FROM referral_status_events e
    LEFT JOIN users u ON u.id = e.changed_by
    WHERE e.referral_id = r.id
  ), '[]'::jsonb) as timeline
FROM referrals r
LEFT JOIN users creator ON creator.id = r.created_by
LEFT JOIN users updater ON updater.id = r.updated_by
WHERE public.can_read_referral(r.facility_id, r.created_by);

CREATE OR REPLACE VIEW dashboard_metrics WITH (security_invoker = true) AS
SELECT facility_id, date_trunc('month', referral_date)::date as month,
  count(*) as total_referrals,
  count(*) filter (where opd_status='Attended') as attended,
  count(*) filter (where opd_status='Pending') as pending,
  count(*) filter (where priority='Emergency') as emergencies,
  count(*) filter (where sha_registered) as sha_registered
FROM referrals
WHERE public.can_read_referral(facility_id, created_by)
GROUP BY facility_id, date_trunc('month', referral_date);

GRANT SELECT ON referrals_secure TO authenticated;
GRANT SELECT ON dashboard_metrics TO authenticated;