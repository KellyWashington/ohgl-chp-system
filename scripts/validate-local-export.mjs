#!/usr/bin/env node
// Validate the legacy browser JSON export before migration.
// Usage: node scripts/validate-local-export.mjs path/to/OHGL_CHP_Backup.json

import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/validate-local-export.mjs <legacy-export.json>');
  process.exit(2);
}

const errors = [];
const warnings = [];
const seenSlipNos = new Set();
let data;

try {
  data = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`Invalid JSON: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(data.facilities)) errors.push('Root object must include facilities[].');

for (const [fi, facility] of (data.facilities || []).entries()) {
  const label = `facilities[${fi}]`;
  if (!facility.name) errors.push(`${label}.name is required.`);
  if (!facility.location) errors.push(`${label}.location is required.`);
  if (!Array.isArray(facility.chps)) warnings.push(`${label}.chps missing; treating as empty.`);
  if (!Array.isArray(facility.referrals)) warnings.push(`${label}.referrals missing; treating as empty.`);

  for (const [ci, chp] of (facility.chps || []).entries()) {
    if (!chp.code) errors.push(`${label}.chps[${ci}].code is required.`);
    if (!chp.name) errors.push(`${label}.chps[${ci}].name is required.`);
  }

  for (const [ri, referral] of (facility.referrals || []).entries()) {
    const rlabel = `${label}.referrals[${ri}]`;
    if (!referral.id) errors.push(`${rlabel}.id/slip number is required.`);
    if (referral.id && seenSlipNos.has(referral.id)) errors.push(`Duplicate referral slip number: ${referral.id}`);
    if (referral.id) seenSlipNos.add(referral.id);
    if (!referral.date || Number.isNaN(Date.parse(referral.date))) errors.push(`${rlabel}.date must be a valid date.`);
    if (!referral.patient) errors.push(`${rlabel}.patient is required.`);
    if (!referral.chp_code) errors.push(`${rlabel}.chp_code is required.`);
    if (!['Routine', 'Urgent', 'Emergency'].includes(referral.priority)) errors.push(`${rlabel}.priority must be Routine, Urgent, or Emergency.`);
    if (referral.opd_status && !['Pending', 'Attended', 'DNA'].includes(referral.opd_status)) errors.push(`${rlabel}.opd_status is invalid.`);
  }
}

console.log(`Facilities: ${(data.facilities || []).length}`);
console.log(`Referrals: ${(data.facilities || []).flatMap(f => f.referrals || []).length}`);
console.log(`CHPs: ${(data.facilities || []).flatMap(f => f.chps || []).length}`);
for (const warning of warnings) console.warn(`WARNING: ${warning}`);

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log('Validation passed. Proceed with staged Supabase migration.');
