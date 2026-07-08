import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

global.window = { OHGL_SUPABASE_URL: '', OHGL_SUPABASE_ANON_KEY: '' };
const { sanitizeReferralPayload } = await import('../../src/services/dataService.js');

const newReferral = readFileSync('src/pages/newReferral.js', 'utf8');
const dataService = readFileSync('src/services/dataService.js', 'utf8');
const indexHtml = readFileSync('index.html', 'utf8');

test('final referral payload contains no client referral number fields', () => {
  const payload = sanitizeReferralPayload({
    slip_no: 'OHGL-2026-000001',
    slipNo: 'OHGL-2026-000002',
    referralNo: 'OHGL-2026-000003',
    referral_number: 'OHGL-2026-000004',
    patient_name: 'Amina Patient',
    priority: 'Routine',
    undefined_field: undefined,
    empty_field: '',
  });

  assert.deepEqual(payload, {
    patient_name: 'Amina Patient',
    priority: 'Routine',
  });
});

test('createReferralRecord sanitizes immediately before Supabase RPC', () => {
  assert.match(dataService, /function createReferralRecord\(originalPayload\)/);
  assert.match(dataService, /const payload = sanitizeReferralPayload\(originalPayload\)/);
  assert.match(dataService, /console\.group\('Referral Payload'\)/);
  assert.match(dataService, /sb\.rpc\('create_referral_secure', \{ payload \}\)/);
  const rpcBlock = dataService.match(/function createReferralRecord[\s\S]*?sb\.rpc\('create_referral_secure'[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(rpcBlock, /safePayload/);
});

test('draft recovery and autosave cannot reintroduce referral number fields', () => {
  const readCurrentFormBlock = newReferral.match(/function readCurrentForm\(\) \{[\s\S]*?\n\}/)[0];
  const applyDraftBlock = newReferral.match(/function applyDraft\(data\) \{[\s\S]*?markReferralClean\(\);\n\}/)[0];
  const draftSaveBlock = newReferral.match(/DraftEngine\.register\(\{[\s\S]*?clear: \(\) => clearReferralDraft\(\),\n    \}\);/)[0];

  for (const block of [readCurrentFormBlock, applyDraftBlock, draftSaveBlock]) {
    assert.doesNotMatch(block, /slip_no|slipNo|referralNo|referral_number/);
  }
});

test('form reset and create another referral keep placeholder only', () => {
  const resetBlock = newReferral.match(/function resetReferralForm\([\s\S]*?\n\}/)[0];
  const createAnotherBlock = newReferral.match(/label: 'Create Another Referral',[\s\S]*?showPage\('new_referral'/)[0];

  assert.match(indexHtml, /id="slip-no-display">Will be generated after submission/);
  assert.match(resetBlock, /slipNo\.textContent = 'Will be generated after submission'/);
  assert.match(createAnotherBlock, /resetReferralForm\(\{ preserveFacility: true, focus: true/);
  assert.doesNotMatch(resetBlock, /OHGL-|slip_no|referralNo|referral_number/);
});

test('returned backend slip number is displayed only after success', () => {
  const submitBlock = newReferral.match(/export async function submitReferral\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(submitBlock, /const generatedSlipNo = data\.slip_no/);
  assert.match(submitBlock, /slip\.id = generatedSlipNo/);
  assert.match(submitBlock, /slipNo: slip\.id/);
  assert.doesNotMatch(submitBlock, /OHGL-2026|nextReferral|generateReferral/);
});
