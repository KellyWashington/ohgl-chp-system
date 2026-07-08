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
const productionReferralHotfix = readFileSync('supabase/migrations/20260707_000023_production_referral_hotfix.sql', 'utf8');
const referralFacilitiesRpc = readFileSync('supabase/migrations/20260707_000024_referral_facilities_rpc.sql', 'utf8');
const chpDirectoryHotfix = readFileSync('supabase/migrations/20260707_000025_chp_directory_visibility_hotfix.sql', 'utf8');
const dataService = readFileSync('src/services/dataService.js', 'utf8');
const rbac = readFileSync('src/services/rbac.js', 'utf8');

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
  assert.match(reports, /function normalizeStatus/);
  assert.match(reports, /referral\.workflow_status \|\| referral\.referral_status \|\| referral\.opd_status \|\| referral\.status/);
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
  assert.match(indexHtml, /Will be generated after submission/);
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
test('production referral hotfix blocks client slip numbers and keeps concurrent inserts unique', () => {
  assert.match(dataService, /sanitizeReferralPayload/);
  assert.match(dataService, /REFERRAL_NUMBER_FIELDS/);
  assert.match(dataService, /referral_number/);
  assert.match(dataService, /sb\.rpc\('create_referral_secure', \{ payload \}\)/);
  assert.match(productionReferralHotfix, /RETURNS referrals_secure/);
  assert.match(productionReferralHotfix, /IF jsonb_exists\(payload,\s*'slip_no'\)/);
  assert.match(productionReferralHotfix, /Client supplied referral number is not allowed\./);
  assert.match(productionReferralHotfix, /public\.next_referral_slip_no\(\)/);
  assert.match(productionReferralHotfix, /pg_advisory_xact_lock/);
  assert.match(productionReferralHotfix, /LOOP[\s\S]*candidate := 'OHGL-/);
  assert.match(productionReferralHotfix, /EXCEPTION WHEN unique_violation/);
  assert.match(productionReferralHotfix, /attempts >= 5/);
  assert.doesNotMatch(productionReferralHotfix, /payload->>'slip_no'/);
});
test('reports resolve facility names from loaded facilities before fallback and exports use normalized detail rows', () => {
  assert.match(main, /facilityLookup\.get\(r\.facility_id\)\?\.name \|\| r\.referral_facility_name \|\| r\.referral_facility \|\| 'Unknown Facility'/);
  assert.match(reports, /function facilityNameFor/);
  assert.match(reports, /byOriginFacility\?\.name \|\| referral\.referral_facility_name \|\| referral\.referral_facility \|\| 'Unknown Facility'/);
  assert.match(reports, /function destinationNameFor/);
  assert.match(reports, /byDestination\?\.name \|\| referral\.referral_facility_name \|\| referral\.referral_facility \|\| facilityNameFor\(referral\)/);
  assert.match(reports, /function compileRegister/);
  assert.match(reports, /Origin Facility/);
  assert.match(reports, /Destination Facility/);
  assert.match(reports, /function exportRows/);
  assert.match(reports, /facilityNameFor\(r\)/);
  assert.match(reports, /destinationNameFor\(r\)/);
  assert.doesNotMatch(reports, /referral\.referral_facility \|\| byReferralFacility/);
  assert.doesNotMatch(main, /r\.referral_facility_name \|\| facilityLookup\.get\(r\.referral_facility_id\)/);
});

test('referral facility dropdown loads from secure RPC and handles empty or denied access', () => {
  assert.match(dataService, /sb\.rpc\('list_referral_facilities_secure'\)/);
  assert.match(referralFacilitiesRpc, /CREATE OR REPLACE FUNCTION public\.list_referral_facilities_secure\(\)/);
  assert.match(referralFacilitiesRpc, /RETURNS TABLE[\s\S]*id uuid[\s\S]*name text[\s\S]*location text[\s\S]*subcounty text[\s\S]*level text[\s\S]*email text[\s\S]*phone text[\s\S]*year integer[\s\S]*active boolean/);
  assert.match(referralFacilitiesRpc, /f\.financial_year AS year/);
  assert.match(referralFacilitiesRpc, /public\.has_permission\('facility:read'\)/);
  assert.match(referralFacilitiesRpc, /public\.has_permission\('referral:create'\)/);
  assert.match(referralFacilitiesRpc, /GRANT EXECUTE ON FUNCTION public\.list_referral_facilities_secure\(\) TO authenticated/);
  assert.match(dataService, /lastFacilityLoadError = secure\.error/);
  assert.match(dataService, /return \{ data: \[\], error: null \}/);
  assert.match(newReferral, /No referral facilities available\./);
  assert.match(newReferral, /Facility lookup failed; refresh or retry/);
  assert.match(newReferral, /facSel\.disabled = !activeFacilities\.length/);
});
test('CHP directory view includes seeded rows and approved CHP users without duplicates', () => {
  assert.match(dataService, /sb\.from\('chp_directory_secure'\)\.select\('\*'\)/);
  assert.match(chpDirectoryHotfix, /CREATE OR REPLACE VIEW public\.chp_directory_secure AS/);
  assert.match(chpDirectoryHotfix, /FROM chp_directory c/);
  assert.match(chpDirectoryHotfix, /phi_decrypt\(c\.full_name_ciphertext\) AS full_name/);
  assert.match(chpDirectoryHotfix, /approved_user_chps AS/);
  assert.match(chpDirectoryHotfix, /u\.role::text = 'chp'/);
  assert.match(chpDirectoryHotfix, /u\.approval_status::text = 'approved'/);
  assert.match(chpDirectoryHotfix, /u\.active = true/);
  assert.match(chpDirectoryHotfix, /u\.facility_id IS NOT NULL/);
  assert.match(chpDirectoryHotfix, /NOT EXISTS \([\s\S]*WHERE c\.user_id = u\.id[\s\S]*\)/);
  assert.match(chpDirectoryHotfix, /UNION ALL/);
  assert.match(chpDirectoryHotfix, /WHERE public\.same_facility\(facility_id\)/);
  assert.match(chpDirectoryHotfix, /GRANT SELECT ON public\.chp_directory_secure TO authenticated/);
});
test('reporting module v1 supports operational reports, filters, exports, and pagination', () => {
  for (const report of ['register', 'chp', 'facility', 'department', 'executive', 'timeline']) {
    assert.match(indexHtml, new RegExp(`value="${report}"`));
  }
  for (const filter of ['r-facility', 'r-department', 'r-chp', 'r-status', 'r-priority', 'r-sha', 'r-emergency', 'r-search']) {
    assert.match(indexHtml, new RegExp(`id="${filter}"`));
  }
  assert.match(reports, /const PAGE_SIZE = 50/);
  assert.match(reports, /function filterReferrals/);
  assert.match(reports, /function compileRegister/);
  assert.match(reports, /function compileChp/);
  assert.match(reports, /function compileFacility/);
  assert.match(reports, /function compileDepartment/);
  assert.match(reports, /function compileExecutive/);
  assert.match(reports, /function compileTimeline/);
  assert.match(reports, /reportState\.lastRows/);
  assert.match(reports, /Oasis Healthcare Group/);
  assert.match(reports, /Generated Date\/Time/);
  assert.match(reports, /\\uFEFF/);
  assert.match(reports, /application\/vnd\.ms-excel/);
  assert.match(reports, /window\.print\(\)/);
  assert.match(reports, /Export failed\. Please retry\./);
  assert.match(reports, /currentProfile\?\.role === 'chp'/);
  assert.match(rbac, /report: \['super_admin', 'facility_manager', 'facility_officer', 'clinician', 'chp'\]/);
});

