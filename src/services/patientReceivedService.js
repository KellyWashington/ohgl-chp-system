import { sb } from './supabaseClient.js';

/**
 * Patient Received Service
 * Handles marking patients as received and audit logging
 */

export function markPatientReceived(referralId, notes = '') {
  return sb.rpc('mark_patient_received_secure', {
    referral_id: referralId,
    notes: notes
  });
}

export function getPatientReceivedAudit(limit = 50, offset = 0) {
  return sb.from('patient_received_audit_report')
    .select('*')
    .order('received_at', { ascending: false })
    .range(offset, offset + limit - 1);
}

export function getPatientReceivedAuditByFacility(facilityId, limit = 50, offset = 0) {
  return sb.from('patient_received_audit_report')
    .select('*')
    .eq('facility_id', facilityId)
    .order('received_at', { ascending: false })
    .range(offset, offset + limit - 1);
}

export function getPatientReceivedAuditByUser(userId, limit = 50, offset = 0) {
  return sb.from('patient_received_audit_report')
    .select('*')
    .eq('received_by_user_id', userId)
    .order('received_at', { ascending: false })
    .range(offset, offset + limit - 1);
}

export function getPatientReceivedAuditByDate(startDate, endDate, facilityId = null) {
  let query = sb.from('patient_received_audit_report')
    .select('*')
    .gte('received_date', startDate)
    .lte('received_date', endDate);
  
  if (facilityId) {
    query = query.eq('facility_id', facilityId);
  }
  
  return query.order('received_at', { ascending: false });
}

export function exportPatientReceivedAudit(filters = {}) {
  // Helper to prepare audit data for export
  // Actual export handled in UI layer
  return sb.from('patient_received_audit_report')
    .select('*')
    .eq(filters.facility_id ? 'facility_id' : 'received_by_user_id', 
        filters.facility_id || filters.user_id)
    .order('received_at', { ascending: false });
}
