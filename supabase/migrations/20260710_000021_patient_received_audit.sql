-- 20260710_000021_patient_received_audit.sql
-- OCHP: Audit logging for patient received status with timestamp and actor tracking

CREATE TABLE IF NOT EXISTS patient_received_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL,
  received_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  received_by_name text NOT NULL,
  received_by_role app_role,
  received_at timestamptz NOT NULL DEFAULT now(),
  received_date date NOT NULL DEFAULT CURRENT_DATE,
  received_time time NOT NULL DEFAULT CURRENT_TIME,
  day_of_week text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_received_audit_referral ON patient_received_audit(referral_id);
CREATE INDEX IF NOT EXISTS idx_patient_received_audit_facility ON patient_received_audit(facility_id);
CREATE INDEX IF NOT EXISTS idx_patient_received_audit_user ON patient_received_audit(received_by_user_id);
CREATE INDEX IF NOT EXISTS idx_patient_received_audit_date ON patient_received_audit(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_received_audit_received_date ON patient_received_audit(received_date DESC);

ALTER TABLE patient_received_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_received_audit_select ON patient_received_audit;
DROP POLICY IF EXISTS patient_received_audit_no_direct_insert ON patient_received_audit;
DROP POLICY IF EXISTS patient_received_audit_no_direct_update ON patient_received_audit;
DROP POLICY IF EXISTS patient_received_audit_no_direct_delete ON patient_received_audit;

CREATE POLICY patient_received_audit_select ON patient_received_audit
  FOR SELECT
  USING (public.same_facility(facility_id) AND public.has_permission('referral:read'));

CREATE POLICY patient_received_audit_no_direct_insert ON patient_received_audit
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY patient_received_audit_no_direct_update ON patient_received_audit
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

CREATE POLICY patient_received_audit_no_direct_delete ON patient_received_audit
  FOR DELETE
  USING (false);

-- Secure RPC to mark patient as received with audit logging
CREATE OR REPLACE FUNCTION mark_patient_received_secure(referral_id uuid, notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referral referrals;
  v_current_user users;
  v_audit_record patient_received_audit;
BEGIN
  -- Get current user info
  SELECT * INTO v_current_user FROM users WHERE id = auth.uid();
  IF v_current_user IS NULL THEN
    RAISE EXCEPTION 'User not found or not authenticated.';
  END IF;

  -- Get referral and verify access
  SELECT * INTO v_referral FROM referrals WHERE id = referral_id;
  IF v_referral IS NULL THEN
    RAISE EXCEPTION 'Referral not found.';
  END IF;
  IF NOT public.same_facility(v_referral.facility_id) THEN
    RAISE EXCEPTION 'You do not have access to this referral.';
  END IF;

  -- Verify permission
  IF NOT public.has_permission('referral:update') THEN
    RAISE EXCEPTION 'You do not have permission to mark patients as received.';
  END IF;

  -- Update referral status to 'Received'
  UPDATE referrals
  SET opd_status = 'Received'::opd_status,
      updated_at = now()
  WHERE id = referral_id;

  -- Create audit record
  INSERT INTO patient_received_audit (
    referral_id,
    facility_id,
    received_by_user_id,
    received_by_name,
    received_by_role,
    received_at,
    received_date,
    received_time,
    day_of_week,
    notes
  )
  VALUES (
    referral_id,
    v_current_user.facility_id,
    v_current_user.id,
    v_current_user.full_name,
    v_current_user.role,
    now(),
    CURRENT_DATE,
    CURRENT_TIME,
    to_char(now(), 'Day'),
    nullif(trim(coalesce(notes, '')), '')
  )
  RETURNING * INTO v_audit_record;

  -- Write to general audit log
  PERFORM public.write_user_access_audit(
    v_current_user.id,
    'patient_received',
    jsonb_build_object('referral_id', referral_id, 'old_status', v_referral.opd_status),
    jsonb_build_object('new_status', 'Received', 'received_at', now()),
    'Marked patient as received. ' || COALESCE('Notes: ' || notes, '')
  );

  RETURN jsonb_build_object(
    'success', true,
    'audit_id', v_audit_record.id,
    'referral_id', referral_id,
    'received_at', v_audit_record.received_at,
    'received_by', v_current_user.full_name,
    'message', 'Patient marked as received'
  );
END;
$$;

-- View for audit reports
CREATE OR REPLACE VIEW patient_received_audit_report AS
SELECT
  pra.id,
  pra.referral_id,
  r.slip_no,
  pra.facility_id,
  f.name as facility_name,
  pra.received_by_user_id,
  pra.received_by_name,
  pra.received_by_role,
  pra.received_at,
  pra.received_date,
  pra.received_time,
  pra.day_of_week,
  pra.notes,
  pra.created_at,
  EXTRACT(EPOCH FROM (pra.created_at - r.referral_date)) / 3600 as hours_to_receive
FROM patient_received_audit pra
LEFT JOIN referrals r ON r.id = pra.referral_id
LEFT JOIN facilities f ON f.id = pra.facility_id
ORDER BY pra.received_at DESC;
