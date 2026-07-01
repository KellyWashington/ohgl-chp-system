import { fac, DB } from '../services/state.js';
import { ensurePageAccess } from '../services/rbac.js';
import { updateReferralField, deleteReferralRecord } from '../services/dataService.js';
import { audit } from '../services/authService.js';
import { sanitizeText } from '../utils/sanitize.js';
import { setPrintHeader, docCode } from '../utils/helpers.js';
import { integrations } from '../services/integrationService.js';

let trackerPage = 1;
const PAGE_SIZE = 10;

export function renderTracker(nextPage = trackerPage) {
  if (!ensurePageAccess('tracker', 'tracker-tbl')) return;
  const f = fac();
  trackerPage = Math.max(1, nextPage);

  document.getElementById('tracker-fac-name').textContent = f ? f.location + ' - ' + f.name : '-';
  if (f) {
    setPrintHeader(
      'dash-print-head',
      'CHP REFERRAL TRACKER REGISTER',
      'Monitor status of all community referrals - CHP to OPD attendance',
      docCode('REG')
    );
  }
  if (!f) {
    document.getElementById('tracker-tbl').innerHTML = '';
    return;
  }
  const q = (document.getElementById('t-search').value || '').trim().toLowerCase();
  const st = document.getElementById('t-status').value;
  const pri = document.getElementById('t-priority')?.value || '';
  const sha = document.getElementById('t-sha')?.value || '';
  const from = document.getElementById('t-from')?.value || '';
  const to = document.getElementById('t-to')?.value || '';
  const chpsByCode = new Map((f.chps || []).map(c => [c.code, c]));
  let refs = [...(f.referrals || [])].reverse().filter(r => {
    const chp = chpsByCode.get(r.chp_code) || {};
    const haystack = [
      r.patient,
      r.id,
      r.chp_code,
      chp.name,
      chp.phone,
      chp.village,
      chp.unit,
      r.chp_unit,
      r.category,
      r.priority,
      r.sha,
      r.complaint,
      r.notes,
      r.received_by,
      r.file_no,
      r.sha_no,
      r.date,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const mQ = !q || haystack.includes(q);
    const status = r.workflow_status || r.status || 'Submitted';
    const mS = !st || status === st;
    const mP = !pri || r.priority === pri;
    const mSha = !sha || r.sha === sha;
    const mFrom = !from || (r.date || '') >= from;
    const mTo = !to || (r.date || '') <= to;
    return mQ && mS && mP && mSha && mFrom && mTo;
  });

  if (!refs.length) {
    document.getElementById('tracker-tbl').innerHTML = `<div class="empty"><i class="ti ti-clipboard-list"></i><p>No referrals found. Go to <strong>New Referral</strong> to add entries.</p></div>`;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(refs.length / PAGE_SIZE));
  trackerPage = Math.min(trackerPage, totalPages);
  const visibleRefs = refs.slice((trackerPage - 1) * PAGE_SIZE, trackerPage * PAGE_SIZE);

  const rows = visibleRefs
    .map(r => {
      const ri = (f.referrals || []).findIndex(x => x.id === r.id);
      return `<tr>
      <td class="reg-row-num">${ri + 1}</td>
      <td style="font-family:monospace;font-size:10px;font-weight:700;color:var(--P)">${r.id}</td>
      <td><input class="reg-input" value="${r.date || ''}" style="width:90px" onchange="updRef('${f.id}',${ri},'date',this.value)"></td>
      <td><input class="reg-input" value="${r.patient || ''}" style="width:120px" onchange="updRef('${f.id}',${ri},'patient',this.value)"></td>
      <td><input class="reg-input" value="${r.age || ''}" style="width:30px" onchange="updRef('${f.id}',${ri},'age',this.value)"></td>
      <td><input class="reg-input" value="${r.sex || ''}" style="width:24px" onchange="updRef('${f.id}',${ri},'sex',this.value)"></td>
      <td style="font-weight:700;color:var(--P)">${r.chp_code || '-'}<br><span class="muted-mini">${(f.chps || []).find(c => c.code === r.chp_code)?.village || r.chp_unit || ''}</span></td>
      <td style="font-size:10px">${r.file_no || '-'}<br><span class="muted-mini">${r.sha_no || ''}</span></td>
      <td style="font-size:10px">${r.category || '-'}</td>
      <td>
        <div class="tri-check">
          <label><input type="radio" name="pri_${ri}" ${r.priority === 'Routine' ? 'checked' : ''} onchange="updRef('${f.id}',${ri},'priority','Routine')"> Rtn</label>
          <label><input type="radio" name="pri_${ri}" ${r.priority === 'Urgent' ? 'checked' : ''} onchange="updRef('${f.id}',${ri},'priority','Urgent')"> Urg</label>
          <label><input type="radio" name="pri_${ri}" ${r.priority === 'Emergency' ? 'checked' : ''} onchange="updRef('${f.id}',${ri},'priority','Emergency')"> Emg</label>
        </div>
      </td>
      <td>
        <div class="tri-check">
          <label><input type="radio" name="sha_${ri}" ${r.sha === 'Yes' ? 'checked' : ''} onchange="updRef('${f.id}',${ri},'sha','Yes')"> Y</label>
          <label><input type="radio" name="sha_${ri}" ${r.sha === 'No' ? 'checked' : ''} onchange="updRef('${f.id}',${ri},'sha','No')"> N</label>
        </div>
      </td>
      <td><select class="ss" onchange="updRef('${f.id}',${ri},'workflow_status',this.value)">${['Submitted','Under Review','Received','In Consultation','Admitted','Completed','Closed','Cancelled'].map(st => `<option ${((r.workflow_status || r.status || 'Submitted') === st) ? 'selected' : ''}>${st}</option>`).join('')}</select></td>
      <td><input class="reg-input" value="${r.received_by || ''}" style="width:110px" placeholder="Received by" onchange="updRef('${f.id}',${ri},'received_by',this.value)"><input class="reg-input" value="${r.file_no || ''}" style="width:90px" placeholder="File no" onchange="updRef('${f.id}',${ri},'file_no',this.value)"><input class="reg-input" value="${r.sha_no || ''}" style="width:90px" placeholder="SHA no" onchange="updRef('${f.id}',${ri},'sha_no',this.value)"></td>
      <td><input class="reg-input" value="${r.notes || ''}" style="width:120px" placeholder="Outcome / notes" onchange="updRef('${f.id}',${ri},'notes',this.value)"></td>
      <td><button class="btn btn-s btn-sm" onclick="delRef('${f.id}',${ri})" title="Delete"><i class="ti ti-trash"></i></button></td>
      </tr>`;
    })
    .join('');

  const allRefs = f.referrals || [];
  const totAtt = allRefs.filter(r => (r.workflow_status || r.status) === 'Completed').length;
  const totDNA = allRefs.filter(r => ['Closed', 'Cancelled'].includes(r.workflow_status || r.status)).length;
  const totPend = allRefs.filter(r => ['Submitted', 'Under Review', 'Received', 'In Consultation', 'Admitted'].includes(r.workflow_status || r.status || 'Submitted')).length;
  const totSha = allRefs.filter(r => r.sha === 'Yes').length;
  const totEmg = allRefs.filter(r => r.priority === 'Emergency').length;

  document.getElementById('tracker-tbl').innerHTML = `
    <div class="reg-wrap">
      <table class="reg-tbl">
        <thead><tr>
          <th>#</th><th>Slip No.</th><th>Date</th><th>Patient Name</th>
          <th>Age</th><th>Sex</th><th>CHP / Village</th><th>File / SHA</th><th>Category</th>
          <th>Priority</th><th>SHA</th><th>Workflow Status</th><th>Facility Fields</th><th>Outcome / Notes</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="pager no-print" style="margin: 15px 0; display: flex; gap: 10px; align-items: center; justify-content: center;">
        <button class="btn btn-s btn-sm" ${trackerPage === 1 ? 'disabled' : ''} onclick="renderTracker(${trackerPage - 1})"><i class="ti ti-chevron-left"></i> Prev</button>
        <span>Page ${trackerPage} of ${totalPages}</span>
        <button class="btn btn-s btn-sm" ${trackerPage === totalPages ? 'disabled' : ''} onclick="renderTracker(${trackerPage + 1})">Next <i class="ti ti-chevron-right"></i></button>
      </div>
      <div class="reg-summary">
        <div class="reg-sum-item"><span class="reg-sum-lbl">Total Referrals:</span><span class="reg-sum-val">${allRefs.length}</span></div>
        <div class="reg-sum-item"><span class="reg-sum-lbl">Completed:</span><span class="reg-sum-val">${totAtt}</span></div>
        <div class="reg-sum-item"><span class="reg-sum-lbl">Active:</span><span class="reg-sum-val">${totPend}</span></div>
        <div class="reg-sum-item"><span class="reg-sum-lbl">Closed / Cancelled:</span><span class="reg-sum-val">${totDNA}</span></div>
        <div class="reg-sum-item"><span class="reg-sum-lbl">SHA Registered:</span><span class="reg-sum-val">${totSha}</span></div>
        <div class="reg-sum-item"><span class="reg-sum-lbl">Emergency Cases:</span><span class="reg-sum-val">${totEmg}</span></div>
      </div>
      <div class="reg-sign">
        <div class="reg-sign-item"><span>Compiled by:</span><div class="reg-sign-line">${f.compiler || ''}</div></div>
        <div class="reg-sign-item"><span>Signature:</span><div class="reg-sign-line"></div></div>
        <div class="reg-sign-item"><span>Date:</span><div class="reg-sign-line"></div></div>
      </div>
    </div>`;
}

export async function updRef(facId, i, field, val) {
  if (!ensurePageAccess('tracker', 'tracker-tbl')) return;
  const f = DB.facilities.find(x => x.id === facId);
  if (!f || !f.referrals[i]) return;
  const r = f.referrals[i];
  r[field] = sanitizeText(val, 1000);
  const map = {
    date: 'referral_date',
    patient: 'patient_name',
    age: 'age',
    sex: 'sex',
    priority: 'priority',
    sha: 'sha_registered',
    opd_status: 'opd_status',
    workflow_status: 'workflow_status',
    received_by: 'received_by',
    file_no: 'file_no',
    sha_no: 'sha_no',
    notes: 'clinical_notes',
  };
  const dbField = map[field];
  if (dbField && r.db_id) {
    const { error } = await updateReferralField(r.db_id, field, val);
    if (error) {
      alert(error.message);
      return;
    }
    await audit('update', 'referrals', r.db_id, { field });
    
    // Future-Ready Integration Sync (non-blocking)
    if (field === 'workflow_status' && val === 'Completed') {
      integrations.syncReferralToEMR(r).catch(err => console.error('[EMR Sync Error]', err));
      integrations.pushAggregateToDHIS2({ event: 'referral_completion', id: r.id, facility: f.name }).catch(err => console.error('[DHIS2 Sync Error]', err));
    }
  }
}

export async function delRef(facId, i) {
  if (!ensurePageAccess('tracker', 'tracker-tbl')) return;
  if (!confirm('Delete this referral?')) return;
  const f = DB.facilities.find(x => x.id === facId);
  if (!f) return;
  const r = f.referrals[i];
  if (r?.db_id) {
    const { error } = await deleteReferralRecord(r.db_id);
    if (error) {
      alert(error.message);
      return;
    }
    await audit('delete', 'referrals', r.db_id, { slip_no: r.id });
  }
  f.referrals.splice(i, 1);
  renderTracker();
}
