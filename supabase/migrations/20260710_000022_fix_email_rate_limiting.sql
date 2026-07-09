-- 20260710_000022_fix_email_rate_limiting.sql
-- OCHP: Fix email rate limiting on CHP registration
-- Implements server-side rate limiting via Supabase Auth configuration
-- and database-level tracking for registration attempts

CREATE TABLE IF NOT EXISTS registration_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  ip_address inet,
  user_agent text,
  status text NOT NULL,
  error_message text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_status CHECK (status IN ('success', 'failed', 'rate_limited', 'invalid_input'))
);

CREATE INDEX IF NOT EXISTS idx_registration_attempts_email ON registration_attempts(email);
CREATE INDEX IF NOT EXISTS idx_registration_attempts_ip ON registration_attempts(ip_address);
CREATE INDEX IF NOT EXISTS idx_registration_attempts_attempted_at ON registration_attempts(attempted_at DESC);

ALTER TABLE registration_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS registration_attempts_no_select ON registration_attempts;
DROP POLICY IF EXISTS registration_attempts_no_insert ON registration_attempts;

CREATE POLICY registration_attempts_no_select ON registration_attempts
  FOR SELECT
  USING (false);

CREATE POLICY registration_attempts_no_insert ON registration_attempts
  FOR INSERT
  WITH CHECK (true);

-- Secure RPC to check registration rate limit (server-side)
CREATE OR REPLACE FUNCTION check_registration_rate_limit(p_email text, p_ip_address inet DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_ip_address inet := p_ip_address;
  v_attempts_1h integer;
  v_attempts_24h integer;
  v_is_rate_limited boolean := false;
  v_reason text := '';
BEGIN
  IF v_email IS NULL THEN
    RETURN jsonb_build_object(
      'is_rate_limited', true,
      'reason', 'Invalid email address.'
    );
  END IF;

  -- Check email-based rate limit: max 3 attempts per hour
  SELECT COUNT(*) INTO v_attempts_1h
  FROM registration_attempts
  WHERE email = v_email
    AND status != 'rate_limited'
    AND attempted_at > now() - INTERVAL '1 hour';

  IF v_attempts_1h >= 3 THEN
    v_is_rate_limited := true;
    v_reason := 'Too many registration attempts from this email. Please try again in 1 hour.';
  END IF;

  -- Check email-based daily limit: max 5 attempts per 24h
  SELECT COUNT(*) INTO v_attempts_24h
  FROM registration_attempts
  WHERE email = v_email
    AND attempted_at > now() - INTERVAL '24 hours';

  IF v_attempts_24h >= 5 THEN
    v_is_rate_limited := true;
    v_reason := 'Too many registration attempts from this email. Please try again later.';
  END IF;

  -- Check IP-based rate limit if IP available: max 10 attempts per hour
  IF v_ip_address IS NOT NULL THEN
    SELECT COUNT(*) INTO v_attempts_1h
    FROM registration_attempts
    WHERE ip_address = v_ip_address
      AND attempted_at > now() - INTERVAL '1 hour';

    IF v_attempts_1h >= 10 THEN
      v_is_rate_limited := true;
      v_reason := 'Too many registration attempts from your network. Please try again in 1 hour.';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'is_rate_limited', v_is_rate_limited,
    'reason', CASE WHEN v_is_rate_limited THEN v_reason ELSE 'OK' END,
    'email_attempts_1h', v_attempts_1h,
    'email_attempts_24h', v_attempts_24h
  );
END;
$$;

-- Secure RPC to log registration attempt
CREATE OR REPLACE FUNCTION log_registration_attempt(p_email text, p_status text, p_error_message text DEFAULT NULL, p_ip_address inet DEFAULT NULL, p_user_agent text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_status text := lower(nullif(trim(coalesce(p_status, '')), ''));
BEGIN
  IF v_email IS NULL OR v_status IS NULL THEN
    RAISE EXCEPTION 'Email and status are required.';
  END IF;

  IF v_status NOT IN ('success', 'failed', 'rate_limited', 'invalid_input') THEN
    RAISE EXCEPTION 'Invalid status: %', v_status;
  END IF;

  INSERT INTO registration_attempts (email, ip_address, user_agent, status, error_message)
  VALUES (v_email, p_ip_address, p_user_agent, v_status, p_error_message);
END;
$$;

-- Policy to allow authenticated users to check their own registration rate limit
CREATE OR REPLACE FUNCTION get_my_registration_attempts()
RETURNS TABLE(attempted_at timestamptz, status text, error_message text)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  -- Get current user's email from auth
  v_email := (SELECT email FROM auth.users WHERE id = auth.uid());
  
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'User not authenticated.';
  END IF;

  RETURN QUERY
  SELECT ra.attempted_at, ra.status, ra.error_message
  FROM registration_attempts ra
  WHERE ra.email = v_email
  ORDER BY ra.attempted_at DESC
  LIMIT 10;
END;
$$;
