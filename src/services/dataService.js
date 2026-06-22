import { sb } from './supabaseClient.js';

export function fetchCoreData() {
  return Promise.all([
    sb.from('facilities').select('*').order('location'),
    sb.from('chp_directory_secure').select('*').order('code'),
    sb.from('referrals_secure').select('*').order('created_at', { ascending: true }),
  ]);
}

export function fetchUserProfile(userId) {
  return sb.from('users').select('*').eq('id', userId).single();
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
  return sb.from('audit_logs').select('created_at,action,table_name,record_id,actor_id,changes').order('created_at', { ascending: false }).limit(limit);
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
