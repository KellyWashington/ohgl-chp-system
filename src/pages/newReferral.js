import { DB, fac, currentProfile, currentUser } from '../services/state.js';
import { ensurePageAccess } from '../services/rbac.js';
import { createReferralRecord } from '../services/dataService.js';
import { audit } from '../services/authService.js';
import { h, sanitizeText } from '../utils/sanitize.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { messaging } from '../services/messagingService.js';
import { integrations } from '../services/integrationService.js';
import { showPage, refreshDB } from '../main.js';
import { registerUnsavedChangesGuard } from '../services/unsavedChangesGuard.js';
import { FormManager } from '../services/formManager.js';
import { DraftEngine } from '../services/draftEngine.js';
import { LoadingManager } from '../services/loadingManager.js';
import { Toast } from '../services/toast.js';
import { SuccessModal } from '../components/successModal.js';

const FORM_ID = 'new-referral';
const ACTIVE_STATUSES = ['Submitted', 'Under Review', 'Received', 'In Consultation', 'Admitted'];
const DRAFT_PREFIX = 'ochp_referral_draft:';
const BROWSER_ID_KEY = 'ochp_referral_browser_id';
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const AUTOSAVE_MS = 30000;
const DIRTY_DEBOUNCE_MS = 2000;
const FORM_FIELD_IDS = [
  'f-patient', 'f-national-id', 'f-phone', 'f-age', 'f-county', 'f-subcounty', 'f-village',
  'f-complaint', 'f-reason', 'f-notes', 'f-department', 'f-priority', 'f-sex', 'f-dest-facility', 'f-date'
];

let isSubmittingReferral = false;
let autosaveTimer = null;
let draftListenersReady = false;
let draftPromptedForUser = null;
let draftChangeTimer = null;
let guardRegistered = false;
let draftProviderRegistered = false;
let referralForm = null;
let lastDraftFingerprint = '';
let suppressDraftSave = false;
let lastFocusedBeforeModal = null;

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

function focusPatientName() {
  requestAnimationFrame(() => {
    const patient = document.getElementById('f-patient');
    if (patient) patient.focus();
  });
}

function showToast(message, kind = 'info') {
  Toast.show(message, { kind });
}

function getBrowserId() {
  try {
    let id = localStorage.getItem(BROWSER_ID_KEY);
    if (!id) {
      id = crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(BROWSER_ID_KEY, id);
    }
    return id;
  } catch (_err) {
    return 'session-only';
  }
}

function draftKey(userId = currentUser?.id) {
  return userId ? `${DRAFT_PREFIX}${userId}:${getBrowserId()}` : null;
}

function allDraftKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(DRAFT_PREFIX)) keys.push(key);
    }
  } catch (_err) {
    return [];
  }
  return keys;
}

function purgeExpiredAndForeignDrafts() {
  const now = Date.now();
  const activeUserId = currentUser?.id || null;
  const browserId = getBrowserId();
  allDraftKeys().forEach(key => {
    try {
      const draft = JSON.parse(localStorage.getItem(key) || '{}');
      const expired = !draft.expiresAt || draft.expiresAt <= now;
      const foreignBrowser = draft.browserId && draft.browserId !== browserId;
      const foreignOwner = activeUserId && draft.userId && draft.userId !== activeUserId;
      if (expired || foreignBrowser || foreignOwner) localStorage.removeItem(key);
    } catch (_err) {
      localStorage.removeItem(key);
    }
  });
}

function readCurrentForm() {
  return {
    patient: val('f-patient'),
    nationalId: val('f-national-id'),
    phone: val('f-phone'),
    gender: val('f-sex'),
    age: val('f-age'),
    county: val('f-county'),
    subCounty: val('f-subcounty'),
    village: val('f-village'),
    complaint: val('f-complaint'),
    reason: val('f-reason'),
    notes: val('f-notes'),
    facilityId: val('f-dest-facility') || fac()?.id || '',
    department: val('f-department'),
    priority: val('f-priority') || 'Routine',
    date: val('f-date'),
  };
}

function hasMeaningfulDraftData(data) {
  return Object.entries(data || {}).some(([key, value]) => !['date', 'facilityId', 'priority'].includes(key) && String(value || '').trim());
}

function draftFingerprint(data) {
  return JSON.stringify(data || {});
}

function markReferralClean(data = readCurrentForm()) {
  lastDraftFingerprint = draftFingerprint(data);
  referralForm?.markClean(data);
}

function hasUnsavedReferralChanges() {
  if (referralForm) return referralForm.isDirty();
  const data = readCurrentForm();
  if (!hasMeaningfulDraftData(data)) return false;
  return draftFingerprint(data) !== lastDraftFingerprint;
}

function scheduleDraftWrite(force = false) {
  referralForm?.setDirty();
  if (force) writeDraft(true);
  else referralForm?.scheduleAutosave();
}

function saveDraftForGuard() {
  return referralForm?.autosave(true) || writeDraft(true);
}

function discardReferralForGuard() {
  return referralForm?.discard() || (clearReferralDraft(), resetReferralForm({ preserveFacility: true }));
}

function registerReferralGuard() {
  if (guardRegistered) return;
  registerUnsavedChangesGuard({
    formId: FORM_ID,
    isDirty: hasUnsavedReferralChanges,
    saveDraft: saveDraftForGuard,
    discard: discardReferralForGuard,
    markClean: () => markReferralClean(),
    copy: {
      title: 'Unsaved Changes',
      message: 'You have unsaved changes.',
      detail: 'Leaving this page may cause patient information to be lost.',
      prompt: 'Choose how you would like to continue.',
      stayLabel: 'Stay Here',
      leaveLabel: 'Leave Without Saving',
      saveLabel: 'Save Draft & Leave',
    },
    logoutCopy: {
      title: 'Unsaved Referral',
      message: 'You have an unsaved referral.',
      detail: 'Would you like to save it before signing out?',
      stayLabel: 'Stay Logged In',
      leaveLabel: 'Logout Without Saving',
      saveLabel: 'Save Draft & Logout',
    },
  });
  guardRegistered = true;
}

function registerReferralFramework() {
  if (!draftProviderRegistered) {
    DraftEngine.register({
      formId: FORM_ID,
      userId: () => currentUser?.id,
      browserId: getBrowserId,
      expireAfter: DRAFT_TTL_MS,
      save: data => {
        const key = draftKey();
        if (!key || !currentUser?.id) return false;
        localStorage.setItem(key, JSON.stringify({
          userId: currentUser.id,
          browserId: getBrowserId(),
          savedAt: Date.now(),
          expiresAt: Date.now() + DRAFT_TTL_MS,
          data,
        }));
        return true;
      },
      load: () => readDraft(),
      clear: () => clearReferralDraft(),
    });
    draftProviderRegistered = true;
  }

  if (!referralForm) {
    referralForm = FormManager.register({
      formId: FORM_ID,
      getValues: readCurrentForm,
      ignoredDirtyKeys: ['date', 'facilityId', 'priority'],
      autosaveMs: AUTOSAVE_MS,
      autosaveDebounceMs: DIRTY_DEBOUNCE_MS,
      autosave: data => {
        if (!hasMeaningfulDraftData(data)) {
          clearReferralDraft();
          return true;
        }
        return DraftEngine.save(FORM_ID, data);
      },
      clearDraft: () => DraftEngine.clear(FORM_ID),
      discard: () => {
        clearReferralDraft();
        resetReferralForm({ preserveFacility: true });
      },
    });
  }

  return referralForm;
}
function writeDraft(force = false) {
  if (suppressDraftSave || isSubmittingReferral || !currentUser?.id) return false;
  const key = draftKey();
  if (!key) return false;
  const data = readCurrentForm();
  if (!hasMeaningfulDraftData(data)) {
    clearReferralDraft();
    markReferralClean(data);
    return true;
  }
  const fingerprint = draftFingerprint(data);
  if (!force && fingerprint === lastDraftFingerprint) return true;
  try {
    localStorage.setItem(key, JSON.stringify({
      userId: currentUser.id,
      browserId: getBrowserId(),
      savedAt: Date.now(),
      expiresAt: Date.now() + DRAFT_TTL_MS,
      data,
    }));
    markReferralClean(data);
    return true;
  } catch (err) {
    console.warn('Referral draft could not be saved', err);
    throw new Error('Referral draft could not be saved. Please try again.');
  }
}

function readDraft() {
  purgeExpiredAndForeignDrafts();
  const key = draftKey();
  if (!key) return null;
  try {
    const draft = JSON.parse(localStorage.getItem(key) || 'null');
    if (!draft || draft.userId !== currentUser?.id || draft.browserId !== getBrowserId() || draft.expiresAt <= Date.now()) {
      localStorage.removeItem(key);
      return null;
    }
    return draft;
  } catch (_err) {
    localStorage.removeItem(key);
    return null;
  }
}

function clearReferralDraft(userId = currentUser?.id) {
  const key = draftKey(userId);
  if (key) localStorage.removeItem(key);
  lastDraftFingerprint = '';
}

function clearReferralStorageForUser(userId = currentUser?.id) {
  if (userId) {
    allDraftKeys().forEach(key => {
      if (key.startsWith(`${DRAFT_PREFIX}${userId}:`)) localStorage.removeItem(key);
    });
  }
  Object.keys(sessionStorage).forEach(key => {
    if (/referral|draft|patient/i.test(key) && key !== 'ohgl_active_facility') sessionStorage.removeItem(key);
  });
}

function applyDraft(data) {
  suppressDraftSave = true;
  setVal('f-patient', data.patient || '');
  setVal('f-national-id', data.nationalId || '');
  setVal('f-phone', data.phone || '');
  setVal('f-sex', data.gender || '');
  setVal('f-age', data.age || '');
  setVal('f-county', data.county || '');
  setVal('f-subcounty', data.subCounty || '');
  setVal('f-village', data.village || '');
  setVal('f-complaint', data.complaint || '');
  setVal('f-reason', data.reason || '');
  setVal('f-notes', data.notes || '');
  setVal('f-department', data.department || '');
  setVal('f-priority', data.priority || 'Routine');
  if (data.facilityId) setVal('f-dest-facility', data.facilityId);
  if (data.date) setVal('f-date', data.date);
  suppressDraftSave = false;
  markReferralClean();
}

function closeModalById(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('open');
  if (lastFocusedBeforeModal?.focus) lastFocusedBeforeModal.focus();
}

function showDraftRecoveryModal(draft) {
  const modal = document.getElementById('referral-draft-modal');
  const details = document.getElementById('referral-draft-details');
  if (!modal || !details) return;
  const savedAt = draft.savedAt ? new Date(draft.savedAt).toLocaleString() : 'recently';
  details.innerHTML = `<div class="draft-summary"><strong>Draft saved ${h(savedAt)}</strong><span>${h(draft.data?.patient || 'Unnamed patient')}</span></div>`;
  const resume = document.getElementById('ref-draft-resume');
  const discard = document.getElementById('ref-draft-discard');
  const start = document.getElementById('ref-draft-start');
  if (resume) resume.onclick = () => {
    applyDraft(draft.data || {});
    closeModalById('referral-draft-modal');
    focusPatientName();
  };
  if (discard) discard.onclick = () => {
    clearReferralDraft();
    resetReferralForm({ preserveFacility: true, focus: true, toast: 'Draft discarded.' });
    closeModalById('referral-draft-modal');
  };
  if (start) start.onclick = () => {
    clearReferralDraft();
    resetReferralForm({ preserveFacility: true, focus: true, toast: 'Ready for a new referral.' });
    closeModalById('referral-draft-modal');
  };
  lastFocusedBeforeModal = document.activeElement;
  modal.classList.add('open');
  requestAnimationFrame(() => resume?.focus());
}

function maybePromptDraftRecovery() {
  if (!currentUser?.id || draftPromptedForUser === currentUser.id) return;
  const draft = readDraft();
  draftPromptedForUser = currentUser.id;
  if (draft && hasMeaningfulDraftData(draft.data)) showDraftRecoveryModal(draft);
}

function attachDraftListeners() {
  if (!draftListenersReady) {
    draftListenersReady = true;
  FORM_FIELD_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => scheduleDraftWrite(false));
    el.addEventListener('change', () => scheduleDraftWrite(true));
  });
  }
  referralForm?.startAutosave();
}

function resetSubmitButton() {
  const btn = document.getElementById('submit-referral-btn');
  LoadingManager.button.setIdle(btn, 'Submit Referral');
  isSubmittingReferral = false;
}

function setReferralSubmitting(loading) {
  const btn = document.getElementById('submit-referral-btn');
  isSubmittingReferral = loading;
  if (loading) LoadingManager.button.setLoading(btn, 'Submitting Referral...');
  else LoadingManager.button.setIdle(btn, 'Submit Referral');
}

function resetReferralForm({ preserveFacility = true, focus = false, toast = '' } = {}) {
  const selectedFacility = preserveFacility ? val('f-dest-facility') || fac()?.id || '' : fac()?.id || '';
  suppressDraftSave = true;
  [
    'f-patient', 'f-national-id', 'f-phone', 'f-age', 'f-county', 'f-subcounty', 'f-village',
    'f-complaint', 'f-reason', 'f-notes', 'f-department'
  ].forEach(id => setVal(id, ''));
  setVal('f-sex', '');
  setVal('f-priority', 'Routine');
  setVal('f-dest-facility', selectedFacility);
  const dateEl = document.getElementById('f-date');
  if (dateEl) dateEl.valueAsDate = new Date();
  const alertEl = document.getElementById('ref-alert');
  if (alertEl) alertEl.innerHTML = '';
  const slipNo = document.getElementById('slip-no-display');
  if (slipNo) slipNo.textContent = 'Assigned on submit';
  resetSubmitButton();
  suppressDraftSave = false;
  markReferralClean();
  if (focus) focusPatientName();
  if (toast) showToast(toast);
}

function showReferralSuccessModal({ slipNo, submittedAt, receivingFacility, priority, status, submittedBy }) {
  return SuccessModal.show({
    title: 'Referral Submitted Successfully',
    icon: 'ti-circle-check',
    summary: 'The referral has been successfully submitted to the receiving facility.',
    status,
    metadata: {
      'Referral Number': slipNo,
      'Submission Date & Time': submittedAt,
      'Receiving Facility': receivingFacility,
      Priority: priority,
      'Submitted By': submittedBy,
    },
    actions: [
      {
        label: 'Create Another Referral',
        kind: 'secondary',
        onClick: () => {
          resetReferralForm({ preserveFacility: true, focus: true, toast: 'Ready for a new referral.' });
          showPage('new_referral', document.getElementById('nav-new_referral'));
        },
      },
      {
        label: 'View My Referrals',
        kind: 'primary',
        onClick: () => {
          showPage('my_referrals', document.getElementById('nav-my_referrals'));
          window.scrollTo(0, 0);
        },
      },
    ],
  });
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
  registerReferralFramework();
  registerReferralGuard();
  if (!ensurePageAccess('new_referral', 'ref-alert')) return;
  const f = fac();
  if (!f) return;
  document.getElementById('slip-hdr-r').innerHTML = f.location + ' - ' + f.name + '<br>' + (f.email || '');
  document.getElementById('slip-no-display').textContent = 'Assigned on submit';
  if (!val('f-date')) document.getElementById('f-date').valueAsDate = new Date();

  const facSel = document.getElementById('f-dest-facility');
  if (facSel) {
    const selected = facSel.value || f.id;
    facSel.innerHTML = (DB.facilities || [])
      .map(x => `<option value="${x.id}" ${x.id === selected ? 'selected' : ''}>${x.location} - ${x.name}</option>`)
      .join('');
  }
  markReferralClean();
  attachDraftListeners();
  purgeExpiredAndForeignDrafts();
  maybePromptDraftRecovery();
}

export function clearReferralPrivateState({ clearCurrentDraft = false, resetPrompt = false } = {}) {
  suppressDraftSave = true;
  resetReferralForm({ preserveFacility: true });
  suppressDraftSave = false;
  if (clearCurrentDraft) clearReferralStorageForUser();
  if (resetPrompt) draftPromptedForUser = null;
  if (draftChangeTimer) {
    clearTimeout(draftChangeTimer);
    draftChangeTimer = null;
  }
  referralForm?.stopAutosave();
  if (autosaveTimer) {
    clearInterval(autosaveTimer);
    autosaveTimer = null;
  }
}

export function clearSlipForm() {
  clearReferralDraft();
  resetReferralForm({ preserveFacility: true, focus: true, toast: 'Referral form cleared.' });
}

export async function submitReferral() {
  if (!ensurePageAccess('new_referral', 'ref-alert')) return;
  if (isSubmittingReferral) return;
  
  if (!checkRateLimit('submit_referral', 3, 30000)) {
    alertBox('Too many referral submissions. Please wait a few seconds before trying again.');
    return;
  }

  const f = fac();
  if (!f) {
    alertBox('Please select a facility first.');
    return;
  }

  const raw = readCurrentForm();
  const form = {
    patient: sanitizeText(raw.patient, 160),
    nationalId: sanitizeText(raw.nationalId, 40),
    phone: sanitizeText(raw.phone, 40),
    gender: sanitizeText(raw.gender, 20),
    age: raw.age,
    county: sanitizeText(raw.county, 80),
    subCounty: sanitizeText(raw.subCounty, 80),
    village: sanitizeText(raw.village, 120),
    complaint: sanitizeText(raw.complaint, 1000),
    reason: sanitizeText(raw.reason, 500),
    notes: sanitizeText(raw.notes, 2000),
    facilityId: raw.facilityId || f.id,
    department: sanitizeText(raw.department, 120),
    priority: sanitizeText(raw.priority || 'Routine', 20),
    date: raw.date,
  };

  const errors = validateReferral(form, f);
  if (errors.length) {
    alertBox(`<strong>Please fix the following:</strong><br>${errors.map(e => `&bull; ${e}`).join('<br>')}`);
    return;
  }

  setReferralSubmitting(true);

  try {
    if (!f.referrals) f.referrals = [];
    const selectedFacility = (DB.facilities || []).find(x => x.id === form.facilityId) || f;
    const slip = {
      id: null,
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
      priority: form.priority,
      workflow_status: 'Submitted',
      status: 'Submitted',
      created_by: currentProfile?.id,
      created_by_name: currentProfile?.full_name || '',
      timeline: [],
      created: new Date().toISOString(),
    };

    const payload = {
      facility_id: form.facilityId,
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
      priority: form.priority,
      workflow_status: 'Submitted',
    };

    const { data, error } = await createReferralRecord(payload);
    if (error) throw error;

    integrations.syncToSHA(payload).catch(err => console.error('[SHA Sync Error]', err));
    const generatedSlipNo = data.slip_no;
    messaging.send('sms', payload.phone, `Oasis Health: Referral ${generatedSlipNo} has been successfully submitted to ${payload.referral_facility_name}.`).catch(err => console.error('[SMS Sync Error]', err));

    slip.db_id = data.id;
    slip.id = generatedSlipNo;
    f.referrals.push(slip);
    await audit('create', 'referrals', data.id, { slip_no: slip.id });
    clearReferralDraft();
    resetReferralForm({ preserveFacility: true });
    const shown = showReferralSuccessModal({
      slipNo: slip.id,
      submittedAt: new Date(data.created_at || slip.created).toLocaleString(),
      receivingFacility: payload.referral_facility_name,
      priority: data.priority || form.priority || 'Routine',
      status: data.referral_status || data.opd_status || 'Submitted',
      submittedBy: currentProfile?.full_name || 'Current CHP',
    });
    if (!shown) {
      alertBox(`Referral <strong>${h(slip.id)}</strong> submitted successfully.`, 'alert-s');
    }
    window.scrollTo(0, 0);
  } catch (err) {
    resetSubmitButton();
    alertBox(err.message || 'Referral could not be submitted. Please try again.');
  }
}