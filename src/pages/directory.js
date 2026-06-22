import { fac, editingCHPIdx, setEditingCHPIdx } from '../services/state.js';
import { saveChpRecord, deleteChpRecord } from '../services/dataService.js';
import { audit } from '../services/authService.js';
import { sanitizeText } from '../utils/sanitize.js';
import { openModal, closeModal } from '../components/modal.js';
import { setPrintHeader, docCode } from '../utils/helpers.js';

export function renderDir() {
  const f = fac();
  document.getElementById('dir-fac-name').textContent = f ? f.location + ' - ' + f.name : '-';
  if (f) {
    setPrintHeader(
      'dir-print-head',
      'CHP DIRECTORY',
      'Registered Community Health Promoters - ' + f.location + ' catchment',
      docCode('DIR')
    );
  }
  if (!f || !(f.chps || []).length) {
    document.getElementById('chp-dir-content').innerHTML = `<div class="empty" style="background:var(--W);border:1px solid var(--BD);border-radius:10px"><i class="ti ti-users"></i><p>No CHPs registered yet.<br>Click <strong>Add CHP</strong> to register the first one.</p></div>`;
    return;
  }
  const tok = f.token || 200;
  const cards = (f.chps || [])
    .map((c, i) => {
      const refs = (f.referrals || []).filter(r => r.chp_code === c.code);
      const att = refs.filter(r => r.opd_status === 'Attended').length;
      const emg = refs.filter(r => r.priority === 'Emergency').length;
      return `<div class="dir-card">
      <div class="dir-card-hdr">
        <span class="dir-code">${c.code}</span>
      </div>
      <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:10px">
        <div class="dir-photo"><i class="ti ti-user"></i></div>
        <div class="dir-fields" style="flex:1">
          <div class="dir-field-row"><div class="dir-field-lbl">Name:</div><div class="dir-field-val">${c.name || ''}</div></div>
          <div class="dir-field-row"><div class="dir-field-lbl">ID No:</div><div class="dir-field-val">${c.id_no || ''}</div></div>
        </div>
      </div>
      <div class="dir-field-row"><div class="dir-field-dot"></div><div style="font-size:10px;color:var(--MU);min-width:70px">Village / Sub-Location:</div><div class="dir-field-val" style="flex:1">${c.village || ''}</div></div>
      <div class="dir-field-row" style="margin-top:5px"><div class="dir-field-dot"></div><div style="font-size:10px;color:var(--MU);min-width:70px">Phone:</div><div class="dir-field-val" style="flex:1;max-width:120px">${c.phone || ''}</div><div style="font-size:10px;color:var(--MU);min-width:70px;padding-left:10px">Community Unit:</div><div class="dir-field-val" style="flex:1">${c.unit || ''}</div></div>
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
      <div class="dir-notes-line">${c.notes || ''}</div>
      <div style="display:flex;gap:6px;margin-top:10px" class="no-print">
        <button class="btn btn-s btn-sm" onclick="openEditCHP(${i})"><i class="ti ti-edit"></i> Edit</button>
        <button class="btn btn-d btn-sm" onclick="delCHP(${i})"><i class="ti ti-trash"></i></button>
        <span class="bdg ${c.active == '1' || c.active === true ? 'bdg-t' : 'bdg-grey'}" style="margin-left:auto">${c.active == '1' || c.active === true ? 'Active' : 'Inactive'}</span>
      </div>
    </div>`;
    })
    .join('');

  const covTable = `
    <div class="card" style="margin-top:16px">
      <div class="ch"><span class="ct"><i class="ti ti-map-pin"></i> Coverage Sub-Locations - ${f.location} Catchment</span></div>
      <table class="cov-tbl">
        <thead><tr><th>Sub-Location</th><th>CHPs Assigned</th><th>Active CHPs</th><th>Coverage Status</th></tr></thead>
        <tbody>${Array(6)
          .fill(0)
          .map(
            () => `<tr>
          <td></td><td></td><td></td>
          <td><div class="cov-check">
            <label><input type="checkbox"> Active</label>
            <label><input type="checkbox"> Partial</label>
            <label><input type="checkbox"> None</label>
          </div></td>
        </tr>`
          )
          .join('')}</tbody>
      </table>
    </div>`;

  document.getElementById('chp-dir-content').innerHTML = `<div class="dir-grid">${cards}</div>${covTable}`;
}

export function openAddCHP() {
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
  const f = fac();
  if (!f) return;
  const c = f.chps[i];
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
  document.getElementById('m-active').value = c.active == '1' || c.active === true ? '1' : '0';
  document.getElementById('m-notes').value = c.notes || '';
  openModal('chp-modal');
}

export async function saveCHP() {
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
  const payload = {
    facility_id: f.id,
    code: obj.code,
    full_name: obj.name,
    national_id: obj.id_no,
    phone: obj.phone,
    village: obj.village,
    community_unit: obj.unit,
    sha_trained: obj.sha_trained === '1',
    jumuisha_enrolled: obj.jumuisha === '1',
    active: obj.active === '1',
    notes: obj.notes,
  };
  const existing = editingCHPIdx >= 0 ? f.chps[editingCHPIdx] : null;
  if (existing?.id) payload.id = existing.id;
  const { data, error } = await saveChpRecord(payload);
  if (error) {
    alert(error.message);
    return;
  }
  obj.id = data.id;
  if (editingCHPIdx >= 0) f.chps[editingCHPIdx] = obj;
  else f.chps.push(obj);
  await audit(existing ? 'update' : 'create', 'chp_directory', data.id, { code: obj.code });
  closeModal('chp-modal');
  renderDir();
}

export async function delCHP(i) {
  if (!confirm('Remove this CHP?')) return;
  const f = fac();
  if (!f) return;
  const c = f.chps[i];
  if (c?.id) {
    const { error } = await deleteChpRecord(c.id);
    if (error) {
      alert(error.message);
      return;
    }
    await audit('delete', 'chp_directory', c.id, { code: c.code });
  }
  f.chps.splice(i, 1);
  renderDir();
}
