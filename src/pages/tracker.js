import { fac, DB } from '../services/state.js';
import { updateReferralField, deleteReferralRecord } from '../services/dataService.js';
import { audit } from '../services/authService.js';
import { sanitizeText } from '../utils/sanitize.js';
import { setPrintHeader, docCode } from '../utils/helpers.js';

export function renderTracker() {
  const f = fac();
  document.getElementById('tracker-fac-name').textContent = f ? f.location + ' - ' + f.name : '-';
  if (f) {
    setPrintHeader(
      'tracker-print-head',
      'CHP REFERRAL TRACKER REGISTER',
      'Monitor status of all community referrals - CHP to OPD attendance',
      docCode('REG')
    );
  }
  if (!f) {
    document.getElementById('tracker-tbl').innerHTML = '';
    return;
  }
  const q = (document.getElementById('t-search').value || '').toLowerCase();
  const st = document.getElementById('t-status').value;
  let refs = [...(f.referrals || [])].reverse().filter(r => {
    const mQ =
      !q ||
      (r.patient || '').toLowerCase().includes(q) ||
      (r.chp_code || '').toLowerCase().includes(q) ||
      (r.id || '').toLowerCase().includes(q);
    const mS = !st || (r.opd_status || 'Pending') === st;
    return mQ && mS;
  });

  if (!refs.length) {
    document.getElementById('tracker-tbl').innerHTML = `<div class="empty"><i class="ti ti-clipboard-list"></i><p>No referrals found. Go to <strong>New Referral</strong> to add entries.</p></div>`;
    return;
  }

  const rows = refs
    .map(r => {
      const ri = (f.referrals || []).findIndex(x => x.id === r.id);
      return `<tr>
      <td class="reg-row-num">${ri + 1}</td>
      <td style="font-family:monospace;font-size:10px;font-weight:700;color:var(--P)">${r.id}</td>
      <td><input class="reg-input" value="${r.date || ''}" style="width:90px" onchange="updRef('${f.id}',${ri},'date',this.value)"></td>
      <td><input class="reg-input" value="${r.patient || ''}" style="width:120px" onchange="updRef('${f.id}',${ri},'patient',this.value)"></td>
      <td><input class="reg-input" value="${r.age || ''}" style="width:30px" onchange="updRef('${f.id}',${ri},'age',this.value)"></td>
      <td><input class="reg-input" value="${r.sex || ''}" style="width:24px" onchange="updRef('${f.id}',${ri},'sex',this.value)"></td>
      <td style="font-weight:700;color:var(--P)">${r.chp_code || '-'}</td>
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
      <td>
        <div class="tri-check">
          <label><input type="radio" name="opd_${ri}" ${r.opd_status === 'Attended' ? 'checked' : ''} onchange="updRef('${f.id}',${ri},'opd_status','Attended')"> Attended</label>
          <label><input type="radio" name="opd_${ri}" ${r.opd_status === 'DNA' ? 'checked' : ''} onchange="updRef('${f.id}',${ri},'opd_status','DNA')"> DNA</label>
          <label><input type="radio" name="opd_${ri}" ${!r.opd_status || r.opd_status === 'Pending' ? 'checked' : ''} onchange="updRef('${f.id}',${ri},'opd_status','Pending')"> Pend</label>
        </div>
      </td>
      <td><input class="reg-input" value="${r.notes || ''}" style="width:120px" placeholder="Outcome / notes" onchange="updRef('${f.id}',${ri},'notes',this.value)"></td>
      <td><button class="btn btn-s btn-sm" onclick="delRef('${f.id}',${ri})" title="Delete"><i class="ti ti-trash"></i></button></td>
    </tr>`;
    })
    .join('');

  const allRefs = f.referrals || [];
  const totAtt = allRefs.filter(r => r.opd_status === 'Attended').length;
  const totDNA = allRefs.filter(r => r.opd_status === 'DNA').length;
  const totPend = allRefs.filter(r => !r.opd_status || r.opd_status === 'Pending').length;
  const totSha = allRefs.filter(r => r.sha === 'Yes').length;
  const totEmg = allRefs.filter(r => r.priority === 'Emergency').length;

  document.getElementById('tracker-tbl').innerHTML = `
    <div class="reg-wrap">
      <table class="reg-tbl">
        <thead><tr>
          <th>#</th><th>Slip No.</th><th>Date</th><th>Patient Name</th>
          <th>Age</th><th>Sex</th><th>CHP / Village</th><th>Category</th>
          <th>Priority</th><th>SHA</th><th>OPD Status</th><th>Outcome / Notes</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="reg-summary">
        <div class="reg-sum-item"><span class="reg-sum-lbl">Total Referrals:</span><span class="reg-sum-val">${allRefs.length}</span></div>
        <div class="reg-sum-item"><span class="reg-sum-lbl">Attended OPD:</span><span class="reg-sum-val">${totAtt}</span></div>
        <div class="reg-sum-item"><span class="reg-sum-lbl">DNA / Pending:</span><span class="reg-sum-val">${totDNA + totPend}</span></div>
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
  }
}

export async function delRef(facId, i) {
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
