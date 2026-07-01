import { DB, fac, currentProfile } from '../services/state.js';
import { ensurePageAccess } from '../services/rbac.js';
import { createReferralRecord } from '../services/dataService.js';
import { audit } from '../services/authService.js';
import { sanitizeText } from '../utils/sanitize.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { messaging } from '../services/messagingService.js';
import { integrations } from '../services/integrationService.js';
import { showPage, refreshDB } from '../main.js';


const ACTIVE_STATUSES = ['Submitted', 'Under Review', 'Received', 'In Consultation', 'Admitted'];

function alertBox(message, kind = 'alert-e') {
  document.getElementById('ref-alert').innerHTML = `<div class="alert ${kind}"><i class="ti ${kind === 'alert-s' ? 'ti-circle-check' : 'ti-alert-circle'}"></i> ${message}</div>`;
}

function val(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

function setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function makeReferralNumber(f) {
  const year = new Date().getFullYear();
  const sameYear = (f.referrals || []).filter(r => String(r.id || '').startsWith(`OHGL-${year}-`)).length;
  return `OHGL-${year}-${String(sameYear + 1).padStart(6, '0')}`;
}

function validateReferral(form, f) {
  const errors = [];
  const required = [
    ['patient', 'Full name'],
    ['nationalId', 'National ID number'],
    ['phone', 'Phone'],
    ['gender', 'Gender'],
    ['age', 'Age'],
    ['county', 'County'],
    ['subCounty', 'Sub County'],
    ['village', 'Village'],
    ['complaint', 'Chief complaint'],
    ['reason', 'Referral reason'],
    ['facilityId', 'Referral facility'],
    ['department', 'Department'],
  ];
  required.forEach(([key, label]) => {
    if (!form[key]) errors.push(`${label} is required.`);
  });
  if (form.nationalId && !/^\d{6,12}$/.test(form.nationalId)) errors.push('National ID must be 6 to 12 digits.');
  if (form.phone && !/^(?:\+?254|0)?[17]\d{8}$/.test(form.phone.replace(/\s+/g, ''))) errors.push('Phone must be a valid Kenyan mobile number.');
  const age = Number(form.age);
  if (form.age && (!Number.isInteger(age) || age < 0 || age > 120)) errors.push('Age must be a whole number between 0 and 120.');
  if (form.date && Number.isNaN(Date.parse(form.date))) errors.push('Date submitted is invalid.');

  const duplicate = (f.referrals || []).find(r =>
    (r.national_id || '').trim() === form.nationalId && ACTIVE_STATUSES.includes(r.workflow_status || 'Submitted')
  );
  if (duplicate) errors.push(`This National ID already has an active referral (${duplicate.id}). Complete, close, or cancel it before creating another.`);
  return errors;
}

export function initSlip() {
  if (!ensurePageAccess('new_referral', 'ref-alert')) return;
  const f = fac();
  if (!f) return;
  document.getElementById('slip-hdr-r').innerHTML = f.location + ' - ' + f.name + '<br>' + (f.email || '');
  document.getElementById('slip-no-display').textContent = makeReferralNumber(f);
  if (!val('f-date')) document.getElementById('f-date').valueAsDate = new Date();

  const facSel = document.getElementById('f-dest-facility');
  if (facSel) {
    const selected = facSel.value || f.id;
    facSel.innerHTML = (DB.facilities || [])
      .map(x => `<option value="${x.id}" ${x.id === selected ? 'selected' : ''}>${x.location} - ${x.name}</option>`)
      .join('');
  }
}


export function clearSlipForm() {
  [
    'f-patient', 'f-national-id', 'f-phone', 'f-age', 'f-county', 'f-subcounty', 'f-village',
    'f-complaint', 'f-reason', 'f-notes', 'f-department'
  ].forEach(id => setVal(id, ''));
  setVal('f-sex', '');
  setVal('f-dest-facility', fac()?.id || '');
  document.getElementById('ref-alert').innerHTML = '';
  document.getElementById('f-date').valueAsDate = new Date();
  initSlip();
}

export async function submitReferral() {
  if (!ensurePageAccess('new_referral', 'ref-alert')) return;
  
  if (!checkRateLimit('submit_referral', 3, 30000)) {
    alertBox('Too many referral submissions. Please wait a few seconds before trying again.');
    return;
  }

  const f = fac();
  if (!f) {
    alertBox('Please select a facility first.');
    return;
  }

  const form = {
    patient: sanitizeText(val('f-patient'), 160),
    nationalId: sanitizeText(val('f-national-id'), 40),
    phone: sanitizeText(val('f-phone'), 40),
    gender: sanitizeText(val('f-sex'), 20),
    age: val('f-age'),
    county: sanitizeText(val('f-county'), 80),
    subCounty: sanitizeText(val('f-subcounty'), 80),
    village: sanitizeText(val('f-village'), 120),
    complaint: sanitizeText(val('f-complaint'), 1000),
    reason: sanitizeText(val('f-reason'), 500),
    notes: sanitizeText(val('f-notes'), 2000),
    facilityId: val('f-dest-facility') || f.id,
    department: sanitizeText(val('f-department'), 120),
    date: val('f-date'),
  };

  const errors = validateReferral(form, f);
  if (errors.length) {
    alertBox(`<strong>Please fix the following:</strong><br>${errors.map(e => `&bull; ${e}`).join('<br>')}`);
    return;
  }

  if (!f.referrals) f.referrals = [];
  const referralNo = makeReferralNumber(f);
  const selectedFacility = (DB.facilities || []).find(x => x.id === form.facilityId) || f;
  const slip = {
    id: referralNo,
    facility_id: form.facilityId,
    date: form.date,
    patient: form.patient,
    national_id: form.nationalId,
    phone: form.phone,
    sex: form.gender,
    age: form.age,
    county: form.county,
    subcounty: form.subCounty,
    village: form.village,
    complaint: form.complaint,
    referral_reason: form.reason,
    notes: form.notes,
    referral_facility: selectedFacility.name,
    referral_facility_id: form.facilityId,
    department: form.department,
    workflow_status: 'Submitted',
    status: 'Submitted',
    created_by: currentProfile?.id,
    created_by_name: currentProfile?.full_name || '',
    timeline: [{ status: 'Submitted', at: new Date().toISOString(), by: currentProfile?.full_name || 'Current user' }],
    created: new Date().toISOString(),
  };

  const payload = {
    facility_id: form.facilityId,
    slip_no: referralNo,
    referral_date: form.date,
    patient_name: form.patient,
    national_id: form.nationalId,
    phone: form.phone,
    sex: form.gender,
    age: parseInt(form.age, 10),
    county: form.county,
    subcounty: form.subCounty,
    village: form.village,
    presenting_concern: form.complaint,
    referral_reason: form.reason,
    clinical_notes: form.notes,
    referral_facility_id: form.facilityId,
    referral_facility_name: selectedFacility.name,
    department: form.department,
    workflow_status: 'Submitted',
  };

  const { data, error } = await createReferralRecord(payload);
  if (error) {
    alertBox(error.message || 'Referral could not be submitted.');
    return;
  }

  // Future-Ready Integration Sync (non-blocking)
  integrations.syncToSHA(payload).catch(err => console.error('[SHA Sync Error]', err));
  messaging.send('sms', payload.phone, `Oasis Health: Referral ${data.slip_no || referralNo} has been successfully submitted to ${payload.referral_facility_name}.`).catch(err => console.error('[SMS Sync Error]', err));


  slip.db_id = data.id;
  slip.id = data.slip_no || referralNo;
  f.referrals.push(slip);
  await audit('create', 'referrals', data.id, { slip_no: slip.id });
  clearSlipForm();
  await refreshDB();
  showPage('my_referrals', document.getElementById('nav-my_referrals'));
  const myAlert = document.getElementById('my-referrals-alert');
  if (myAlert) {
    myAlert.innerHTML = `<div class="alert alert-s"><i class="ti ti-circle-check"></i> Referral <strong>${slip.id}</strong> submitted successfully.</div>`;
    setTimeout(() => {
      myAlert.innerHTML = '';
    }, 5000);
  }
  window.scrollTo(0, 0);
}
