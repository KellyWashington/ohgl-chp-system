# Migration Plan

1. Freeze browser-only system and export current JSON backup.
2. Validate JSON structure: facilities, CHPs, referrals, required fields, duplicate slip numbers.
3. Apply supabase/schema.sql.
4. Configure pp.phi_key with a 32+ byte random value from the approved secret manager before inserting PHI.
5. Create Supabase Auth users and matching rows in `users` with roles/facilities.
6. Import facilities first, preserving a legacy ID map.
7. Import CHPs through `upsert_chp_secure` with `facility_id` remapped to UUID.
8. Import patients through encrypted columns/RPC workflow from unique referral patient fields where available.
9. Import referrals through `create_referral_secure` with validated dates, categories, OPD statuses, and priorities.
10. Insert migration audit record for every batch.
11. Run reconciliation: counts by facility, month, CHP, OPD status, emergency count.
12. Disable JSON import in production UI.
13. Run UAT and authorization tests using real facility roles.

Rejected-row handling: write rejected records to encrypted CSV with reason, fix source data, re-run idempotent import.

Rollback: keep original static app read-only, restore pre-migration Supabase snapshot if reconciliation fails.

