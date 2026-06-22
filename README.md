# ODSL Siaya - CHP Engagement & Referral Tracking System

Oasis Doctors Siaya Limited | ODSL-SIAYA-CHP-2026

A web-based Community Health Promoter referral tracking system for Oasis Healthcare Group Limited.

## Production Security Baseline

- Supabase Auth email/password login, password reset, session restore, and logout.
- Role-based access model for Super Admin, Facility Admin, Clinician, CHP, and Viewer.
- Supabase/PostgreSQL is the primary data store. Browser localStorage is not used for patient data.
- PHI fields are encrypted at rest via Supabase/PostgreSQL `pgcrypto` secure RPCs and decrypted only through authorized views.
- DOMPurify sanitization is enforced for legacy HTML rendering.
- Audit logging is implemented for login/logout and record changes.

## Implementation Artifacts

- Database schema and RLS: `supabase/schema.sql`
- Production readiness pack: `docs/PRODUCTION_READINESS.md`
- Migration plan: `docs/MIGRATION_PLAN.md`
- Security and QA plan: `docs/TEST_PLAN.md`
- Deployment and operations: `docs/DEPLOYMENT_OPERATIONS.md`

## Deployment

Configure `config.js` before deployment:

```js
window.OHGL_SUPABASE_URL = 'https://PROJECT.supabase.co';
window.OHGL_SUPABASE_ANON_KEY = 'public-anon-key';
```

Host the frontend on a HTTPS cloud static host and apply `supabase/schema.sql` to the Supabase project.

