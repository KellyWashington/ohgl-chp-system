-- 20260707_000023_production_referral_hotfix.sql
-- Surgical production hotfix for database-owned referral slip numbers only.

CREATE OR REPLACE FUNCTION public.next_referral_slip_no()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_year text := to_char(current_date, 'YYYY');
  next_number integer;
  candidate text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('referrals.slip_no.' || current_year));

  SELECT coalesce(max(substring(slip_no from 11 for 6)::integer), 0) + 1
  INTO next_number
  FROM referrals
  WHERE slip_no ~ ('^OHGL-' || current_year || '-[0-9]{6}$');

  LOOP
    candidate := 'OHGL-' || current_year || '-' || lpad(next_number::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM referrals WHERE slip_no = candidate);
    next_number := next_number + 1;
  END LOOP;

  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_referral_secure(payload jsonb)
RETURNS referrals_secure
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare
  rec referrals;
  attempts integer := 0;
begin
  IF jsonb_exists(payload,'slip_no') THEN
    RAISE EXCEPTION 'Client supplied referral number is not allowed.';
  END IF;

  LOOP
    attempts := attempts + 1;
    BEGIN
      insert into referrals (
        facility_id,
        slip_no,
        referral_date,
        chp_code,
        chp_unit,
        patient_name_ciphertext,
        age,
        sex,
        category,
        priority,
        sha_registered,
        presenting_concern_ciphertext,
        clinical_notes_ciphertext,
        opd_status,
        received_by,
        file_no,
        sha_no_ciphertext,
        created_by
      )
      values (
        (payload->>'facility_id')::uuid,
        public.next_referral_slip_no(),
        (payload->>'referral_date')::date,
        payload->>'chp_code',
        payload->>'chp_unit',
        phi_encrypt(payload->>'patient_name'),
        nullif(payload->>'age','')::int,
        payload->>'sex',
        coalesce(
          array(select jsonb_array_elements_text(payload->'category')),
          '{}'
        ),
        coalesce(
          (payload->>'priority')::referral_priority,
          'Routine'::referral_priority
        ),
        coalesce((payload->>'sha_registered')::boolean, false),
        phi_encrypt(payload->>'presenting_concern'),
        phi_encrypt(payload->>'clinical_notes'),
        coalesce(
          (payload->>'opd_status')::opd_status,
          'Pending'::opd_status
        ),
        payload->>'received_by',
        payload->>'file_no',
        phi_encrypt(payload->>'sha_no'),
        auth.uid()
      )
      returning * into rec;

      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF attempts >= 5 THEN
        RAISE;
      END IF;
    END;
  END LOOP;

  return (
    select r
    from referrals_secure r
    where r.id = rec.id
  );
end;
$function$;

GRANT EXECUTE ON FUNCTION public.create_referral_secure(jsonb) TO authenticated;

SELECT proname
FROM pg_proc
WHERE proname='next_referral_slip_no';

SELECT pg_get_functiondef(
'create_referral_secure(jsonb)'::regprocedure
);