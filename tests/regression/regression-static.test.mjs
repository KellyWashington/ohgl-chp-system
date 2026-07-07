import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync('src/main.js', 'utf8');
const tracker = readFileSync('src/pages/tracker.js', 'utf8');
const dashboard = readFileSync('src/pages/dashboard.js', 'utf8');
const reports = readFileSync('src/pages/report.js', 'utf8');
const newReferral = readFileSync('src/pages/newReferral.js', 'utf8');
const indexHtml = readFileSync('index.html', 'utf8');
const workflowMigration = readFileSync('supabase/migrations/20260705_000015_referral_workflow_command_engine.sql', 'utf8');
const slipHotfixMigration = readFileSync('supabase/migrations/20260707_000020_referral_slip_number_hotfix.sql', 'utf8');

test('core data refresh still reads secure views', () => {
  assert.match(main, /fetchCoreData/);
  assert.match(readFileSync('src/services/dataService.js', 'utf8'), /referrals_secure/);
  assert.match(readFileSync('src/services/dataService.js', 'utf8'), /chp_directory_secure/);
});

test('tracker workflow status is rendered read-only and actions use workflow service', () => {
  assert.match(tracker, /workflowActionService\.loadAvailableActions/);
  assert.match(tracker, /executeReferralWorkflowAction/);
  assert.doesNotMatch(tracker, /<select class="ss"[^>]+workflow_status/);
});

test('dashboard and reports retain referral status aggregation paths', () => {
  assert.match(dashboard, /workflow_status \|\| r\.status/);
  assert.match(reports, /workflow_status \|\| r\.status/);
});


test('referral slip numbers are database generated only', () => {
  const referralPayload = newReferral.match(/const payload = \{[\s\S]*?createReferralRecord/)[0];
  assert.doesNotMatch(referralPayload, /slip_no:\\s*/);
  assert.doesNotMatch(newReferral, /makeReferralNumber/);
  assert.match(workflowMigration, /CREATE OR REPLACE FUNCTION next_referral_slip_no/);
  assert.match(workflowMigration, /pg_advisory_xact_lock/);
  assert.match(workflowMigration, /REVOKE EXECUTE ON FUNCTION next_referral_slip_no\(\) FROM PUBLIC/);
  assert.match(workflowMigration, /public\.next_referral_slip_no\(\)/);
  assert.match(slipHotfixMigration, /jsonb_exists\(payload, 'slip_no'\)/);
});

test('referral creation shows success modal with follow-up actions', () => {
  assert.match(indexHtml, /id="referral-success-modal"/);
  assert.match(indexHtml, /View My Referrals/);
  assert.match(indexHtml, /Create Another Referral/);
  assert.match(newReferral, /showReferralSuccessModal/);
  assert.match(newReferral, /slipNo: slip\.id/);
  assert.doesNotMatch(newReferral, /my-referrals-alert/);
});
test('referral submission prevents double clicks and avoids full data reload on success', () => {
  assert.match(indexHtml, /id="submit-referral-btn"/);
  assert.match(indexHtml, /submit-referral-spinner/);
  assert.match(newReferral, /isSubmittingReferral/);
  assert.match(newReferral, /setReferralSubmitting\(true\)/);
  assert.match(newReferral, /Submitting Referral\.\.\./);
  const successBlock = newReferral.match(/clearReferralDraft\(\);[\s\S]*?showReferralSuccessModal/)[0];
  assert.doesNotMatch(successBlock, /refreshDB\(/);
});

test('referral draft recovery is user and browser scoped', () => {
  assert.match(indexHtml, /id="referral-draft-modal"/);
  assert.match(indexHtml, /Resume Draft/);
  assert.match(indexHtml, /Discard Draft/);
  assert.match(indexHtml, /Start New Referral/);
  assert.match(newReferral, /DRAFT_TTL_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(newReferral, /DRAFT_PREFIX/);
  assert.match(newReferral, /browserId/);
  assert.match(newReferral, /userId: currentUser\.id/);
  assert.match(newReferral, /draft\.userId !== currentUser\?\.id/);
  assert.match(newReferral, /draft\.browserId !== getBrowserId\(\)/);
});

test('referral private state is cleared during auth lifecycle changes', () => {
  const main = readFileSync('src/main.js', 'utf8');
  const auth = readFileSync('src/services/authService.js', 'utf8');
  assert.match(main, /clearReferralPrivateState\(\{ clearCurrentDraft: true, resetPrompt: true \}\)/);
  assert.match(auth, /window\.clearReferralPrivateState\?\.\(\{ clearCurrentDraft: true, resetPrompt: true \}\)/);
  assert.match(newReferral, /clearReferralStorageForUser/);
  assert.match(newReferral, /sessionStorage/);
});