import { fac, selectedPriority, setSelectedPriority } from '../services/state.js';
import { createReferralRecord } from '../services/dataService.js';
import { audit } from '../services/authService.js';
import { sanitizeText } from '../utils/sanitize.js';

export function initSlip() {
  const f = fac();
  if (!f) return;
  document.getElementById('slip-hdr-r').innerHTML =
    f.location + ' - ' + f.name + '<br>' + (f.email || '');
  const chps = f.chps || [];
  const sel = document.getElementById('f-chp');
  sel.innerHTML =
    '<option value="">Select CHP...</option>' +
    chps.map(c => `<option value="${c.code}">${c.code} - ${c.name || 'No name'}</option>`).join('');
  const n = String((f.referrals || []).length + 1).padStart(4, '0');
  const pfx = f.location.replace(/\s/g, '').substring(0, 3).toUpperCase();
  document.getElementById('slip-no-display').textContent =
    pfx + '-REF-' + new Date().getFullYear() + '-' + n;
  if (!document.getElementById('f-date').value) {
    document.getElementById('f-date').valueAsDate = new Date();
  }
}

export function selectPri(el, val) {
  setSelectedPriority(val);
  document.querySelectorAll('.pri-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
}

export function autofillCHP() {
  const f = fac();
  if (!f) return;
  const chp = (f.chps || []).find(c => c.code === document.getElementById('f-chp').value);
  document.getElementById('f-unit').value = chp ? chp.unit : '';
}

export function getCheckedCats() {
  return [...document.querySelectorAll('input[name="f-cat"]:checked')].map(c => c.value).join(', ');
}

export function getSHA() {
  const r = document.querySelector('input[name="f-sha"]:checked');
  return r ? r.value : '';
}

export function clearSlipForm() {
  document.getElementById('f-chp').value = '';
  document.getElementById('f-unit').value = '';
  document.getElementById('f-patient').value = '';
  document.getElementById('f-age').value = '';
  document.getElementById('f-sex').value = '';
  document.getElementById('f-complaint').value = '';
  document.getElementById('f-notes').value = '';
  document.getElementById('f-received-by').value = '';
  document.getElementById('f-time').value = '';
  document.getElementById('f-fileno').value = '';
  document.getElementById('f-shano').value = '';
  document.getElementById('f-opd-status').value = 'Pending';
  document.querySelectorAll('input[name="f-cat"]').forEach(c => (c.checked = false));
  document.querySelectorAll('input[name="f-sha"]').forEach(c => (c.checked = false));
  document.querySelectorAll('.pri-btn').forEach(b => b.classList.remove('selected'));
  setSelectedPriority('');
  document.getElementById('f-date').valueAsDate = new Date();
  document.getElementById('ref-alert').innerHTML = '';
  initSlip();
}

export async function submitReferral() {
  const f = fac();
  if (!f) {
    document.getElementById('ref-alert').innerHTML = `<div class="alert alert-e"><i class="ti ti-alert-circle"></i> Please select a facility first.</div>`;
    return;
  }
  const patient = document.getElementById('f-patient').value.trim();
  const chp = document.getElementById('f-chp').value;
  const cat = getCheckedCats();
  const priorityVal = selectedPriority; // Read from reactive state
  if (!patient || !chp || !cat || !priorityVal) {
    document.getElementById('ref-alert').innerHTML = `<div class="alert alert-e"><i class="ti ti-alert-circle"></i> Please fill in: CHP, patient name, at least one category, and priority level.</div>`;
    return;
  }
  if (!f.referrals) f.referrals = [];
  const n = String(f.referrals.length + 1).padStart(4, '0');
  const pfx = f.location.replace(/\s/g, '').substring(0, 3).toUpperCase();
  const slip = {
    id: pfx + '-REF-' + new Date().getFullYear() + '-' + n,
    facility_id: f.id,
    date: document.getElementById('f-date').value,
    chp_code: chp,
    chp_unit: document.getElementById('f-unit').value,
    patient,
    age: document.getElementById('f-age').value,
    sex: document.getElementById('f-sex').value,
    category: cat,
    priority: priorityVal,
    sha: getSHA(),
    complaint: document.getElementById('f-complaint').value,
    notes: document.getElementById('f-notes').value,
    opd_status: document.getElementById('f-opd-status').value || 'Pending',
    received_by: document.getElementById('f-received-by').value,
    file_no: document.getElementById('f-fileno').value,
    sha_no: document.getElementById('f-shano').value,
    created: new Date().toISOString(),
  };
  const payload = {
    facility_id: f.id,
    slip_no: slip.id,
    referral_date: slip.date,
    chp_code: slip.chp_code,
    chp_unit: slip.chp_unit,
    patient_name: sanitizeText(slip.patient, 160),
    age: parseInt(slip.age) || null,
    sex: slip.sex || null,
    category: cat.split(',').map(x => sanitizeText(x, 40)),
    priority: slip.priority,
    sha_registered: slip.sha === 'Yes',
    presenting_concern: sanitizeText(slip.complaint, 1000),
    clinical_notes: sanitizeText(slip.notes, 2000),
    opd_status: slip.opd_status,
    received_by: sanitizeText(slip.received_by, 160),
    file_no: sanitizeText(slip.file_no, 80),
    sha_no: sanitizeText(slip.sha_no, 80),
  };
  const { data, error } = await createReferralRecord(payload);
  if (error) {
    alert(error.message);
    return;
  }
  slip.db_id = data.id;
  f.referrals.push(slip);
  await audit('create', 'referrals', data.id, { slip_no: slip.id });
  document.getElementById('ref-alert').innerHTML = `<div class="alert alert-s"><i class="ti ti-circle-check"></i> Referral <strong>${slip.id}</strong> submitted and logged successfully.</div>`;
  clearSlipForm();
  window.scrollTo(0, 0);
}
