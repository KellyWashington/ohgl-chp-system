# Implementation Guide: Email Rate Limiting, Staff Invitation & Patient Received Audit

## Overview

This guide documents the fixes and enhancements deployed to address three critical issues:

1. **Email Rate Limit Errors on CHP Registration** - Server-side rate limiting
2. **Staff Invitation System** - Super Admin creation of clinicians/receptionists with email invitations
3. **Patient Received Audit Logging** - Comprehensive tracking with timestamps and audit records

---

## Issue #1: Email Rate Limit Exceeded Error on Registration

### Problem
CHP registrations were failing with "EMAIL RATE LIMIT EXCEEDED" errors. This was due to:
- Client-side rate limiting only (bypassable)
- No server-side validation
- Supabase default rate limits kicking in without custom logic

### Solution

#### Database Changes
New migration: `20260710_000022_fix_email_rate_limiting.sql`

**Tables Created:**
- `registration_attempts` - Tracks all registration attempts with status, IP, and user agent

**RPCs Created:**
- `check_registration_rate_limit(email, ip_address)` - Checks if email/IP is rate limited
- `log_registration_attempt(email, status, error_message, ip_address, user_agent)` - Logs attempts
- `get_my_registration_attempts()` - Users can view their own attempts

**Rate Limiting Rules:**
- **Email-based (1 hour):** Max 3 attempts per email per hour
- **Email-based (24 hours):** Max 5 attempts per email per 24 hours
- **IP-based (1 hour):** Max 10 attempts per IP per hour

#### Frontend Changes
File: `src/services/registrationRateLimitService.js`

**Key Functions:**
```javascript
export function checkRegistrationRateLimit(email, ipAddress = null)
export function logRegistrationAttempt(email, status, errorMessage, ipAddress, userAgent)
export function formatRateLimitError(result)
```

**Implementation in `authService.js`:**
```javascript
// Before signup, check rate limit
const rateLimitCheck = await checkRegistrationRateLimit(email);
if (rateLimitCheck.data?.is_rate_limited) {
  authAlert(rateLimitCheck.data.reason);
  await logRegistrationAttempt(email, 'rate_limited', rateLimitCheck.data.reason);
  return;
}

// After signup attempt
await logRegistrationAttempt(email, 'success');
```

### Deployment Steps

1. **Apply Database Migration:**
   ```bash
   # Apply 20260710_000022_fix_email_rate_limiting.sql in Supabase SQL Editor
   ```

2. **Deploy Frontend Updates:**
   - Push `src/services/registrationRateLimitService.js`
   - Update `src/services/authService.js` with rate limit checks

3. **Configure Supabase (Optional but Recommended):**
   In Supabase dashboard → Authentication → Settings:
   - Enable "Email confirmation required"
   - Set password policy to "At least 6 characters"
   - Enable rate limiting on Auth endpoints if available

### Testing

```javascript
// Test rate limiting
for (let i = 0; i < 4; i++) {
  await checkRegistrationRateLimit('test@example.com');
  // 4th attempt should return is_rate_limited: true
}

// Check your attempts
await getMyRegistrationAttempts();
```

---

## Issue #2: Staff Invitation System for Clinicians & Receptionists

### Problem
No way for super admin to create clinicians/receptionist staff. Users had to self-register and wait for approval. System needed:
- Super admin creates staff with email invitation
- Staff receives magic link with temporary token
- First login: staff sets their own password
- Auto-approval (no pending status)
- Role-based access (clinician, facility_officer/receptionist)

### Solution

#### Database Changes
New migration: `20260710_000020_staff_invitation_system.sql`

**Tables Created:**
- `staff_invitations` - Stores invitation state, tokens, and links to created users

**Columns:**
```sql
id (uuid, PK)
facility_id (uuid, FK to facilities)
email (text)
role (app_role: clinician, facility_officer, chp)
full_name (text)
phone (text)
invited_by (uuid, FK to users - super admin who invited)
invited_at (timestamptz)
accepted_at (timestamptz)
token_hash (text, UNIQUE) - SHA256 hash of invitation token
token_expires_at (timestamptz) - 7 days
accepted (boolean)
created_user_id (uuid, FK to users)
```

**Constraints:**
- Valid roles: `clinician`, `facility_officer` (receptionist), `chp`
- Unique constraint: `(email, facility_id)`
- Invitation tokens expire after 7 days

**RPCs Created:**
- `invite_staff_secure(payload)` - Create invitation
- `accept_staff_invitation_secure(token, password)` - Accept & create user
- `handle_staff_invitation_on_auth_user()` - Trigger for auto-linking

### Workflow

#### Step 1: Super Admin Invites Staff

**Frontend Code:**
```javascript
import { inviteStaffMember } from './services/staffInvitationService.js';

const payload = {
  facility_id: 'uuid-of-facility',
  email: 'clinician@hospital.com',
  role: 'clinician', // or 'facility_officer'
  full_name: 'Dr. Jane Smith',
  phone: '+254712345678'
};

const { data, error } = await inviteStaffMember(payload);

if (data) {
  const invitationToken = data.token; // Share with staff via email
  const expiresAt = data.expires_at;
  console.log(`Invitation created. Token: ${invitationToken}`);
}
```

**Backend Logic:**
- Validates super admin role
- Validates facility exists
- Checks no active invitation already exists
- Generates 32-byte random token
- Stores SHA256 hash (never stores raw token)
- Returns token once (only at creation)
- Logs to `user_access_audit`

#### Step 2: Send Email to Staff

**Email Template:**
```
Subject: You've been invited to [Facility Name]

Hello [Full Name],

You've been invited to join [Facility Name] as a [Role].

Click the link below to accept your invitation and set your password:

https://ohgl-chp-system.vercel.app/accept-invitation?token=[INVITATION_TOKEN]

This link expires in 7 days.

If you didn't expect this invitation, contact [Super Admin Name].
```

**Implementation:**
```javascript
// In your email service (future enhancement)
const emailPayload = {
  to: data.email,
  subject: `You're invited to ${facility.name}`,
  template: 'staff_invitation',
  data: {
    full_name: data.full_name,
    facility_name: facility.name,
    invitation_link: `${APP_URL}/accept-invitation?token=${data.token}`,
    expires_at: data.expires_at
  }
};
await sendEmail(emailPayload);
```

#### Step 3: Staff Accepts Invitation & Sets Password

**Frontend Code (New Page: `acceptInvitation.html`):**
```javascript
import { sb } from './services/supabaseClient.js';
import { acceptStaffInvitation } from './services/staffInvitationService.js';

// Extract token from URL
const urlParams = new URLSearchParams(window.location.search);
const invitationToken = urlParams.get('token');

// User fills form with email and password
const email = document.getElementById('email').value;
const password = document.getElementById('password').value;

// Sign up with invitation token in metadata
const { data, error } = await sb.auth.signUp({
  email,
  password,
  options: {
    data: {
      invitation_token: invitationToken
    },
    emailRedirectTo: location.origin + '/dashboard'
  }
});

if (!error) {
  // Trigger will auto-accept invitation and create user profile
  // User is now approved and can log in
  alert('Welcome! Your account has been created. Please log in.');
}
```

**Backend Trigger: `handle_staff_invitation_on_auth_user()`**
- Validates invitation token exists and hasn't expired
- Creates `users` record with:
  - `facility_id` from invitation
  - `role` from invitation
  - `approval_status = 'approved'` (auto-approved)
  - `active = true`
- Links invitation to created user
- Logs action to audit

### Frontend Service API

File: `src/services/staffInvitationService.js`

```javascript
// Invite staff member
inviteStaffMember(payload) // Returns {token, invitation_id, expires_at}

// Accept invitation during signup
acceptStaffInvitation(token, password) // Returns {success, message}

// List invitations for facility
getStaffInvitations(facilityId) // Returns all invitations
getPendingStaffInvitations(facilityId) // Returns pending only

// Revoke invitation (soft delete)
revokeStaffInvitation(invitationId) // Sets token_expires_at = now()

// Resend invitation (future)
resendStaffInvitation(invitationId)
```

### Permissions & RLS

**Who can invite staff:**
- Only `super_admin` role can call `invite_staff_secure`

**Who can see invitations:**
- Super admin: all invitations
- Facility managers: invitations for their facility

**RLS Policies:**
```sql
-- Select: super_admin OR facility manager of facility
-- Insert/Update/Delete: false (only via RPC)
```

### Deployment Steps

1. **Apply Database Migration:**
   ```bash
   # Apply 20260710_000020_staff_invitation_system.sql
   ```

2. **Deploy Frontend Services:**
   - Push `src/services/staffInvitationService.js`
   - Update settings/IAM page to include "Invite Staff" button
   - Create `src/pages/acceptInvitation.js` for invitation acceptance flow

3. **Configure Email Service (Future):**
   - Implement email sending in `MessagingService` or external service
   - Use template with invitation token

### Testing

```javascript
// Test 1: Invite clinician
const { data, error } = await inviteStaffMember({
  facility_id: 'facility-uuid',
  email: 'dr.smith@hospital.com',
  role: 'clinician',
  full_name: 'Dr. Jane Smith',
  phone: '+254712345678'
});
console.log('Invitation token:', data.token);

// Test 2: List pending invitations
const { data: pending } = await getPendingStaffInvitations('facility-uuid');
console.log('Pending invitations:', pending);

// Test 3: Verify user auto-created after signup
// User should have:
// - approval_status = 'approved'
// - active = true
// - facility_id from invitation
// - role from invitation
```

---

## Issue #3: Patient Received Audit Logging

### Problem
No audit trail when clinicians mark patients as "Received". System needed to track:
- Who marked patient as received
- When (exact timestamp, date, time, day)
- Which patient/referral
- Optional notes
- Full audit trail for compliance

### Solution

#### Database Changes
New migration: `20260710_000021_patient_received_audit.sql`

**Tables Created:**
- `patient_received_audit` - Immutable audit log

**Columns:**
```sql
id (uuid, PK)
referral_id (uuid, FK to referrals)
facility_id (uuid, FK to facilities)
received_by_user_id (uuid, FK to users)
received_by_name (text)
received_by_role (app_role)
received_at (timestamptz) - exact timestamp
received_date (date) - just the date
received_time (time) - just the time
day_of_week (text) - 'Monday', 'Tuesday', etc.
notes (text) - optional notes from clinician
created_at (timestamptz)
```

**Indexes:**
```sql
referral_id - query by referral
facility_id - facility reports
received_by_user_id - user's received patients
received_at (DESC) - recent first
received_date (DESC) - date-based reports
```

**Views Created:**
- `patient_received_audit_report` - Joins with referrals and facilities for reporting

**RPCs Created:**
- `mark_patient_received_secure(referral_id, notes)` - Mark received + audit

### Workflow

#### Step 1: Clinician Marks Patient as Received

**Frontend Code:**
```javascript
import { markPatientReceived } from './services/patientReceivedService.js';

const { data, error } = await markPatientReceived(
  referral_id,
  'Patient arrived at OPD desk, vitals normal' // optional notes
);

if (!error) {
  console.log('Patient marked as received at:', data.received_at);
  console.log('Audit ID:', data.audit_id);
  // Refresh referral display
}
```

#### Step 2: RPC Handles Marking + Audit

**Backend Logic in `mark_patient_received_secure`:**
```sql
1. Validate:
   - User is authenticated
   - Referral exists
   - User has facility access (same_facility check)
   - User has permission ('referral:update')

2. Update:
   - SET referrals.opd_status = 'Received'
   - SET referrals.updated_at = now()

3. Log to patient_received_audit:
   - received_by_user_id = current user
   - received_by_name = user.full_name
   - received_by_role = user.role
   - received_at = now() (full timestamp)
   - received_date = CURRENT_DATE
   - received_time = CURRENT_TIME
   - day_of_week = to_char(now(), 'Day')
   - notes = provided text

4. Write to audit_logs:
   - action = 'patient_received'
   - changes: {old_status, new_status, received_at}
```

### Frontend Service API

File: `src/services/patientReceivedService.js`

```javascript
// Mark patient as received
markPatientReceived(referralId, notes) // Returns audit record

// Query audit logs
getPatientReceivedAudit(limit, offset)
getPatientReceivedAuditByFacility(facilityId, limit, offset)
getPatientReceivedAuditByUser(userId, limit, offset)
getPatientReceivedAuditByDate(startDate, endDate, facilityId)

// Export for reports
exportPatientReceivedAudit(filters)
```

### Audit Report View

**Query Example:**
```javascript
// Get all patients received today
const { data, error } = await getPatientReceivedAuditByDate(
  '2026-07-09',
  '2026-07-09',
  facilityId
);

// Result includes:
// - slip_no (referral number)
// - received_by_name
// - received_by_role
// - received_at (full timestamp)
// - received_date
// - received_time
// - day_of_week
// - hours_to_receive (time from referral date)
// - notes
```

### Permissions & RLS

**Who can mark patients as received:**
- Users with `referral:update` permission
- Clinicians, facility officers, super admin
- Must have access to the facility

**Who can view audit:**
- Super admin: all facilities
- Facility staff: their facility only
- Logged user can view their own actions via `received_by_user_id`

**RLS Policies:**
```sql
-- Select: same_facility(facility_id) AND has_permission('referral:read')
-- Insert/Update/Delete: false (only via RPC)
```

### Deployment Steps

1. **Apply Database Migration:**
   ```bash
   # Apply 20260710_000021_patient_received_audit.sql
   ```

2. **Deploy Frontend Services:**
   - Push `src/services/patientReceivedService.js`
   - Update referral detail page with "Mark as Received" button
   - Create audit report view in dashboard or reports page

3. **Update Referral Workflow UI:**
   - Add button to mark patient as received
   - Show confirmation dialog
   - Display "Marked as received at [timestamp]" on success

### Testing

```javascript
// Test 1: Mark patient as received
const { data, error } = await markPatientReceived(
  'referral-uuid',
  'Patient stable, ready for OPD assessment'
);
console.log('Audit record:', data);

// Test 2: Query today's received patients
const { data: today } = await getPatientReceivedAuditByDate(
  new Date().toISOString().split('T')[0],
  new Date().toISOString().split('T')[0],
  facilityId
);
console.log('Received today:', today.length);

// Test 3: Verify audit log entry
const { data: auditLogs } = await fetchUserAccessAudit();
const patientReceivedAction = auditLogs.find(a => a.action === 'patient_received');
console.log('Audit logged:', patientReceivedAction);
```

---

## Deployment Checklist

### Phase 1: Database (Production Backup First!)
- [ ] Backup production database
- [ ] Apply all three migrations in order:
  1. `20260710_000020_staff_invitation_system.sql`
  2. `20260710_000021_patient_received_audit.sql`
  3. `20260710_000022_fix_email_rate_limiting.sql`
- [ ] Verify migrations ran without errors
- [ ] Test RPC calls in Supabase SQL editor

### Phase 2: Frontend
- [ ] Deploy updated `src/services/authService.js`
- [ ] Deploy new service files:
  - `src/services/staffInvitationService.js`
  - `src/services/patientReceivedService.js`
  - `src/services/registrationRateLimitService.js`
- [ ] Update settings/IAM page for staff invitation
- [ ] Add "Mark as Received" button to referral detail
- [ ] Create audit report view

### Phase 3: Testing
- [ ] Test CHP registration with rate limiting
- [ ] Test staff invitation flow (invite → email → signup → auto-approve)
- [ ] Test patient received audit logging
- [ ] Verify audit reports query correctly
- [ ] Test permission checks (RLS)

### Phase 4: Documentation & Monitoring
- [ ] Update user documentation
- [ ] Train super admins on staff invitation
- [ ] Set up Sentry/monitoring for errors
- [ ] Monitor registration rate limit metrics

---

## Configuration Notes

### Supabase Settings (Recommended)

**Authentication:**
- Email confirmation: Enable
- Password policy: Minimum 6 characters
- Reset password duration: 24 hours

**Database:**
- Enable automatic backups
- PITR: 7 days minimum
- Monitoring: Enable query performance insights

---

## Monitoring & Metrics

### Rate Limiting Metrics
```sql
SELECT 
  status,
  COUNT(*) as count,
  COUNT(DISTINCT email) as unique_emails,
  COUNT(DISTINCT ip_address) as unique_ips
FROM registration_attempts
WHERE attempted_at > now() - INTERVAL '24 hours'
GROUP BY status;
```

### Staff Invitation Metrics
```sql
SELECT 
  role,
  COUNT(*) as total_invitations,
  COUNT(CASE WHEN accepted THEN 1 END) as accepted,
  COUNT(CASE WHEN NOT accepted AND token_expires_at > now() THEN 1 END) as pending_valid,
  COUNT(CASE WHEN NOT accepted AND token_expires_at <= now() THEN 1 END) as expired
FROM staff_invitations
GROUP BY role;
```

### Patient Received Metrics
```sql
SELECT 
  received_date,
  day_of_week,
  COUNT(*) as patients_received,
  AVG(EXTRACT(EPOCH FROM (received_at - referral_date)) / 3600)::INT as avg_hours_to_receive
FROM patient_received_audit_report
WHERE received_date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY received_date, day_of_week
ORDER BY received_date DESC;
```

---

## Future Enhancements

1. **Email Integration:**
   - Implement email sending for staff invitations
   - Automated password reset emails
   - Digest reports of patient received metrics

2. **Staff Management:**
   - Bulk invite staff via CSV
   - Invitation resend functionality
   - Role change without re-invitation

3. **Audit Dashboard:**
   - Real-time patient received metrics
   - SLA compliance tracking
   - Export audit logs to PDF/Excel

4. **Rate Limiting:**
   - Configurable limits per environment
   - Whitelist support for testing
   - Webhook notifications for suspicious patterns

---

## Support & Troubleshooting

### Issue: "Rate limit exceeded" on registration
**Solution:**
- Check `registration_attempts` table: `SELECT * FROM registration_attempts WHERE email = 'user@example.com' ORDER BY attempted_at DESC LIMIT 10;`
- Reset if needed (development only): `DELETE FROM registration_attempts WHERE email = 'user@example.com';`

### Issue: Staff invitation token invalid
**Solution:**
- Verify token hasn't expired: `SELECT token_expires_at FROM staff_invitations WHERE id = '...';`
- Check token_hash is correctly hashed: `SELECT encode(digest('token_value', 'sha256'), 'hex');`

### Issue: Patient received not logging
**Solution:**
- Verify RLS policies: `SELECT * FROM pg_policies WHERE tablename = 'patient_received_audit';`
- Check permissions: `SELECT role_permissions('clinician');`
- Verify facility_id matches: Check `users.facility_id` of marking user

---

**Last Updated:** 2026-07-10
**Version:** 1.0
**Author:** OCHP Development Team
