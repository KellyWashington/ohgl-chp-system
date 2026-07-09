-- 20260710_000020_staff_invitation_system.sql
-- OCHP: Staff invitation system for clinicians and receptionist creation by super_admin
-- Implements email invitation workflow with secure password setup on first login

CREATE TABLE IF NOT EXISTS staff_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  email text NOT NULL,
  role app_role NOT NULL,
  full_name text NOT NULL,
  phone text,
  invited_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  invited_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  token_hash text UNIQUE NOT NULL,
  token_expires_at timestamptz NOT NULL,
  accepted boolean NOT NULL DEFAULT false,
  created_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT valid_role CHECK (role IN ('clinician', 'facility_officer', 'chp')),
  CONSTRAINT invitation_email_facility_key UNIQUE (email, facility_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_invitations_facility ON staff_invitations(facility_id);
CREATE INDEX IF NOT EXISTS idx_staff_invitations_email ON staff_invitations(email);
CREATE INDEX IF NOT EXISTS idx_staff_invitations_token_hash ON staff_invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_staff_invitations_created_user ON staff_invitations(created_user_id);

ALTER TABLE staff_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_invitations_select ON staff_invitations;
DROP POLICY IF EXISTS staff_invitations_no_direct_insert ON staff_invitations;
DROP POLICY IF EXISTS staff_invitations_no_direct_update ON staff_invitations;
DROP POLICY IF EXISTS staff_invitations_no_direct_delete ON staff_invitations;

CREATE POLICY staff_invitations_select ON staff_invitations
  FOR SELECT
  USING (public.is_super_admin() OR facility_id = public.current_user_facility());

CREATE POLICY staff_invitations_no_direct_insert ON staff_invitations
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY staff_invitations_no_direct_update ON staff_invitations
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

CREATE POLICY staff_invitations_no_direct_delete ON staff_invitations
  FOR DELETE
  USING (false);

-- Secure RPC to invite staff
CREATE OR REPLACE FUNCTION invite_staff_secure(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p_facility_id uuid := nullif(payload->>'facility_id', '')::uuid;
  p_email text := lower(nullif(trim(coalesce(payload->>'email', '')), ''));
  p_role text := lower(nullif(trim(coalesce(payload->>'role', '')), ''));
  p_full_name text := nullif(trim(coalesce(payload->>'full_name', '')), '');
  p_phone text := nullif(trim(coalesce(payload->>'phone', '')), '');
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_token_hash text := encode(digest(v_token, 'sha256'), 'hex');
  v_invitation_record staff_invitations;
BEGIN
  -- Authorization check: only super_admin can invite staff
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only Super Admin can invite staff members.';
  END IF;

  -- Validation
  IF p_facility_id IS NULL OR NOT EXISTS (SELECT 1 FROM facilities f WHERE f.id = p_facility_id) THEN
    RAISE EXCEPTION 'A valid facility is required.';
  END IF;
  IF p_email IS NULL OR p_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$' THEN
    RAISE EXCEPTION 'A valid email address is required.';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('clinician', 'facility_officer', 'chp') THEN
    RAISE EXCEPTION 'Role must be one of: clinician, facility_officer, chp.';
  END IF;
  IF p_full_name IS NULL THEN
    RAISE EXCEPTION 'Full name is required.';
  END IF;
  IF p_phone IS NULL THEN
    RAISE EXCEPTION 'Phone number is required.';
  END IF;

  -- Check for existing invitation or user
  IF EXISTS (SELECT 1 FROM staff_invitations WHERE email = p_email AND facility_id = p_facility_id AND NOT accepted) THEN
    RAISE EXCEPTION 'An active invitation already exists for this email at this facility.';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE email = p_email AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'A user with this email already exists at this facility.';
  END IF;

  -- Insert invitation
  INSERT INTO staff_invitations (
    facility_id, email, role, full_name, phone, invited_by, token_hash, token_expires_at
  )
  VALUES (
    p_facility_id, p_email, p_role::app_role, p_full_name, p_phone, auth.uid(),
    v_token_hash, now() + INTERVAL '7 days'
  )
  RETURNING * INTO v_invitation_record;

  -- Log the invitation
  PERFORM public.write_user_access_audit(
    null,
    'staff_invitation_sent',
    jsonb_build_object('email', p_email, 'role', p_role),
    jsonb_build_object('invitation_id', v_invitation_record.id, 'facility_id', p_facility_id),
    'Invited ' || p_full_name || ' as ' || p_role
  );

  -- Return invitation details with token (only once at creation)
  RETURN jsonb_build_object(
    'invitation_id', v_invitation_record.id,
    'token', v_token,
    'email', p_email,
    'full_name', p_full_name,
    'role', p_role,
    'expires_at', v_invitation_record.token_expires_at
  );
END;
$$;

-- Secure RPC to accept staff invitation and create user (via trigger on auth.users)
CREATE OR REPLACE FUNCTION accept_staff_invitation_secure(token text, password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token_hash text := encode(digest(nullif(trim(coalesce(token, '')), ''), 'sha256'), 'hex');
  v_invitation staff_invitations;
  v_user users;
BEGIN
  -- Find valid invitation
  SELECT * INTO v_invitation FROM staff_invitations
  WHERE token_hash = v_token_hash
    AND NOT accepted
    AND token_expires_at > now()
  FOR UPDATE;

  IF v_invitation IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invitation token.';
  END IF;

  -- Create auth user (trigger will create users profile)
  -- Note: In production, this should be called from frontend via Supabase signUp with metadata
  -- containing the invitation token. The trigger then validates and links the invitation.
  -- For now, this RPC validates the invitation state.

  -- Mark invitation as accepted
  UPDATE staff_invitations
  SET accepted = true, accepted_at = now()
  WHERE id = v_invitation.id
  RETURNING * INTO v_invitation;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Invitation accepted. Please sign in with your credentials.'
  );
END;
$$;

-- Trigger to auto-link invitation when user is created via signup with invitation token
CREATE OR REPLACE FUNCTION handle_staff_invitation_on_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitation_token text := nullif(trim(coalesce(new.raw_user_meta_data->>'invitation_token', '')), '');
  v_token_hash text;
  v_invitation staff_invitations;
  v_user users;
BEGIN
  -- If there's an invitation token, try to link the user
  IF v_invitation_token IS NOT NULL THEN
    v_token_hash := encode(digest(v_invitation_token, 'sha256'), 'hex');
    
    SELECT * INTO v_invitation FROM staff_invitations
    WHERE token_hash = v_token_hash
      AND email = new.email
      AND NOT accepted
      AND token_expires_at > now()
    FOR UPDATE;

    IF v_invitation IS NOT NULL THEN
      -- Create user profile linked to invitation
      INSERT INTO public.users (
        id,
        facility_id,
        role,
        full_name,
        email,
        phone,
        active,
        approval_status
      )
      VALUES (
        new.id,
        v_invitation.facility_id,
        v_invitation.role,
        v_invitation.full_name,
        new.email,
        v_invitation.phone,
        true,
        'approved'::user_approval_status
      )
      ON CONFLICT (id) DO UPDATE SET
        facility_id = excluded.facility_id,
        role = excluded.role,
        full_name = excluded.full_name,
        active = true,
        approval_status = 'approved'::user_approval_status
      RETURNING * INTO v_user;

      -- Mark invitation as accepted
      UPDATE staff_invitations
      SET accepted = true, accepted_at = now(), created_user_id = new.id
      WHERE id = v_invitation.id;

      -- Log the acceptance
      PERFORM public.write_user_access_audit(
        new.id,
        'staff_invitation_accepted',
        jsonb_build_object('invitation_id', v_invitation.id),
        jsonb_build_object('user_id', new.id, 'role', v_invitation.role::text, 'facility_id', v_invitation.facility_id),
        'Accepted invitation for ' || v_invitation.role
      );
    END IF;
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_staff_invitation ON auth.users;
CREATE TRIGGER on_auth_user_created_staff_invitation
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_staff_invitation_on_auth_user();
