import { fac, DB, setDB } from '../services/state.js';
import { ensurePageAccess, hasPerm } from '../services/rbac.js';
import { updateFacilityRecord, deleteFacilityRecord, createFacilityRecord, upsertUserProfile } from '../services/dataService.js';
import { audit } from '../services/authService.js';
import { sanitizeText } from '../utils/sanitize.js';
import { makeFac } from '../services/mappers.js';
import { closeModal } from '../components/modal.js';
import { updateHeader, showPage } from '../main.js';
import { renderDash } from './dashboard.js';

export function loadSettings() {
  if (!ensurePageAccess('settings', 'settings-alert')) return;
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
  const userBtn = document.getElementById('user-admin-btn');
  if (userBtn) userBtn.style.display = hasPerm('user:manage') ? 'inline-flex' : 'none';
}

export async function saveSettings() {
  if (!ensurePageAccess('settings', 'settings-alert')) return;
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
  if (!ensurePageAccess('settings', 'settings-alert')) return;
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
  if (!ensurePageAccess('settings', 'settings-alert')) return;
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


export async function adminUserWizard() {
  if (!hasPerm('user:manage')) {
    alert('Only super admins can manage user profiles.');
    return;
  }

  const id = prompt('Auth user UUID (from Supabase Auth):');
  if (!id) return;
  const fullName = prompt('Full name:');
  if (!fullName) return;
  const email = prompt('Email address:');
  if (!email) return;
  const phone = prompt('Phone number (optional):') || '';
  const role = prompt('Role (super_admin, facility_admin, facility_officer, chp):', 'chp');
  if (!role) return;
  const normalizedRole = ['super_admin', 'facility_admin', 'facility_officer', 'chp'].includes(role) ? role : null;
  if (!normalizedRole) {
    alert('Invalid role. Use one of: super_admin, facility_admin, facility_officer, chp.');
    return;
  }
  const facilityId = normalizedRole === 'super_admin' ? null : prompt('Facility UUID (required for non-super-admin roles):');
  if (normalizedRole !== 'super_admin' && !facilityId) {
    alert('A facility UUID is required for non-super-admin roles.');
    return;
  }
  const active = confirm('Should this profile be active?');

  const payload = {
    id: id.trim(),
    full_name: sanitizeText(fullName, 160),
    email: sanitizeText(email, 160),
    phone: sanitizeText(phone, 40),
    role: normalizedRole,
    facility_id: normalizedRole === 'super_admin' ? null : facilityId.trim(),
    active,
  };

  const { error } = await upsertUserProfile(payload);
  if (error) {
    alert(error.message);
    return;
  }

  await audit('upsert', 'users', payload.id, { role: payload.role, active: payload.active });
  alert('User profile saved.');
}

export function exportJSON() {
  if (!ensurePageAccess('settings', 'settings-alert')) return;
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

export function importJSON(event) {
  const file = event.target?.files?.[0];
  if (!file) return;

  // 1. Secure File Validation: Extension checks
  const allowedExtensions = /(\.json)$/i;
  if (!allowedExtensions.exec(file.name) || file.type !== 'application/json') {
    alert('Security Violation: Only valid JSON files (.json) are permitted.');
    event.target.value = '';
    return;
  }

  // 2. Safe Size Limit: Max 2MB
  if (file.size > 2 * 1024 * 1024) {
    alert('Security Violation: File size exceeds the 2MB safety limit.');
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const text = e.target.result;
      const data = JSON.parse(text);

      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Invalid JSON structure. Root must be a JSON object.');
      }

      if (!Array.isArray(data.facilities)) {
        throw new Error('Invalid schema structure. Missing "facilities" list.');
      }

      // 3. Schema Structure & XSS Sanitization Validation
      for (const f of data.facilities) {
        if (!f.name || typeof f.name !== 'string') {
          throw new Error('Schema Violation: Facility name is required.');
        }
        if (!f.location || typeof f.location !== 'string') {
          throw new Error('Schema Violation: Facility location is required.');
        }

        // Sanitise inputs using DOMPurify for XSS Protection
        f.name = DOMPurify.sanitize(f.name.trim());
        f.location = DOMPurify.sanitize(f.location.trim());

        if (f.chps && Array.isArray(f.chps)) {
          for (const c of f.chps) {
            if (!c.code) throw new Error('Schema Violation: CHP code is required.');
            if (!c.name) throw new Error('Schema Violation: CHP name is required.');
            c.code = DOMPurify.sanitize(String(c.code).trim());
            c.name = DOMPurify.sanitize(String(c.name).trim());
          }
        }
      }

      alert('Backup file check passed. Safe JSON schema detected. Proceed with migration via Supabase tools as outlined in docs/MIGRATION_PLAN.md.');
    } catch (err) {
      alert('Security/Validation Error: ' + err.message);
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}
