import { requireSupabase, sb } from './services/supabaseClient.js';
import { fetchCoreData } from './services/dataService.js';
import { makeFac } from './services/mappers.js';
import { openModal, closeModal } from './components/modal.js';
import { h, installInnerHTMLSanitizer, setSafeHTML } from './utils/sanitize.js';
import { canAccessPage, getDefaultPage, renderAccessDenied } from './services/rbac.js';
import { DB, setDB, currentUser, currentProfile, setCurrentUser, setCurrentProfile, fac } from './services/state.js';
import { login, resetPassword, logout, bootstrapSession, applyPermissionsUI } from './services/authService.js';
import { toggleNotifDropdown, refreshNotifications, markNotificationAsRead, markAllNotificationsAsRead } from './services/notificationService.js';


// Page modules
import { renderDash } from './pages/dashboard.js';
import { initSlip, clearSlipForm, submitReferral } from './pages/newReferral.js';
import { renderTracker, updRef, delRef } from './pages/tracker.js';
import { renderMyReferrals } from './pages/myReferrals.js';
import { renderDir, openAddCHP, openEditCHP, saveCHP, delCHP } from './pages/directory.js';
import { renderReport, onReportFilterTypeChange, exportReport } from './pages/report.js';
import { renderGroup } from './pages/group.js';
import { loadSettings, saveSettings, deleteFacility, addFacility, exportJSON, importJSON, adminUserWizard } from './pages/settings.js';
import { renderAudit } from './pages/audit.js';

export function showAuth(isAuthed) {
  document.getElementById('auth-screen').style.display = isAuthed ? 'none' : 'flex';
  document.getElementById('app-shell').classList.toggle('ready', !!isAuthed);
}

export function authAlert(msg, kind = 'alert-e') {
  setSafeHTML('auth-alert', `<div class="alert ${kind}">${h(msg)}</div>`);
}

export async function refreshDB() {
  await requireSupabase();
  const [
    { data: facilities, error: facErr },
    { data: chps, error: chpErr },
    { data: refs, error: refErr },
  ] = await fetchCoreData();
  
  if (facErr || chpErr || refErr) throw facErr || chpErr || refErr;
  
  const newFacilities = (facilities || []).map(makeFac);
  newFacilities.forEach(f => {
    f.chps = (chps || [])
      .filter(c => c.facility_id === f.id)
      .map(c => ({
        code: c.code,
        name: c.full_name,
        id_no: c.national_id,
        phone: c.phone,
        village: c.village,
        unit: c.community_unit,
        sha_trained: c.sha_trained,
        jumuisha: c.jumuisha_enrolled,
        active: c.active,
        notes: c.notes,
        id: c.id,
        user_id: c.user_id,
        facility_id: c.facility_id,
      }));
    f.referrals = (refs || [])
      .filter(r => r.facility_id === f.id)
      .map(r => ({
        id: r.slip_no,
        db_id: r.id,
        facility_id: r.facility_id,
        date: r.referral_date,
        chp_code: r.chp_code,
        chp_unit: r.chp_unit,
        patient: r.patient_name,
        national_id: r.national_id,
        phone: r.phone,
        county: r.county,
        subcounty: r.subcounty,
        village: r.village,
        age: r.age,
        sex: r.sex,
        category: (r.category || []).join(', '),
        priority: r.priority,
        sha: r.sha_registered ? 'Yes' : 'No',
        complaint: r.presenting_concern,
        notes: r.clinical_notes,
        referral_reason: r.referral_reason,
        referral_facility: r.referral_facility_name || r.referral_facility,
        referral_facility_id: r.referral_facility_id,
        department: r.department,
        workflow_status: r.workflow_status || r.opd_status || 'Submitted',
        status: r.workflow_status || r.opd_status || 'Submitted',
        timeline: r.timeline || [],
        opd_status: r.opd_status,
        received_by: r.received_by,
        file_no: r.file_no,
        sha_no: r.sha_no,
        created_by: r.created_by,
        created_by_name: r.created_by_name,
        created: r.created_at,
      }));
  });
  
  const activeFacId = sessionStorage.getItem('ohgl_active_facility') || newFacilities[0]?.id || null;
  setDB({ facilities: newFacilities, activeFacId });
  updateHeader();
  refreshNotifications().catch(console.error);
  renderDash();
}

function buildFacSel() {
  const sel = document.getElementById('fac-sel');
  if (sel) {
    sel.innerHTML = DB.facilities
      .map(f => `<option value="${f.id}" ${f.id === DB.activeFacId ? 'selected' : ''}>${f.location} - ${f.name}</option>`)
      .join('');
  }
}

export function switchFac(id) {
  const newDB = { ...DB, activeFacId: id };
  setDB(newDB);
  sessionStorage.setItem('ohgl_active_facility', id);
  updateHeader();
  const active = document.querySelector('.nt.active');
  const pid = document.querySelector('.page.active')?.id.replace('page-', '');
  if (pid) showPage(pid, active);
}

export function updateHeader() {
  const f = fac();
  if (!f) return;
  document.getElementById('hdr-fname').textContent = f.location + ' - ' + f.name;
  document.getElementById('hdr-contact').textContent = (f.email || '') + '  |  ' + (f.phone || '');
  document.getElementById('hdr-doccode').textContent = 'OHGL-CHP-DASH-' + (f.year || 2026);
  buildFacSel();
}

export function showPage(id, el) {
  if (!canAccessPage(id)) {
    const fallback = getDefaultPage();
    if (fallback && fallback !== id) {
      return showPage(fallback, document.getElementById(`nav-${fallback}`) || document.querySelector('.nt'));
    }
    renderAccessDenied(`page-${id}`, 'This module is restricted to your role.');
    return;
  }
  const target = document.getElementById('page-' + id);
  if (!target) return;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nt').forEach(t => t.classList.remove('active'));
  target.classList.add('active');
  if (el) el.classList.add('active');
  const map = {
    dashboard: renderDash,
    my_referrals: renderMyReferrals,
    tracker: renderTracker,
    directory: renderDir,
    report: renderReport,
    group: renderGroup,
    new_referral: initSlip,
    settings: loadSettings,
    audit: renderAudit,
  };
  if (map[id]) map[id]();
}

export function printPage(id) {
  const tabIndex = {
    dashboard: 0,
    new_referral: 1,
    my_referrals: 2,
    tracker: 3,
    directory: 3,
    report: 4,
    group: 5,
    settings: 6,
  };
  showPage(id, document.querySelectorAll('.nt')[tabIndex[id] || 0]);
  setTimeout(() => window.print(), 250);
}

export function exportPDF() {
  printPage('report');
}

export function togglePasswordVisibility() {
  const pwdInput = document.getElementById('auth-password');
  const toggleBtn = document.querySelector('.password-toggle-btn');
  const toggleIcon = document.getElementById('password-toggle-icon');
  if (pwdInput && toggleIcon) {
    const showing = pwdInput.type === 'password';
    pwdInput.type = showing ? 'text' : 'password';
    toggleIcon.className = showing ? 'ti ti-eye-off' : 'ti ti-eye';
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
      toggleBtn.setAttribute('aria-pressed', String(showing));
    }
  }
}

async function load() {
  await requireSupabase();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    showAuth(false);
    return;
  }
  await bootstrapSession(session);
}

installInnerHTMLSanitizer();
load().catch(err => authAlert(err.message || 'Startup failed'));

sb?.auth.onAuthStateChange((_event, session) => {
  if (session && !currentUser) {
    bootstrapSession(session).catch(err => authAlert(err.message));
  }
  if (!session) {
    setCurrentUser(null);
    setCurrentProfile(null);
    setDB({ facilities: [], activeFacId: null });
    showAuth(false);
  }
});

Object.assign(window, {
  login,
  resetPassword,
  showPage,
  switchFac,
  openModal,
  closeModal,
  exportPDF,
  renderDash,
  clearSlipForm,
  submitReferral,
  renderTracker,
  renderMyReferrals,
  openAddCHP,
  renderReport,
  onReportFilterTypeChange,
  exportReport,
  deleteFacility,
  saveSettings,
  exportJSON,
  importJSON,
  adminUserWizard,
  addFacility,
  saveCHP,
  openEditCHP,
  delCHP,
  updRef,
  delRef,
  logout,
  togglePasswordVisibility,
  toggleNotifDropdown,
  markNotificationAsRead,
  markAllNotificationsAsRead,
});
