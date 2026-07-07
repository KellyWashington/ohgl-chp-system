-- 20260705_000015_referral_workflow_command_engine.sql
-- OCHP-002B Referral Workflow Command Engine.
-- Backend-only command RPC layer for referral lifecycle transitions.

CREATE OR REPLACE FUNCTION referral_stage_for_status(p_status referral_canonical_status)
RETURNS referral_stage
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_status
    WHEN 'draft' THEN 'registration'::referral_stage
    WHEN 'submitted' THEN 'registration'::referral_stage
    WHEN 'accepted' THEN 'receiving'::referral_stage
    WHEN 'received' THEN 'receiving'::referral_stage
    WHEN 'assigned' THEN 'clinical'::referral_stage
    WHEN 'triaged' THEN 'clinical'::referral_stage
    WHEN 'in_consultation' THEN 'clinical'::referral_stage
    WHEN 'treatment' THEN 'treatment'::referral_stage
    WHEN 'outcome_recorded' THEN 'outcome'::referral_stage
    WHEN 'completed' THEN 'closure'::referral_stage
    WHEN 'closed' THEN 'closure'::referral_stage
    WHEN 'cancelled' THEN 'closure'::referral_stage
    WHEN 'reopened' THEN 'receiving'::referral_stage
    WHEN 'archived' THEN 'archive'::referral_stage
  END;
$$;

CREATE OR REPLACE FUNCTION referral_legacy_opd_status(p_status referral_canonical_status)
RETURNS opd_status
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_status
    WHEN 'draft' THEN 'Pending'::opd_status
    WHEN 'submitted' THEN 'Submitted'::opd_status
    WHEN 'accepted' THEN 'Under Review'::opd_status
    WHEN 'received' THEN 'Received'::opd_status
    WHEN 'assigned' THEN 'Under Review'::opd_status
    WHEN 'triaged' THEN 'Under Review'::opd_status
    WHEN 'in_consultation' THEN 'In Consultation'::opd_status
    WHEN 'treatment' THEN 'Admitted'::opd_status
    WHEN 'outcome_recorded' THEN 'Admitted'::opd_status
    WHEN 'completed' THEN 'Completed'::opd_status
    WHEN 'closed' THEN 'Closed'::opd_status
    WHEN 'cancelled' THEN 'Cancelled'::opd_status
    WHEN 'reopened' THEN 'Under Review'::opd_status
    WHEN 'archived' THEN 'Closed'::opd_status
  END;
$$;

CREATE OR REPLACE FUNCTION referral_status_from_legacy_opd(p_status opd_status)
RETURNS referral_canonical_status
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_status::text
    WHEN 'Pending' THEN 'draft'::referral_canonical_status
    WHEN 'Submitted' THEN 'submitted'::referral_canonical_status
    WHEN 'Received' THEN 'received'::referral_canonical_status
    WHEN 'Under Review' THEN 'triaged'::referral_canonical_status
    WHEN 'In Consultation' THEN 'in_consultation'::referral_canonical_status
    WHEN 'Admitted' THEN 'treatment'::referral_canonical_status
    WHEN 'Attended' THEN 'completed'::referral_canonical_status
    WHEN 'Completed' THEN 'completed'::referral_canonical_status
    WHEN 'Closed' THEN 'closed'::referral_canonical_status
    WHEN 'DNA' THEN 'cancelled'::referral_canonical_status
    WHEN 'Cancelled' THEN 'cancelled'::referral_canonical_status
    ELSE 'submitted'::referral_canonical_status
  END;
$$;

CREATE OR REPLACE FUNCTION validate_referral_permission(p_permission text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  IF NOT (
    public.has_permission(p_permission)
    OR (p_permission = 'referral:update_facility' AND public.has_permission('referral:update'))
    OR (p_permission = 'referral:complete' AND public.has_permission('referral:update'))
  ) THEN
    RAISE EXCEPTION 'You do not have permission to perform this referral action.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION validate_referral_transition(
  p_current referral_canonical_status,
  p_next referral_canonical_status
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_current = 'archived' THEN
    RAISE EXCEPTION 'Archived referrals cannot be modified.';
  END IF;

  IF p_current = p_next THEN
    RETURN;
  END IF;

  IF p_current = 'closed' AND p_next NOT IN ('reopened', 'archived') THEN
    RAISE EXCEPTION 'Closed referrals must be reopened before modification.';
  END IF;

  IF p_current = 'cancelled' AND p_next NOT IN ('reopened', 'archived') THEN
    RAISE EXCEPTION 'Cancelled referrals must be reopened before modification.';
  END IF;

  IF NOT (
    (p_current = 'draft' AND p_next IN ('submitted', 'cancelled'))
    OR (p_current = 'submitted' AND p_next IN ('accepted', 'cancelled'))
    OR (p_current = 'accepted' AND p_next IN ('received', 'assigned', 'triaged', 'cancelled'))
    OR (p_current = 'received' AND p_next IN ('assigned', 'triaged', 'cancelled'))
    OR (p_current = 'assigned' AND p_next IN ('assigned', 'triaged', 'in_consultation', 'cancelled'))
    OR (p_current = 'triaged' AND p_next IN ('assigned', 'in_consultation', 'cancelled'))
    OR (p_current = 'in_consultation' AND p_next IN ('treatment', 'outcome_recorded', 'cancelled'))
    OR (p_current = 'treatment' AND p_next IN ('outcome_recorded', 'completed', 'cancelled'))
    OR (p_current = 'outcome_recorded' AND p_next IN ('completed', 'cancelled'))
    OR (p_current = 'completed' AND p_next IN ('closed', 'reopened'))
    OR (p_current IN ('closed', 'cancelled') AND p_next = 'reopened')
    OR (p_current = 'reopened' AND p_next IN ('accepted', 'received', 'assigned', 'triaged', 'cancelled'))
    OR (p_current IN ('closed', 'cancelled') AND p_next = 'archived')
  ) THEN
    RAISE EXCEPTION 'Invalid referral transition from % to %.', p_current, p_next;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION validate_referral_facility(p_facility_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_facility_id IS NULL THEN
    RAISE EXCEPTION 'Facility is required.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM facilities WHERE id = p_facility_id) THEN
    RAISE EXCEPTION 'Facility does not exist.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION validate_referral_department(p_department_id uuid, p_facility_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_department_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM departments
    WHERE id = p_department_id
      AND facility_id = p_facility_id
      AND active = true
  ) THEN
    RAISE EXCEPTION 'Department does not exist for the selected facility.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION validate_referral_owner(p_referral referrals)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_user_role() = 'super_admin'::app_role THEN
    RETURN;
  END IF;

  IF p_referral.created_by = auth.uid() AND public.has_permission('referral:read_own') THEN
    RETURN;
  END IF;

  IF public.same_facility(coalesce(p_referral.current_owner_facility_id, p_referral.referral_facility_id, p_referral.facility_id)) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'Referral not found or access denied.';
END;
$$;

CREATE OR REPLACE FUNCTION write_referral_event(
  p_referral_id uuid,
  p_event_name text,
  p_previous_status referral_canonical_status,
  p_new_status referral_canonical_status,
  p_previous_stage referral_stage,
  p_new_stage referral_stage,
  p_owner_type referral_owner_type,
  p_owner_user_id uuid,
  p_owner_facility_id uuid,
  p_department text,
  p_facility_id uuid,
  p_reason text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_category text DEFAULT 'workflow',
  p_created_by_system boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO referral_events (
    referral_id,
    event_name,
    actor_id,
    actor_role,
    previous_status,
    new_status,
    previous_stage,
    new_stage,
    owner_type,
    owner_user_id,
    owner_facility_id,
    department,
    facility_id,
    reason,
    metadata,
    event_category,
    event_source,
    correlation_id,
    created_by_system
  ) VALUES (
    p_referral_id,
    p_event_name,
    CASE WHEN p_created_by_system THEN NULL ELSE auth.uid() END,
    CASE WHEN p_created_by_system THEN NULL ELSE public.current_user_role() END,
    p_previous_status,
    p_new_status,
    p_previous_stage,
    p_new_stage,
    p_owner_type,
    p_owner_user_id,
    p_owner_facility_id,
    p_department,
    p_facility_id,
    p_reason,
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(nullif(trim(p_category), ''), 'workflow'),
    'ochp',
    coalesce((p_metadata->>'correlation_id')::uuid, gen_random_uuid()),
    p_created_by_system
  );
END;
$$;

CREATE OR REPLACE FUNCTION write_referral_audit(
  p_referral_id uuid,
  p_action text,
  p_facility_id uuid,
  p_before jsonb,
  p_after jsonb,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO audit_logs (
    facility_id,
    actor_id,
    action,
    table_name,
    record_id,
    changes
  ) VALUES (
    p_facility_id,
    auth.uid(),
    p_action,
    'referrals',
    p_referral_id::text,
    jsonb_build_object(
      'before', coalesce(p_before, '{}'::jsonb),
      'after', coalesce(p_after, '{}'::jsonb),
      'reason', p_reason
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION write_assignment_history(
  p_old referrals,
  p_new referrals,
  p_assignment_type referral_assignment_type,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO referral_assignment_history (
    referral_id,
    previous_owner_type,
    previous_owner_user_id,
    previous_owner_facility_id,
    previous_department,
    new_owner_type,
    new_owner_user_id,
    new_owner_facility_id,
    new_department,
    actor_id,
    reason,
    assignment_type
  ) VALUES (
    p_new.id,
    p_old.current_owner_type,
    p_old.current_owner_user_id,
    p_old.current_owner_facility_id,
    p_old.current_owner_department,
    p_new.current_owner_type,
    p_new.current_owner_user_id,
    p_new.current_owner_facility_id,
    p_new.current_owner_department,
    auth.uid(),
    p_reason,
    coalesce(p_assignment_type, 'assign'::referral_assignment_type)
  );
END;
$$;

CREATE OR REPLACE FUNCTION update_referral_sla(
  p_referral_id uuid,
  p_transition_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE referral_sla_timers
  SET completed_at = coalesce(completed_at, now()),
      updated_at = now()
  WHERE referral_id = p_referral_id
    AND transition_name = p_transition_name
    AND completed_at IS NULL;

  PERFORM write_referral_event(
    p_referral_id,
    'sla_updated',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    jsonb_build_object('transition', p_transition_name),
    'sla',
    true
  );
END;
$$;

CREATE OR REPLACE FUNCTION queue_notification_event(
  p_referral_id uuid,
  p_notification_type text,
  p_facility_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM write_referral_event(
    p_referral_id,
    'notification_queued',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    p_facility_id,
    NULL,
    p_facility_id,
    NULL,
    jsonb_build_object('notification_type', p_notification_type, 'payload', coalesce(p_metadata, '{}'::jsonb)),
    'notification',
    true
  );
END;
$$;

CREATE OR REPLACE FUNCTION write_referral_note(
  p_referral_id uuid,
  p_note_type referral_note_type,
  p_note_text text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_version integer;
  previous_id uuid;
BEGIN
  IF nullif(trim(coalesce(p_note_text, '')), '') IS NULL THEN
    RETURN;
  END IF;

  SELECT id, version + 1
  INTO previous_id, next_version
  FROM referral_clinical_notes
  WHERE referral_id = p_referral_id
    AND note_type = p_note_type
  ORDER BY version DESC
  LIMIT 1;

  INSERT INTO referral_clinical_notes (
    referral_id,
    note_type,
    note_text,
    author_id,
    author_role,
    version,
    previous_note_id,
    supersedes_note_id,
    metadata
  ) VALUES (
    p_referral_id,
    p_note_type,
    trim(p_note_text),
    auth.uid(),
    public.current_user_role(),
    coalesce(next_version, 1),
    previous_id,
    previous_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION update_current_owner(
  p_ref referrals,
  p_owner_type referral_owner_type,
  p_owner_user_id uuid,
  p_owner_facility_id uuid,
  p_department_id uuid,
  p_department text
)
RETURNS referrals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  out_ref referrals := p_ref;
  dept_name text;
BEGIN
  IF p_department_id IS NOT NULL THEN
    SELECT department_name INTO dept_name
    FROM departments
    WHERE id = p_department_id;
  END IF;

  out_ref.current_owner_type := coalesce(p_owner_type, out_ref.current_owner_type);
  out_ref.current_owner_user_id := coalesce(p_owner_user_id, out_ref.current_owner_user_id);
  out_ref.current_owner_facility_id := coalesce(p_owner_facility_id, out_ref.current_owner_facility_id, out_ref.referral_facility_id, out_ref.facility_id);
  out_ref.department_id := coalesce(p_department_id, out_ref.department_id);
  out_ref.current_owner_department := coalesce(nullif(trim(coalesce(dept_name, p_department, '')), ''), out_ref.current_owner_department);
  out_ref.department := coalesce(nullif(trim(coalesce(dept_name, p_department, '')), ''), out_ref.department);
  out_ref.ownership_updated_at := now();

  IF out_ref.current_owner_type = 'facility' THEN
    out_ref.current_owner_user_id := NULL;
  ELSIF out_ref.current_owner_type = 'department' THEN
    out_ref.current_owner_user_id := NULL;
  END IF;

  RETURN out_ref;
END;
$$;

CREATE OR REPLACE FUNCTION apply_referral_command(
  p_referral_id uuid,
  p_command text,
  p_next_status referral_canonical_status,
  p_permission text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_assignment_type referral_assignment_type DEFAULT NULL,
  p_note_type referral_note_type DEFAULT NULL
)
RETURNS referrals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_rec referrals;
  new_rec referrals;
  next_stage referral_stage;
  owner_type referral_owner_type;
  owner_user_id uuid;
  owner_facility_id uuid;
  dept_id uuid;
  dept_text text;
  outcome_value referral_outcome;
  reason text := nullif(trim(coalesce(p_payload->>'reason', '')), '');
  note_text text := coalesce(p_payload->>'note', p_payload->>'notes', p_payload->>'clinical_notes');
BEGIN
  PERFORM validate_referral_permission(p_permission);

  SELECT * INTO old_rec
  FROM referrals
  WHERE id = p_referral_id
  FOR UPDATE;

  IF old_rec.id IS NULL THEN
    RAISE EXCEPTION 'Referral not found.';
  END IF;

  PERFORM validate_referral_owner(old_rec);
  PERFORM validate_referral_transition(old_rec.referral_status, p_next_status);

  IF p_command IN (
    'cancel_referral',
    'reopen_referral',
    'archive_referral',
    'transfer_department',
    'transfer_facility',
    'assign_referral'
  ) AND reason IS NULL THEN
    RAISE EXCEPTION 'Reason is required for this referral action.';
  END IF;

  owner_facility_id := coalesce(
    nullif(p_payload->>'target_facility_id', '')::uuid,
    nullif(p_payload->>'referral_facility_id', '')::uuid,
    nullif(p_payload->>'facility_id', '')::uuid
  );
  owner_user_id := coalesce(
    nullif(p_payload->>'target_user_id', '')::uuid,
    nullif(p_payload->>'assignee_user_id', '')::uuid,
    nullif(p_payload->>'owner_user_id', '')::uuid,
    nullif(p_payload->>'clinician_id', '')::uuid
  );
  dept_id := coalesce(nullif(p_payload->>'department_id', '')::uuid, nullif(p_payload->>'target_department_id', '')::uuid);
  dept_text := coalesce(nullif(trim(p_payload->>'department'), ''), nullif(trim(p_payload->>'target_department'), ''));

  IF p_command = 'assign_referral' THEN
    IF owner_user_id IS NULL AND dept_id IS NULL AND dept_text IS NULL THEN
      RAISE EXCEPTION 'Assignee or department is required.';
    END IF;
    owner_type := CASE WHEN owner_user_id IS NOT NULL THEN 'assigned_user'::referral_owner_type ELSE 'department'::referral_owner_type END;
  ELSIF p_command = 'transfer_department' THEN
    IF dept_id IS NULL AND dept_text IS NULL THEN
      RAISE EXCEPTION 'Target department is required.';
    END IF;
    owner_type := 'department'::referral_owner_type;
  ELSIF p_command = 'transfer_facility' THEN
    IF owner_facility_id IS NULL THEN
      RAISE EXCEPTION 'Target facility is required.';
    END IF;
    owner_type := 'facility'::referral_owner_type;
  ELSIF owner_user_id IS NOT NULL THEN
    owner_type := 'assigned_user'::referral_owner_type;
  ELSIF dept_id IS NOT NULL OR dept_text IS NOT NULL THEN
    owner_type := 'department'::referral_owner_type;
  ELSE
    owner_type := old_rec.current_owner_type;
  END IF;

  owner_facility_id := coalesce(owner_facility_id, old_rec.current_owner_facility_id, old_rec.referral_facility_id, old_rec.facility_id);

  PERFORM validate_referral_facility(owner_facility_id);
  PERFORM validate_referral_department(dept_id, owner_facility_id);

  IF NOT (
    public.current_user_role() = 'super_admin'::app_role
    OR public.same_facility(coalesce(old_rec.current_owner_facility_id, old_rec.referral_facility_id, old_rec.facility_id))
  ) THEN
    RAISE EXCEPTION 'Wrong facility for this referral action.';
  END IF;

  new_rec := public.update_current_owner(old_rec, owner_type, owner_user_id, owner_facility_id, dept_id, dept_text);
  next_stage := public.referral_stage_for_status(p_next_status);
  outcome_value := CASE
    WHEN nullif(p_payload->>'outcome', '') IS NOT NULL THEN (p_payload->>'outcome')::referral_outcome
    ELSE old_rec.referral_outcome
  END;

  IF p_command = 'complete_referral' AND outcome_value = 'unknown'::referral_outcome THEN
    RAISE EXCEPTION 'Outcome is required before completing a referral.';
  END IF;

  UPDATE referrals
  SET referral_status = p_next_status,
      referral_stage = next_stage,
      referral_outcome = outcome_value,
      current_owner_type = new_rec.current_owner_type,
      current_owner_user_id = new_rec.current_owner_user_id,
      current_owner_facility_id = new_rec.current_owner_facility_id,
      current_owner_department = new_rec.current_owner_department,
      department_id = new_rec.department_id,
      department = new_rec.department,
      referral_facility_id = CASE WHEN p_command = 'transfer_facility' THEN owner_facility_id ELSE referrals.referral_facility_id END,
      facility_id = CASE WHEN p_command = 'transfer_facility' THEN owner_facility_id ELSE referrals.facility_id END,
      opd_status = public.referral_legacy_opd_status(p_next_status),
      priority = CASE WHEN nullif(p_payload->>'priority', '') IS NOT NULL THEN (p_payload->>'priority')::referral_priority ELSE referrals.priority END,
      received_by = CASE WHEN jsonb_exists(p_payload, 'received_by') THEN p_payload->>'received_by' ELSE referrals.received_by END,
      file_no = CASE WHEN jsonb_exists(p_payload, 'file_no') THEN p_payload->>'file_no' ELSE referrals.file_no END,
      updated_by = auth.uid(),
      updated_at = now(),
      ownership_updated_at = new_rec.ownership_updated_at
  WHERE id = p_referral_id
  RETURNING * INTO new_rec;

  IF p_assignment_type IS NOT NULL
    OR old_rec.current_owner_type IS DISTINCT FROM new_rec.current_owner_type
    OR old_rec.current_owner_user_id IS DISTINCT FROM new_rec.current_owner_user_id
    OR old_rec.current_owner_facility_id IS DISTINCT FROM new_rec.current_owner_facility_id
    OR old_rec.current_owner_department IS DISTINCT FROM new_rec.current_owner_department THEN
    PERFORM write_assignment_history(old_rec, new_rec, coalesce(p_assignment_type, 'assign'::referral_assignment_type), reason);
  END IF;

  IF p_note_type IS NOT NULL THEN
    PERFORM write_referral_note(p_referral_id, p_note_type, note_text, p_payload);
  END IF;

  PERFORM write_referral_event(
    p_referral_id,
    p_command,
    old_rec.referral_status,
    new_rec.referral_status,
    old_rec.referral_stage,
    new_rec.referral_stage,
    new_rec.current_owner_type,
    new_rec.current_owner_user_id,
    new_rec.current_owner_facility_id,
    new_rec.current_owner_department,
    new_rec.facility_id,
    reason,
    p_payload,
    'workflow',
    false
  );

  PERFORM write_referral_audit(
    p_referral_id,
    p_command,
    new_rec.facility_id,
    jsonb_build_object('status', old_rec.referral_status, 'stage', old_rec.referral_stage, 'owner_type', old_rec.current_owner_type, 'owner_user_id', old_rec.current_owner_user_id, 'owner_facility_id', old_rec.current_owner_facility_id, 'department', old_rec.current_owner_department),
    jsonb_build_object('status', new_rec.referral_status, 'stage', new_rec.referral_stage, 'owner_type', new_rec.current_owner_type, 'owner_user_id', new_rec.current_owner_user_id, 'owner_facility_id', new_rec.current_owner_facility_id, 'department', new_rec.current_owner_department),
    reason
  );

  PERFORM update_referral_sla(p_referral_id, p_command);
  PERFORM queue_notification_event(p_referral_id, p_command, new_rec.facility_id, p_payload);

  RETURN new_rec;
END;
$$;

CREATE OR REPLACE FUNCTION next_referral_slip_no()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_year text := to_char(current_date, 'YYYY');
  next_number integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('referrals.slip_no.' || current_year));

  SELECT coalesce(max(substring(slip_no from 11 for 6)::integer), 0) + 1
  INTO next_number
  FROM referrals
  WHERE slip_no ~ ('^OHGL-' || current_year || '-[0-9]{6}$');

  RETURN 'OHGL-' || current_year || '-' || lpad(next_number::text, 6, '0');
END;
$;
REVOKE EXECUTE ON FUNCTION next_referral_slip_no() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION next_referral_slip_no() FROM authenticated;

CREATE OR REPLACE FUNCTION create_referral_secure(payload jsonb)
RETURNS referrals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec referrals;
  patient_rec patients;
  fid uuid;
  dept_id uuid;
  dept_name text;
  encrypt_key text := current_setting('app.encryption_key', true);
  normalized_nid text := regexp_replace(coalesce(payload->>'national_id', ''), '\D', '', 'g');
  start_status referral_canonical_status := coalesce(nullif(payload->>'referral_status', '')::referral_canonical_status, 'submitted'::referral_canonical_status);
  start_stage referral_stage;
BEGIN
  IF jsonb_exists(payload, 'slip_no') THEN
    RAISE EXCEPTION 'Referral slip number is generated by the database and must not be supplied.';
  END IF;

  PERFORM validate_referral_permission('referral:create');

  IF start_status NOT IN ('draft', 'submitted') THEN
    RAISE EXCEPTION 'New referrals must start as draft or submitted.';
  END IF;

  fid := coalesce(
    nullif(payload->>'referral_facility_id', '')::uuid,
    nullif(payload->>'facility_id', '')::uuid,
    public.current_user_facility()
  );
  dept_id := nullif(payload->>'department_id', '')::uuid;

  PERFORM validate_referral_facility(fid);
  PERFORM validate_referral_department(dept_id, fid);

  IF NOT (public.current_user_role() = 'super_admin'::app_role OR public.same_facility(fid)) THEN
    RAISE EXCEPTION 'Wrong facility for referral creation.';
  END IF;

  IF nullif(trim(coalesce(payload->>'patient_name', '')), '') IS NULL THEN
    RAISE EXCEPTION 'Patient name is required.';
  END IF;

  IF start_status = 'submitted' AND (normalized_nid = '' OR normalized_nid !~ '^[0-9]{6,12}$') THEN
    RAISE EXCEPTION 'Valid National ID is required before submission.';
  END IF;

  IF normalized_nid <> '' AND EXISTS (
    SELECT 1
    FROM referrals
    WHERE national_id = normalized_nid
      AND referral_status NOT IN ('completed', 'closed', 'cancelled', 'archived')
  ) THEN
    RAISE EXCEPTION 'An active referral already exists for this patient identifier.';
  END IF;

  SELECT department_name INTO dept_name
  FROM departments
  WHERE id = dept_id;

  INSERT INTO patients (
    facility_id,
    full_name,
    national_id,
    phone,
    sex,
    created_by
  ) VALUES (
    fid,
    trim(payload->>'patient_name'),
    NULLIF(normalized_nid, ''),
    NULLIF(payload->>'phone', ''),
    NULLIF(payload->>'sex', ''),
    auth.uid()
  )
  RETURNING * INTO patient_rec;

  start_stage := public.referral_stage_for_status(start_status);

  INSERT INTO referrals (
    facility_id,
    patient_id,
    slip_no,
    referral_date,
    chp_code,
    chp_unit,
    patient_name_ciphertext,
    national_id,
    phone,
    age,
    sex,
    county,
    subcounty,
    village,
    category,
    priority,
    sha_registered,
    presenting_concern_ciphertext,
    referral_reason,
    clinical_notes_ciphertext,
    referral_facility_id,
    referral_facility_name,
    department,
    department_id,
    opd_status,
    referral_status,
    referral_stage,
    referral_outcome,
    current_owner_type,
    current_owner_facility_id,
    current_owner_department,
    created_by,
    updated_by
  ) VALUES (
    fid,
    patient_rec.id,
    public.next_referral_slip_no(),
    coalesce(nullif(payload->>'referral_date', '')::date, current_date),
    NULLIF(payload->>'chp_code', ''),
    NULLIF(payload->>'chp_unit', ''),
    pgp_sym_encrypt(coalesce(payload->>'patient_name', ''), encrypt_key),
    NULLIF(normalized_nid, ''),
    NULLIF(payload->>'phone', ''),
    NULLIF(payload->>'age', '')::int,
    NULLIF(payload->>'sex', ''),
    NULLIF(payload->>'county', ''),
    NULLIF(payload->>'subcounty', ''),
    NULLIF(payload->>'village', ''),
    CASE WHEN nullif(coalesce(dept_name, payload->>'department'), '') IS NULL THEN '{}'::text[] ELSE ARRAY[coalesce(dept_name, payload->>'department')] END,
    coalesce(nullif(payload->>'priority', '')::referral_priority, 'Routine'::referral_priority),
    coalesce(nullif(payload->>'sha_registered', '')::boolean, false),
    pgp_sym_encrypt(coalesce(payload->>'presenting_concern', ''), encrypt_key),
    NULLIF(payload->>'referral_reason', ''),
    pgp_sym_encrypt(coalesce(payload->>'clinical_notes', ''), encrypt_key),
    fid,
    NULLIF(payload->>'referral_facility_name', ''),
    coalesce(dept_name, NULLIF(payload->>'department', '')),
    dept_id,
    public.referral_legacy_opd_status(start_status),
    start_status,
    start_stage,
    'unknown'::referral_outcome,
    'facility'::referral_owner_type,
    fid,
    coalesce(dept_name, NULLIF(payload->>'department', '')),
    auth.uid(),
    auth.uid()
  )
  RETURNING * INTO rec;

  PERFORM write_referral_event(rec.id, 'create_referral', NULL, rec.referral_status, NULL, rec.referral_stage, rec.current_owner_type, rec.current_owner_user_id, rec.current_owner_facility_id, rec.current_owner_department, rec.facility_id, NULL, payload, 'workflow', false);
  PERFORM write_referral_audit(rec.id, 'create_referral', rec.facility_id, '{}'::jsonb, jsonb_build_object('status', rec.referral_status, 'stage', rec.referral_stage), NULL);
  PERFORM update_referral_sla(rec.id, 'create_referral');
  PERFORM queue_notification_event(rec.id, 'create_referral', rec.facility_id, payload);

  RETURN rec;
END;
$$;

CREATE OR REPLACE FUNCTION save_referral_draft_secure(payload jsonb)
RETURNS referrals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF nullif(payload->>'referral_id', '') IS NULL THEN
    RETURN public.create_referral_secure(payload || jsonb_build_object('referral_status', 'draft'));
  END IF;

  RETURN public.apply_referral_command(
    (payload->>'referral_id')::uuid,
    'save_referral_draft',
    'draft'::referral_canonical_status,
    'referral:create',
    payload,
    NULL,
    'chp'::referral_note_type
  );
END;
$$;

CREATE OR REPLACE FUNCTION submit_referral_secure(p_referral_id uuid, payload jsonb DEFAULT '{}'::jsonb)
RETURNS referrals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.apply_referral_command(p_referral_id, 'submit_referral', 'submitted', 'referral:create', payload, NULL, NULL);
END; $$;

CREATE OR REPLACE FUNCTION accept_referral_secure(p_referral_id uuid, payload jsonb DEFAULT '{}'::jsonb)
RETURNS referrals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.apply_referral_command(p_referral_id, 'accept_referral', 'accepted', 'referral:update_facility', payload, NULL, 'receiving');
END; $$;

CREATE OR REPLACE FUNCTION receive_patient_secure(p_referral_id uuid, payload jsonb DEFAULT '{}'::jsonb)
RETURNS referrals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.apply_referral_command(p_referral_id, 'receive_patient', 'received', 'referral:update_facility', payload, NULL, 'receiving');
END; $$;

CREATE OR REPLACE FUNCTION assign_referral_secure(p_referral_id uuid, payload jsonb DEFAULT '{}'::jsonb)
RETURNS referrals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.apply_referral_command(p_referral_id, 'assign_referral', 'assigned', 'referral:update_facility', payload, 'assign', NULL);
END; $$;

CREATE OR REPLACE FUNCTION transfer_department_secure(p_referral_id uuid, payload jsonb DEFAULT '{}'::jsonb)
RETURNS referrals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.apply_referral_command(p_referral_id, 'transfer_department', 'assigned', 'referral:update_facility', payload, 'transfer_department', NULL);
END; $$;

CREATE OR REPLACE FUNCTION transfer_facility_secure(p_referral_id uuid, payload jsonb DEFAULT '{}'::jsonb)
RETURNS referrals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.apply_referral_command(p_referral_id, 'transfer_facility', 'accepted', 'referral:update_facility', payload, 'transfer_facility', NULL);
END; $$;

CREATE OR REPLACE FUNCTION triage_referral_secure(p_referral_id uuid, payload jsonb DEFAULT '{}'::jsonb)
RETURNS referrals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.apply_referral_command(p_referral_id, 'triage_referral', 'triaged', 'referral:update_facility', payload, NULL, 'triage');
END; $$;

CREATE OR REPLACE FUNCTION start_consultation_secure(p_referral_id uuid, payload jsonb DEFAULT '{}'::jsonb)
RETURNS referrals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.apply_referral_command(p_referral_id, 'start_consultation', 'in_consultation', 'referral:update_facility', payload, NULL, 'consultation');
END; $$;

CREATE OR REPLACE FUNCTION record_investigation_secure(p_referral_id uuid, payload jsonb DEFAULT '{}'::jsonb)
RETURNS referrals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.apply_referral_command(p_referral_id, 'record_investigation', 'in_consultation', 'referral:update_facility', payload, NULL, 'investigation');
END; $$;

CREATE OR REPLACE FUNCTION record_treatment_secure(p_referral_id uuid, payload jsonb DEFAULT '{}'::jsonb)
RETURNS referrals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.apply_referral_command(p_referral_id, 'record_treatment', 'treatment', 'referral:update_facility', payload, NULL, 'treatment');
END; $$;

CREATE OR REPLACE FUNCTION record_outcome_secure(p_referral_id uuid, payload jsonb DEFAULT '{}'::jsonb)
RETURNS referrals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.apply_referral_command(p_referral_id, 'record_outcome', 'outcome_recorded', 'referral:update_facility', payload, NULL, 'outcome');
END; $$;

CREATE OR REPLACE FUNCTION request_followup_secure(p_referral_id uuid, payload jsonb DEFAULT '{}'::jsonb)
RETURNS referrals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rec referrals;
BEGIN
  SELECT * INTO rec FROM referrals WHERE id = p_referral_id;
  IF rec.id IS NULL THEN RAISE EXCEPTION 'Referral not found.'; END IF;
  RETURN public.apply_referral_command(p_referral_id, 'request_followup', rec.referral_status, 'referral:update_facility', payload || jsonb_build_object('outcome', 'follow_up_required'), NULL, 'follow_up');
END; $$;

CREATE OR REPLACE FUNCTION schedule_followup_secure(p_referral_id uuid, payload jsonb DEFAULT '{}'::jsonb)
RETURNS referrals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rec referrals;
BEGIN
  SELECT * INTO rec FROM referrals WHERE id = p_referral_id;
  IF rec.id IS NULL THEN RAISE EXCEPTION 'Referral not found.'; END IF;
  RETURN public.apply_referral_command(p_referral_id, 'schedule_followup', rec.referral_status, 'referral:update_facility', payload, NULL, 'follow_up');
END; $$;

CREATE OR REPLACE FUNCTION complete_referral_secure(p_referral_id uuid, payload jsonb DEFAULT '{}'::jsonb)
RETURNS referrals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.apply_referral_command(p_referral_id, 'complete_referral', 'completed', 'referral:complete', payload, NULL, NULL);
END; $$;

CREATE OR REPLACE FUNCTION close_referral_secure(p_referral_id uuid, payload jsonb DEFAULT '{}'::jsonb)
RETURNS referrals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.apply_referral_command(p_referral_id, 'close_referral', 'closed', 'referral:complete', payload, NULL, NULL);
END; $$;

CREATE OR REPLACE FUNCTION cancel_referral_secure(p_referral_id uuid, payload jsonb DEFAULT '{}'::jsonb)
RETURNS referrals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.apply_referral_command(p_referral_id, 'cancel_referral', 'cancelled', 'referral:update_facility', payload, NULL, NULL);
END; $$;

CREATE OR REPLACE FUNCTION reopen_referral_secure(p_referral_id uuid, payload jsonb DEFAULT '{}'::jsonb)
RETURNS referrals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.apply_referral_command(p_referral_id, 'reopen_referral', 'reopened', 'referral:update_facility', payload, NULL, NULL);
END; $$;

CREATE OR REPLACE FUNCTION archive_referral_secure(p_referral_id uuid, payload jsonb DEFAULT '{}'::jsonb)
RETURNS referrals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.apply_referral_command(p_referral_id, 'archive_referral', 'archived', 'referral:complete', payload, NULL, NULL);
END; $$;

CREATE OR REPLACE FUNCTION update_referral_secure_full(p_referral_id uuid, payload jsonb)
RETURNS referrals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec referrals;
  legacy_status opd_status;
  canonical_status referral_canonical_status;
  encrypt_key text := current_setting('app.encryption_key', true);
BEGIN
  PERFORM validate_referral_permission('referral:update_facility');

  SELECT * INTO rec
  FROM referrals
  WHERE id = p_referral_id
  FOR UPDATE;

  IF rec.id IS NULL THEN
    RAISE EXCEPTION 'Referral not found.';
  END IF;

  PERFORM validate_referral_owner(rec);

  IF jsonb_exists(payload, 'workflow_status') OR jsonb_exists(payload, 'opd_status') THEN
    legacy_status := coalesce(nullif(payload->>'opd_status', '')::opd_status, nullif(payload->>'workflow_status', '')::opd_status);
    canonical_status := public.referral_status_from_legacy_opd(legacy_status);
    RETURN public.apply_referral_command(p_referral_id, 'legacy_status_update', canonical_status, 'referral:update_facility', payload, NULL, NULL);
  END IF;

  UPDATE referrals
  SET received_by = CASE WHEN jsonb_exists(payload, 'received_by') THEN payload->>'received_by' ELSE received_by END,
      file_no = CASE WHEN jsonb_exists(payload, 'file_no') THEN payload->>'file_no' ELSE file_no END,
      sha_no_ciphertext = CASE WHEN jsonb_exists(payload, 'sha_no') THEN pgp_sym_encrypt(coalesce(payload->>'sha_no', ''), encrypt_key) ELSE sha_no_ciphertext END,
      clinical_notes_ciphertext = CASE WHEN jsonb_exists(payload, 'clinical_notes') THEN pgp_sym_encrypt(coalesce(payload->>'clinical_notes', ''), encrypt_key) ELSE clinical_notes_ciphertext END,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_referral_id
  RETURNING * INTO rec;

  PERFORM write_referral_event(rec.id, 'legacy_field_update', rec.referral_status, rec.referral_status, rec.referral_stage, rec.referral_stage, rec.current_owner_type, rec.current_owner_user_id, rec.current_owner_facility_id, rec.current_owner_department, rec.facility_id, nullif(payload->>'reason', ''), payload, 'workflow', false);
  PERFORM write_referral_audit(rec.id, 'legacy_field_update', rec.facility_id, '{}'::jsonb, jsonb_build_object('payload', payload - 'reason'), nullif(payload->>'reason', ''));
  PERFORM update_referral_sla(rec.id, 'legacy_field_update');

  RETURN rec;
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON referrals FROM authenticated;

GRANT EXECUTE ON FUNCTION create_referral_secure(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION save_referral_draft_secure(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION submit_referral_secure(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION accept_referral_secure(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION receive_patient_secure(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION assign_referral_secure(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION transfer_department_secure(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION transfer_facility_secure(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION triage_referral_secure(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION start_consultation_secure(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION record_investigation_secure(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION record_treatment_secure(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION record_outcome_secure(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION request_followup_secure(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION schedule_followup_secure(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION complete_referral_secure(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION close_referral_secure(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_referral_secure(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION reopen_referral_secure(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION archive_referral_secure(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION update_referral_secure_full(uuid, jsonb) TO authenticated;

