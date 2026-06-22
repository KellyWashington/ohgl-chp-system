import { fac, DB, setDB } from '../services/state.js';
import { updateFacilityRecord, deleteFacilityRecord, createFacilityRecord } from '../services/dataService.js';
import { audit, hasPerm } from '../services/authService.js';
import { sanitizeText } from '../utils/sanitize.js';
import { makeFac } from '../services/mappers.js';
import { closeModal } from '../components/modal.js';
import { updateHeader, showPage } from '../main.js';
import { renderDash } from './dashboard.js';

export function loadSettings() {
  const f = fac();
  document.getElementById('settings-fac').textContent = f ? f.location + ' - ' + f.name : 'No facility selected';
  if (!f) return;
  document.getElementById('s-name').value = f.name || '';
  document.getElementById('s-location').value = f.location || '';
  document.getElementById('s-subcounty').value = f.subcounty || '';
  document.getElementById('s-level').value = f.level || 'Level 4';
  document.getElementById('s-email').value = f.email || '';
  document.getElementById('s-phone').value = f.phone || '';
  document.getElementById('s-token').value = f.token || 200;
  document.getElementById('s-year').value = f.year || 2026;
  document.getElementById('s-compiler').value = f.compiler || '';
  document.getElementById('s-coic').value = f.coic || '';
}

export async function saveSettings() {
  const f = fac();
  if (!f) {
    alert('No facility selected.');
    return;
  }
  f.name = document.getElementById('s-name').value;
  f.location = document.getElementById('s-location').value;
  f.subcounty = document.getElementById('s-subcounty').value;
  f.level = document.getElementById('s-level').value;
  f.email = document.getElementById('s-email').value;
  f.phone = document.getElementById('s-phone').value;
  f.token = parseFloat(document.getElementById('s-token').value) || 200;
  f.year = parseInt(document.getElementById('s-year').value) || 2026;
  f.compiler = document.getElementById('s-compiler').value;
  f.coic = document.getElementById('s-coic').value;

  const payload = {
    name: sanitizeText(f.name, 160),
    location: sanitizeText(f.location, 120),
    subcounty: sanitizeText(f.subcounty, 120),
    level: f.level,
    email: sanitizeText(f.email, 160),
    phone: sanitizeText(f.phone, 40),
    token_rate: f.token,
    financial_year: f.year,
    compiler: sanitizeText(f.compiler, 160),
    coic: sanitizeText(f.coic, 160),
  };
  const { error } = await updateFacilityRecord(f.id, payload);
  if (error) {
    alert(error.message);
    return;
  }
  await audit('update', 'facilities', f.id, { fields: Object.keys(payload) });
  updateHeader();
  document.getElementById('settings-alert').innerHTML = `<div class="alert alert-s"><i class="ti ti-circle-check"></i> Settings saved for ${f.location} - ${f.name}</div>`;
  setTimeout(() => (document.getElementById('settings-alert').innerHTML = ''), 3000);
}

export async function deleteFacility() {
  const f = fac();
  if (!f) return;
  if (!confirm('Delete ' + f.location + ' - ' + f.name + ' and ALL its data?')) return;
  const { error } = await deleteFacilityRecord(f.id);
  if (error) {
    alert(error.message);
    return;
  }
  await audit('delete', 'facilities', f.id, { name: f.name });
  const newFacs = DB.facilities.filter(x => x.id !== f.id);
  const activeFacId = newFacs.length ? newFacs[0].id : null;
  setDB({ facilities: newFacs, activeFacId });
  updateHeader();
  showPage('dashboard', document.querySelector('.nt'));
  renderDash();
}

export async function addFacility() {
  const name = sanitizeText(document.getElementById('af-name').value, 160);
  if (!name) {
    alert('Please enter the facility name.');
    return;
  }
  const payload = {
    name,
    location: sanitizeText(document.getElementById('af-loc').value, 120),
    level: document.getElementById('af-level').value,
    email: sanitizeText(document.getElementById('af-email').value, 160),
    phone: sanitizeText(document.getElementById('af-phone').value, 40),
    token_rate: 200,
    financial_year: 2026,
  };
  const { data, error } = await createFacilityRecord(payload);
  if (error) {
    alert(error.message);
    return;
  }
  const f = makeFac(data);
  const newFacs = [...DB.facilities, f];
  setDB({ facilities: newFacs, activeFacId: f.id });
  sessionStorage.setItem('ohgl_active_facility', f.id);
  await audit('create', 'facilities', f.id, { name: f.name });
  closeModal('add-fac-modal');
  updateHeader();
  renderDash();
  ['af-name', 'af-loc', 'af-email', 'af-phone'].forEach(id => (document.getElementById(id).value = ''));
}

export function exportJSON() {
  if (!hasPerm('audit:read')) {
    alert('Only administrators can export operational data.');
    return;
  }
  const exportData = {
    generated_at: new Date().toISOString(),
    facilities: DB.facilities.map(f => ({
      ...f,
      referrals: (f.referrals || []).map(r => ({
        ...r,
        patient: '[REDACTED]',
        notes: '[REDACTED]',
        sha_no: '[REDACTED]',
      })),
    })),
  };
  const b = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = 'OHGL_CHP_Redacted_Export_' + new Date().toISOString().split('T')[0] + '.json';
  a.click();
}

export function importJSON() {
  alert(
    'Bulk imports must use the vetted Supabase migration script in docs/MIGRATION_PLAN.md so records are validated, encrypted, and audited.'
  );
}
