import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const iam = readFileSync('supabase/migrations/20260704_000009_iam_secure_rpcs.sql', 'utf8');
const rls = readFileSync('supabase/migrations/20260705_000010_iam_rls_hardening.sql', 'utf8');
const workflow = readFileSync('supabase/migrations/20260705_000015_referral_workflow_command_engine.sql', 'utf8');
const referralVisibility = readFileSync('supabase/migrations/20260707_000021_chp_referral_visibility_hotfix.sql', 'utf8');

test('secure IAM RPCs require super admin and reasons for controlled actions', () => {
  assert.match(iam, /assert_super_admin/);
  assert.match(iam, /require_iam_reason/);
  for (const action of ['approve_user_secure', 'reject_user_secure', 'suspend_user_secure', 'reactivate_user_secure', 'deactivate_user_secure']) {
    assert.match(iam, new RegExp(`CREATE OR REPLACE FUNCTION ${action}`));
  }
});

test('RLS hardening prevents direct user table writes by authenticated users', () => {
  assert.match(rls, /ALTER TABLE users ENABLE ROW LEVEL SECURITY/);
  assert.match(rls, /REVOKE INSERT, UPDATE, DELETE ON users FROM authenticated/);
  assert.match(rls, /users_no_direct_insert/);
  assert.match(rls, /users_no_direct_update/);
  assert.match(rls, /users_no_direct_delete/);
});

test('workflow command security covers unauthorized role, missing permissions, and wrong facility', () => {
  assert.match(workflow, /validate_referral_permission/);
  assert.match(workflow, /You do not have permission to perform this referral action/);
  assert.match(workflow, /validate_referral_owner/);
  assert.match(workflow, /Wrong facility for this referral action/);
});

test('workflow payload validation covers missing department, reason, outcome, and duplicate active referral', () => {
  assert.match(workflow, /Target department is required/);
  assert.match(workflow, /Reason is required for this referral action/);
  assert.match(workflow, /Outcome is required before completing a referral/);
  assert.match(workflow, /An active referral already exists for this patient identifier/);
});

test('CHP referral visibility is enforced by shared RLS/view predicate', () => {
  assert.match(referralVisibility, /CREATE OR REPLACE FUNCTION can_read_referral/);
  assert.match(referralVisibility, /role_name = 'chp'[\s\S]*p_created_by = auth\.uid\(\)/);
  assert.match(referralVisibility, /CREATE POLICY referrals_select[\s\S]*public\.can_read_referral\(facility_id, created_by\)/);
  assert.match(referralVisibility, /CREATE OR REPLACE VIEW referrals_secure[\s\S]*WHERE public\.can_read_referral\(r\.facility_id, r\.created_by\)/);
  assert.match(referralVisibility, /CREATE OR REPLACE VIEW dashboard_metrics[\s\S]*WHERE public\.can_read_referral\(facility_id, created_by\)/);
  assert.doesNotMatch(referralVisibility, /chp_id in/i);
});