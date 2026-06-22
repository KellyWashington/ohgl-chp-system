# Security and QA Test Plan

## Security Test Plan
- Verify HTTPS redirect and HSTS.
- Verify no patient data in localStorage.
- Verify Supabase anon key cannot bypass RLS.
- Verify password reset only sends reset email and does not disclose account existence beyond Supabase defaults.
- Verify logout clears session and prevents API reads.

## Penetration Checklist
- Auth brute-force/rate limit review.
- Broken object-level authorization by changing facility IDs.
- Stored XSS in patient, notes, facility, and CHP fields.
- Reflected XSS in search fields.
- CSRF review for authenticated actions.
- Sensitive data exposure in exports, console logs, network payloads.
- RLS bypass attempts with direct PostgREST calls.

## XSS Test Cases
- `<script>alert(1)</script>` in patient name should render inert text or sanitized output.
- `<img src=x onerror=alert(1)>` in clinical notes should remove event handler.
- `"><svg/onload=alert(1)>` in facility name should not execute.

## Authentication Test Cases
- Valid login succeeds.
- Invalid password fails.
- Disabled user cannot read data.
- Password reset email is sent.
- Session persists on refresh.
- Logout blocks dashboard access.

## Authorization Test Cases
- Viewer cannot create referrals.
- CHP can create referral but cannot delete facility.
- Clinician can update OPD status but cannot manage users.
- Facility Admin cannot read another facility.
- Super Admin can read all facilities.

## Database Failure Test Cases
- Supabase unavailable shows controlled error.
- Insert failure does not mutate local UI permanently.
- Duplicate slip number is rejected.
- RLS denial shows access denied.

## Backup Recovery Test Cases
- Restore latest daily backup to staging.
- PITR restore to timestamp before accidental deletion.
- Verify counts and audit logs after restore.
- Verify application can point at restored project.

## User Acceptance Test Cases
- Facility Admin creates facility CHP.
- CHP submits referral.
- Clinician marks referral attended.
- Admin reviews audit logs.
- Monthly report matches manual counts.
- Data export is redacted unless approved workflow is used.
