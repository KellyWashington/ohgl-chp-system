# Deployment and Operations

## Text Architecture Diagram

```text
[Browser]
  | HTTPS
[Vercel/Cloudflare Pages static React/Vite app]
  | Supabase JS over TLS
[Supabase Auth] ---- [Email provider]
  |
[Supabase PostgREST + RLS]
  |
[PostgreSQL: facilities, users, patients, referrals, chp_directory, appointments, audit_logs]
  |
[Automated backups + PITR + encrypted weekly export]

[Monitoring]
  | Sentry frontend errors
  | Supabase logs and database metrics
  | Uptime health check against frontend and Supabase REST endpoint
```

## Environment

Set `config.js` before deployment:

```js
window.OHGL_SUPABASE_URL = 'https://PROJECT.supabase.co';
window.OHGL_SUPABASE_ANON_KEY = 'public-anon-key';
```

## Monitoring

- Frontend errors: Sentry.
- API/database: Supabase logs and alerts.
- Health checks: `/` frontend availability and authenticated synthetic read in staging.
- Audit review: daily failed login and delete/update report.

## Recovery Procedure

1. Declare incident and freeze writes.
2. Identify last known-good timestamp.
3. Restore Supabase PITR to standby.
4. Run reconciliation queries.
5. Rotate Supabase anon/service keys if compromise suspected.
6. Point frontend environment to restored project.
7. Run smoke tests: login, dashboard, create referral, audit insert.
8. Communicate RTO/RPO outcome to facility admins.
