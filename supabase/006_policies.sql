create or replace function can_read_referral(p_facility_id uuid, p_created_by uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  role_name text := public.normalized_user_role();
begin
  if auth.uid() is null then
    return false;
  end if;

  if role_name = 'super_admin' then
    return true;
  end if;

  if role_name = 'chp' then
    return p_created_by = auth.uid()
      and public.has_permission('referral:read_own');
  end if;

  return public.same_facility(p_facility_id)
    and public.has_permission('referral:read');
end;
$$;
-- 006_policies.sql
-- Enables RLS security policies on new tables and allocates execution grants

-- Enable RLS on notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select ON notifications;
DROP POLICY IF EXISTS notifications_update ON notifications;
DROP POLICY IF EXISTS notifications_insert ON notifications;

CREATE POLICY notifications_select ON notifications
  FOR SELECT USING (user_id = auth.uid() OR (facility_id = public.current_user_facility() AND user_id IS NULL));

CREATE POLICY notifications_update ON notifications
  FOR UPDATE USING (user_id = auth.uid() OR (facility_id = public.current_user_facility() AND user_id IS NULL))
  WITH CHECK (user_id = auth.uid() OR (facility_id = public.current_user_facility() AND user_id IS NULL));

CREATE POLICY notifications_insert ON notifications
  FOR INSERT WITH CHECK (true);

-- Enable RLS on referral_status_events
ALTER TABLE referral_status_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS events_select ON referral_status_events;
CREATE POLICY events_select ON referral_status_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM referrals r 
      WHERE r.id = referral_id 
        AND public.can_read_referral(r.facility_id, r.created_by)
    )
  );

-- Allocate Grants
REVOKE EXECUTE ON FUNCTION can_read_referral(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION can_read_referral(uuid, uuid) TO authenticated;
GRANT SELECT ON referrals_secure TO authenticated;
GRANT SELECT ON chp_directory_secure TO authenticated;
GRANT SELECT, UPDATE, INSERT ON notifications TO authenticated;
GRANT SELECT, INSERT ON referral_status_events TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_chp_secure(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION update_referral_secure_legacy(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION update_referral_secure_full(uuid, jsonb) TO authenticated;
