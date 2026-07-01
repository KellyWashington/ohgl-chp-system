import { sb } from './supabaseClient.js';

export function fetchCoreData() {
  return Promise.all([
    sb.from('facilities').select('*').order('location'),
    sb.from('chp_directory_secure').select('*').order('code'),
    sb.from('referrals_secure').select('*').order('created_at', { ascending: true }),
  ]);
}

export function fetchUserProfile(userId) {
  return sb.from('users').select('*').eq('id', userId).maybeSingle();
}

export function fetchUsers() {
  return sb.from('users').select('id,facility_id,role,full_name,email,phone,active,last_login_at,created_at').order('full_name');
}

export function upsertUserProfile(payload) {
  return sb.from('users').upsert(payload, { onConflict: 'id' }).select().single();
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

export function updateReferralField(referralId, field, value) {
  return sb.rpc('update_referral_secure', {
    p_referral_id: referralId,
    p_field: field,
    p_value: String(value ?? ''),
  });
}

export function deleteReferralRecord(referralId) {
  return sb.from('referrals').delete().eq('id', referralId);
}

export function saveChpRecord(payload) {
  return sb.rpc('upsert_chp_secure', { payload });
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

