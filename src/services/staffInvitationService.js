import { sb } from './supabaseClient.js';

/**
 * Staff Invitation Service
 * Handles creation and management of staff invitations for clinicians and receptionists
 */

export function inviteStaffMember(payload) {
  return sb.rpc('invite_staff_secure', { payload });
}

export function acceptStaffInvitation(token, password) {
  return sb.rpc('accept_staff_invitation_secure', { token, password });
}

export function getStaffInvitations(facilityId) {
  return sb.from('staff_invitations')
    .select('id,email,role,full_name,phone,invited_at,accepted,token_expires_at')
    .eq('facility_id', facilityId)
    .order('invited_at', { ascending: false });
}

export function getPendingStaffInvitations(facilityId) {
  return sb.from('staff_invitations')
    .select('id,email,role,full_name,phone,invited_at,token_expires_at')
    .eq('facility_id', facilityId)
    .eq('accepted', false)
    .gt('token_expires_at', new Date().toISOString())
    .order('invited_at', { ascending: false });
}

export function revokeStaffInvitation(invitationId) {
  // Soft delete by marking token as expired
  return sb.from('staff_invitations')
    .update({ token_expires_at: new Date() })
    .eq('id', invitationId);
}

export function resendStaffInvitation(invitationId) {
  // Implementation would regenerate token and resend email
  // For now, documented for future enhancement
  return Promise.resolve({ 
    success: true, 
    message: 'Email resend functionality coming soon' 
  });
}
