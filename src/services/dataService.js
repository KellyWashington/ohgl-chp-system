import { sb } from './supabaseClient.js';

export async function fetchCoreData() {
  const facilities = await fetchReferralFacilities();
  const [chps, refs, coverageAreas] = await Promise.all([
    sb.from('chp_directory_secure').select('*').order('code'),
    sb.from('referrals_secure').select('*').order('created_at', { ascending: true }),
    sb.from('coverage_areas').select('*').order('sub_location'),
  ]);
  return [facilities, chps, refs, coverageAreas];
}

export async function fetchReferralFacilities() {
  const secure = await sb.rpc('list_referral_facilities_secure');
  if (!secure.error) return secure;
  const missingRpc = /function .*list_referral_facilities_secure|could not find|schema cache/i.test(secure.error.message || '');
  if (!missingRpc) return secure;
  const fallback = await sb.from('facilities').select('*').order('location');
  return { ...fallback, error: fallback.error ? fallback.error : { message: 'Secure facility lookup RPC is not deployed; using RLS-limited facility fallback.' } };
}

export function fetchUserProfile(userId) {
  return sb.from('users').select('*').eq('id', userId).maybeSingle();
}

export function fetchUsers() {
  return sb.from('users').select('id,facility_id,role,full_name,email,phone,active,last_login_at,created_at').order('full_name');
}


export function listPendingUsersSecure() {
  return sb.rpc('list_pending_users_secure');
}

export function listUsersSecure() {
  return sb.rpc('list_users_secure');
}

export function approveUserSecure(targetUserId, facilityId, reason = '') {
  return sb.rpc('approve_user_secure', { target_user_id: targetUserId, facility_id: facilityId, reason });
}

export function rejectUserSecure(targetUserId, reason) {
  return sb.rpc('reject_user_secure', { target_user_id: targetUserId, reason });
}

export function suspendUserSecure(targetUserId, reason) {
  return sb.rpc('suspend_user_secure', { target_user_id: targetUserId, reason });
}

export function reactivateUserSecure(targetUserId, reason) {
  return sb.rpc('reactivate_user_secure', { target_user_id: targetUserId, reason });
}

export function deactivateUserSecure(targetUserId, reason) {
  return sb.rpc('deactivate_user_secure', { target_user_id: targetUserId, reason });
}

export function assignUserFacilitySecure(targetUserId, facilityId, reason) {
  return sb.rpc('assign_user_facility_secure', { target_user_id: targetUserId, facility_id: facilityId, reason });
}

export function changeUserRoleSecure(targetUserId, newRole, reason) {
  return sb.rpc('change_user_role_secure', { target_user_id: targetUserId, new_role: newRole, reason });
}

export function fetchUserAccessAudit(limit = 50) {
  return sb.from('user_access_audit')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
}
export function writeAuditLog({ actorId, action, tableName, recordId, facilityId, changes }) {
  return sb.from('audit_logs').insert({
    actor_id: actorId,
    action,
    table_name: tableName,
    record_id: recordId ? String(recordId) : null,
    facility_id: facilityId,
    changes,
  });
}

export function createReferralRecord(payload) {
  const { slip_no: _slipNo, slipNo: _slipNoCamel, ...safePayload } = payload || {};
  return sb.rpc('create_referral_secure', { payload: safePayload });
}



export function getWorkflowActionDefinition(commandName) {
  return sb.rpc('get_workflow_action_definition', { command_name: commandName });
}

export function getWorkflowReferenceData(commandName) {
  return sb.rpc('get_workflow_reference_data', { command_name: commandName });
}
export function getAvailableReferralActions(referralId) {
  return sb.rpc('get_available_referral_actions', { referral_id: referralId });
}

export function executeReferralCommand(commandRpc, referralId, payload = {}) {
  return sb.rpc(commandRpc, {
    p_referral_id: referralId,
    payload,
  });
}

export function fetchReferralEvents(referralId) {
  return sb.from('referral_events')
    .select('created_at,event_name,actor_role,department,reason,metadata,event_category,actor:users!referral_events_actor_id_fkey(full_name),facility:facilities!referral_events_facility_id_fkey(name)')
    .eq('referral_id', referralId)
    .order('created_at', { ascending: false });
}

export function fetchReferralClinicalNotes(referralId) {
  return sb.from('referral_clinical_notes')
    .select('id,note_type,note_text,author_role,version,created_at,author:users!referral_clinical_notes_author_id_fkey(full_name)')
    .eq('referral_id', referralId)
    .order('note_type', { ascending: true })
    .order('version', { ascending: false });
}

export function fetchReferralAssignmentHistory(referralId) {
  return sb.from('referral_assignment_history')
    .select('created_at,previous_owner_type,new_owner_type,previous_department,new_department,reason,assignment_type,actor:users!referral_assignment_history_actor_id_fkey(full_name)')
    .eq('referral_id', referralId)
    .order('created_at', { ascending: false });
}

export function fetchReferralSla(referralId) {
  return sb.from('referral_sla_timers')
    .select('transition_name,target_at,warning_at,breach_at,completed_at,breached,created_at,updated_at')
    .eq('referral_id', referralId)
    .order('target_at', { ascending: true });
}

export function updateReferralSecureFull(referralId, payload) {
  return sb.rpc('update_referral_secure_full', {
    p_referral_id: referralId,
    payload,
  });
}

export function deleteReferralRecord(referralId) {
  return sb.from('referrals').delete().eq('id', referralId);
}

export function saveChpRecord(payload) {
  return sb.rpc('upsert_chp_secure', { payload });
}

export function saveCoverageAreaRecord(payload) {
  return sb.rpc('upsert_coverage_area_secure', { payload });
}

export function deleteChpRecord(chpId) {
  return sb.from('chp_directory').delete().eq('id', chpId);
}

export function fetchAuditEvents(limit = 100) {
  return sb.from('audit_logs')
    .select('created_at,action,table_name,record_id,actor_id,ip_address,changes, users(email, full_name)')
    .order('created_at', { ascending: false })
    .limit(limit);
}

export function updateFacilityRecord(facilityId, payload) {
  return sb.from('facilities').update(payload).eq('id', facilityId);
}

export function deleteFacilityRecord(facilityId) {
  return sb.from('facilities').delete().eq('id', facilityId);
}

export function createFacilityRecord(payload) {
  return sb.from('facilities').insert(payload).select().single();
}

export function fetchNotifications(userId, facilityId) {
  if (!userId) return Promise.resolve({ data: [], error: null });
  // Query notifications for user, or facility-wide notifications (where user_id is null)
  let query = sb.from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
    
  if (facilityId) {
    query = query.or(`user_id.eq.${userId},and(facility_id.eq.${facilityId},user_id.is.null)`);
  } else {
    query = query.eq('user_id', userId);
  }
  return query;
}

export function markNotificationRead(notifId) {
  return sb.from('notifications')
    .update({ read: true })
    .eq('id', notifId);
}

export function markAllNotificationsRead(userId, facilityId) {
  if (!userId) return Promise.resolve({ data: [], error: null });
  let query = sb.from('notifications')
    .update({ read: true })
    .eq('read', false);
    
  if (facilityId) {
    query = query.or(`user_id.eq.${userId},and(facility_id.eq.${facilityId},user_id.is.null)`);
  } else {
    query = query.eq('user_id', userId);
  }
  return query;
}







