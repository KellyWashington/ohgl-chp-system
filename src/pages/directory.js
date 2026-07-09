import { DB, fac, editingCHPIdx, setEditingCHPIdx } from '../services/state.js';
import { ensurePageAccess } from '../services/rbac.js';
import { saveChpRecord, saveCoverageAreaRecord, deleteChpRecord } from '../services/dataService.js';
import { audit } from '../services/authService.js';
import { h, sanitizeText } from '../utils/sanitize.js';
import { openModal, closeModal } from '../components/modal.js';
import { setPrintHeader, docCode } from '../utils/helpers.js';

function isActiveChp(chp) {
  return chp?.active == '1' || chp?.active === true;
}

function chpToPayload(chp, facilityId) {
  const payload = {
    facility_id: facilityId,
    code: chp.code,
    full_name: chp.name,
    national_id: chp.id_no,
    phone: chp.phone,
    village: chp.village,
    community_unit: chp.unit,
    sha_trained: chp.sha_trained === '1' || chp.sha_trained === true,
    jumuisha_enrolled: chp.jumuisha === '1' || chp.jumuisha === true,
    active: isActiveChp(chp),
    notes: chp.notes,
  };
  if (chp.id) payload.id = chp.id;
  return payload;
}

function bindDirectoryEvents(container) {
  container.onclick = event => {
    const button = event.target.closest('[data-dir-action][data-chp-idx]');
    if (!button || !container.contains(button)) return;
    const idx = Number(button.dataset.chpIdx);
    if (!Number.isInteger(idx)) return;
    if (button.dataset.dirAction === 'edit') openEditCHP(idx);
    if (button.dataset.dirAction === 'delete') delCHP(idx);
  };

  container.onchange = event => {
    const select = event.target.closest('[data-dir-action="coverage-status"]');
    if (!select || !container.contains(select)) return;
    updateCoverageStatus(select.dataset.subLocation || '', select.value);
  };
}

function getCoverageRows(f) {
  const coverageBySubLocation = new Map((f.coverageAreas || []).map(area => [area.sub_location, area]));
  const subLocations = new Set([
    ...(f.chps || []).map(chp => chp.village || 'Unassigned'),
    ...(f.coverageAreas || []).map(area => area.sub_location || 'Unassigned'),
  ]);

  return [...subLocations]
    .sort((a, b) => a.localeCompare(b))
    .map(subLocation => {
      const assignedChps = (f.chps || []).filter(chp => (chp.village || 'Unassigned') === subLocation).length;
      const saved = coverageBySubLocation.get(subLocation);
      return {
        subLocation,
        assignedChps: saved?.assigned_chps ?? assignedChps,
        requiredChps: saved?.required_chps ?? assignedChps,
        status: saved?.coverage_status || 'none',
        notes: saved?.notes || '',
      };
    });
}

function renderCoverageStatusOptions(selected) {
  return [
    ['active', 'Active'],
    ['partial', 'Partial'],
    ['none', 'None'],
  ]
    .map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`)
    .join('');
}

function renderCoverageTable(f) {
  const rows = getCoverageRows(f);
  const body = rows.length
    ? rows
        .map(row => `<tr>
          <td>${h(row.subLocation)}</td>
          <td>${row.assignedChps}</td>
          <td>${row.requiredChps}</td>
          <td><select class="fi" style="padding:6px 10px;font-size:12px;width:130px" data-dir-action="coverage-status" data-sub-location="${h(row.subLocation)}">${renderCoverageStatusOptions(row.status)}</select></td>
        </tr>`)
        .join('')
    : `<tr><td colspan="4" style="text-align:center;color:var(--MU)">No sub-locations assigned.</td></tr>`;

  return `
    <div class="card" style="margin-top:16px">
      <div class="ch"><span class="ct"><i class="ti ti-map-pin"></i> Coverage Sub-Locations - ${h(f.location)} Catchment</span></div>
      <table class="cov-tbl">
        <thead><tr><th>Sub-Location</th><th>CHPs Assigned</th><th>Required CHPs</th><th>Coverage Status</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

export function renderDir() {
  if (!ensurePageAccess('directory', 'chp-dir-content')) return;
  const f = fac();
  const facilities = f ? [f] : (DB.facilities || []);
  const facilityLabel = f ? `${f.location} - ${f.name}` : (facilities.length ? 'All Facilities' : '-');
  document.getElementById('dir-fac-name').textContent = facilityLabel;
  setPrintHeader(
    'dir-print-head',
    'CHP DIRECTORY',
    f ? 'Registered Community Health Promoters - ' + f.location + ' catchment' : 'Registered Community Health Promoters - All facilities',
    docCode('DIR')
  );
  const container = document.getElementById('chp-dir-content');
  const chps = facilities.flatMap(facility => (facility.chps || []).map((chp, index) => ({ chp, index, facility })));
  if (!chps.length) {
    container.innerHTML = `<div class="empty" style="background:var(--W);border:1px solid var(--BD);border-radius:10px"><i class="ti ti-users"></i><p>No CHPs registered yet.<br>Click <strong>Add CHP</strong> to register the first one.</p></div>`;
    bindDirectoryEvents(container);
    return;
  }
  const cards = chps
    .map(({ chp: c, index: i, facility }) => {
      const refs = (facility.referrals || []).filter(r => r.chp_code === c.code);
      const att = refs.filter(r => r.opd_status === 'Attended').length;
      const emg = refs.filter(r => r.priority === 'Emergency').length;
      const facilityName = `${facility.location} - ${facility.name}`;
      const actions = f ? `<button type="button" class="btn btn-s btn-sm" data-dir-action="edit" data-chp-idx="${i}" data-chp-code="${h(c.code)}"><i class="ti ti-edit"></i> Edit</button>
        <button type="button" class="btn btn-d btn-sm" data-dir-action="delete" data-chp-idx="${i}" data-chp-code="${h(c.code)}"><i class="ti ti-trash"></i></button>` : `<span class="muted-mini">Select a facility to edit</span>`;
      return `<div class="dir-card">
      <div class="dir-card-hdr">
        <span class="dir-code">${h(c.code)}</span>
        ${!f ? `<span class="muted-mini" style="margin-left:auto">${h(facilityName)}</span>` : ''}
      </div>
      <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:10px">
        <div class="dir-photo"><i class="ti ti-user"></i></div>
        <div class="dir-fields" style="flex:1">
          <div class="dir-field-row"><div class="dir-field-lbl">Name:</div><div class="dir-field-val">${h(c.name || '')}</div></div>
          <div class="dir-field-row"><div class="dir-field-lbl">ID No:</div><div class="dir-field-val">${h(c.id_no || '')}</div></div>
        </div>
      </div>
      <div class="dir-field-row"><div class="dir-field-dot"></div><div style="font-size:10px;color:var(--MU);min-width:70px">Village / Sub-Location:</div><div class="dir-field-val" style="flex:1">${h(c.village || '')}</div></div>
      <div class="dir-field-row" style="margin-top:5px"><div class="dir-field-dot"></div><div style="font-size:10px;color:var(--MU);min-width:70px">Phone:</div><div class="dir-field-val" style="flex:1;max-width:120px">${h(c.phone || '')}</div><div style="font-size:10px;color:var(--MU);min-width:70px;padding-left:10px">Community Unit:</div><div class="dir-field-val" style="flex:1">${h(c.unit || '')}</div></div>
      <div style="display:flex;gap:24px;margin:8px 0;font-size:11px">
        <span>SHA Trained: <strong>${c.sha_trained == '1' || c.sha_trained === true ? 'Yes' : 'No'}</strong></span>
        <span>Jumuisha Enrolled: <strong>${c.jumuisha == '1' || c.jumuisha === true ? 'Yes' : 'No'}</strong></span>
      </div>
      <div class="dir-stats">
        <div><div class="dir-stat-val">${refs.length}</div><div class="dir-stat-lbl">Referrals</div></div>
        <div><div class="dir-stat-val">${emg}</div><div class="dir-stat-lbl">Emergency</div></div>
        <div><div class="dir-stat-val">${att}</div><div class="dir-stat-lbl">Attended</div></div>
      </div>
      <div class="dir-notes-lbl">Notes:</div>
      <div class="dir-notes-line">${h(c.notes || '')}</div>
      <div style="display:flex;gap:6px;margin-top:10px" class="no-print">
        ${actions}
        <span class="bdg ${isActiveChp(c) ? 'bdg-t' : 'bdg-grey'}" style="margin-left:auto">${isActiveChp(c) ? 'Active' : 'Inactive'}</span>
      </div>
    </div>`;
    })
    .join('');

  container.innerHTML = `<div class="dir-grid">${cards}</div>${f ? renderCoverageTable(f) : ''}`;
  bindDirectoryEvents(container);
}

export function openAddCHP() {
  if (!ensurePageAccess('directory', 'chp-modal')) return;
  const f = fac();
  if (!f) {
    alert('Select a facility first.');
    return;
  }
  setEditingCHPIdx(-1);
  document.getElementById('chp-modal-title').innerHTML =
    '<i class="ti ti-user-plus" style="color:var(--T)"></i> &nbsp;Add CHP';
  const code = 'CHP' + String((f.chps || []).length + 1).padStart(3, '0');
  document.getElementById('m-code').value = code;
  ['m-name', 'm-id', 'm-phone', 'm-village', 'm-unit', 'm-notes'].forEach(
    id => (document.getElementById(id).value = '')
  );
  document.getElementById('m-sha').value = '0';
  document.getElementById('m-jumuisha').value = '0';
  document.getElementById('m-active').value = '1';
  openModal('chp-modal');
}

export function openEditCHP(i) {
  if (!ensurePageAccess('directory', 'chp-modal')) return;
  const f = fac();
  if (!f) return;
  const c = f.chps?.[i];
  if (!c) {
    alert('The selected CHP could not be found. Refresh the directory and try again.');
    return;
  }
  setEditingCHPIdx(i);
  document.getElementById('chp-modal-title').innerHTML =
    '<i class="ti ti-edit" style="color:var(--T)"></i> &nbsp;Edit CHP';
  document.getElementById('m-code').value = c.code;
  document.getElementById('m-name').value = c.name || '';
  document.getElementById('m-id').value = c.id_no || '';
  document.getElementById('m-phone').value = c.phone || '';
  document.getElementById('m-village').value = c.village || '';
  document.getElementById('m-unit').value = c.unit || '';
  document.getElementById('m-sha').value = c.sha_trained == '1' || c.sha_trained === true ? '1' : '0';
  document.getElementById('m-jumuisha').value = c.jumuisha == '1' || c.jumuisha === true ? '1' : '0';
  document.getElementById('m-active').value = isActiveChp(c) ? '1' : '0';
  document.getElementById('m-notes').value = c.notes || '';
  openModal('chp-modal');
}

export async function saveCHP() {
  if (!ensurePageAccess('directory', 'chp-modal')) return;
  const f = fac();
  if (!f) return;
  const name = sanitizeText(document.getElementById('m-name').value, 160);
  if (!name) {
    alert('Please enter the CHP name.');
    return;
  }
  if (!f.chps) f.chps = [];
  const obj = {
    code: sanitizeText(document.getElementById('m-code').value, 40),
    name,
    id_no: sanitizeText(document.getElementById('m-id').value, 40),
    phone: sanitizeText(document.getElementById('m-phone').value, 40),
    village: sanitizeText(document.getElementById('m-village').value, 120),
    unit: sanitizeText(document.getElementById('m-unit').value, 120),
    sha_trained: document.getElementById('m-sha').value,
    jumuisha: document.getElementById('m-jumuisha').value,
    active: document.getElementById('m-active').value,
    notes: sanitizeText(document.getElementById('m-notes').value, 500),
  };
  const existing = editingCHPIdx >= 0 ? f.chps[editingCHPIdx] : null;
  if (existing?.id) obj.id = existing.id;

  const { data, error } = await saveChpRecord(chpToPayload(obj, f.id));
  if (error) {
    alert(error.message || 'CHP could not be saved.');
    return;
  }
  obj.id = data.id;
  if (editingCHPIdx >= 0) f.chps[editingCHPIdx] = obj;
  else f.chps.push(obj);
  await audit(existing ? 'update' : 'create', 'chp_directory', data.id, { code: obj.code });
  closeModal('chp-modal');
  renderDir();
}

async function updateCoverageStatus(subLocation, status) {
  if (!ensurePageAccess('directory', 'chp-dir-content')) return;
  const f = fac();
  if (!f) return;
  if (!['active', 'partial', 'none'].includes(status)) {
    alert('Select a valid coverage status.');
    renderDir();
    return;
  }

  const assignedChps = (f.chps || []).filter(chp => (chp.village || 'Unassigned') === subLocation).length;
  const existing = (f.coverageAreas || []).find(area => area.sub_location === subLocation) || null;
  const payload = {
    facility_id: f.id,
    sub_location: subLocation,
    coverage_status: status,
    required_chps: existing?.required_chps ?? assignedChps,
    assigned_chps: assignedChps,
    notes: existing?.notes || null,
  };

  const { data, error } = await saveCoverageAreaRecord(payload);
  if (error) {
    alert(error.message || 'Coverage status could not be saved.');
    renderDir();
    return;
  }

  if (!f.coverageAreas) f.coverageAreas = [];
  const updated = {
    id: data.id,
    facility_id: data.facility_id,
    sub_location: data.sub_location,
    coverage_status: data.coverage_status,
    required_chps: data.required_chps,
    assigned_chps: data.assigned_chps,
    reviewed_by: data.reviewed_by,
    reviewed_at: data.reviewed_at,
    notes: data.notes,
  };
  const idx = f.coverageAreas.findIndex(area => area.sub_location === subLocation);
  if (idx >= 0) f.coverageAreas[idx] = updated;
  else f.coverageAreas.push(updated);
  await audit('update', 'coverage_areas', data.id, { coverage_status: status, sub_location: subLocation });
  renderDir();
}

export async function delCHP(i) {
  if (!ensurePageAccess('directory', 'chp-dir-content')) return;
  if (!confirm('Remove this CHP?')) return;
  const f = fac();
  if (!f) return;
  const c = f.chps[i];
  if (c?.id) {
    const { error } = await deleteChpRecord(c.id);
    if (error) {
      alert(error.message || 'CHP could not be deleted.');
      return;
    }
    await audit('delete', 'chp_directory', c.id, { code: c.code });
  }
  f.chps.splice(i, 1);
  renderDir();
}
