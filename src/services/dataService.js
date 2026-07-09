import { sb } from './supabaseClient.js';

/**
 * Fetches core application data with fallback error handling.
 * If facilities query fails due to RLS, returns empty array so UI can render properly.
 */
export function fetchCoreData() {
  return Promise.all([
    sb.from('facilities').select('*').order('location'),
    sb.from('chp_directory_secure').select('*').order('code'),
    sb.from('referrals_secure').select('*').order('created_at', { ascending: true }),
    sb.from('coverage_areas').select('*').order('sub_location'),
  ]);
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
  return sb.rpc('create_referral_secure', { payload });
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
    p_payload: payload,
  });
}

export function fetchNotifications(userId, facilityId) {
  return sb.from('notifications')
    .select('*')
    .or(`user_id.eq.${userId},and(facility_id.eq.${facilityId},user_id.is.null)`)
    .order('created_at', { ascending: false })
    .limit(50);
}

export function markNotificationRead(notificationId) {
  return sb.from('notifications')
    .update({ read: true })
    .eq('id', notificationId);
}

export function markAllNotificationsRead(userId) {
  return sb.from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false);
}

export function fetchReferralAssignmentHistory(referralId) {
  return sb.rpc('get_referral_assignment_history', { p_referral_id: referralId });
}

export function fetchReferralClinicalNotes(referralId) {
  return sb.rpc('get_referral_clinical_notes', { p_referral_id: referralId });
}

export function fetchReferralEvents(referralId) {
  return sb.rpc('get_referral_events', { p_referral_id: referralId });
}

export function fetchReferralSla(referralId) {
  return sb.rpc('get_referral_sla', { p_referral_id: referralId });
}
