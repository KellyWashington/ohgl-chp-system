import { MONTHS } from '../constants/appConstants.js';
import { fac } from '../services/state.js';
import { filterRefs } from '../utils/helpers.js';

export function renderReport() {
  const f = fac();
  if (!f) {
    document.getElementById('report-content').innerHTML = `<div class="alert alert-i"><i class="ti ti-info-circle"></i> Please select a facility.</div>`;
    return;
  }
  const y = parseInt(document.getElementById('r-year').value) || 2026;
  const yRefs = (f.referrals || []).filter(r => r.date && new Date(r.date).getFullYear() === y);
  const tok = f.token || 200;
  const totAtt = yRefs.filter(r => r.opd_status === 'Attended').length;
  const totEmg = yRefs.filter(r => r.priority === 'Emergency').length;
  const totSha = yRefs.filter(r => r.sha === 'Yes').length;
  const totTok = totAtt * tok;

  // SECTION 1: header
  const repHdr = `<div class="card" style="border-top:4px solid var(--P);text-align:center;padding:16px 20px">
    <div style="font-size:16px;font-weight:700;color:var(--PD)">OASIS HEALTH - Oasis Healthcare Group Limited</div>
    <div style="font-size:12px;color:var(--MU)">CHP Engagement &amp; Community Referral Tracking System</div>
    <div style="font-size:11px;color:var(--MU);margin-top:3px">${f.location} - ${f.name} &nbsp;-&nbsp; ${f.level} &nbsp;-&nbsp; Report Year: ${y}</div>
    <div style="font-size:10px;color:var(--MU);font-family:monospace;margin-top:2px">OHGL-CHP-DASH-${y} &nbsp;-&nbsp; CONFIDENTIAL - OHGL Internal Document</div>
  </div>`;

  // SECTION 2: monthly trend table (matches PDF page 2 exactly)
  const trendMetrics = [
    { lbl: 'Total Referrals', fn: r => r.length, color: '#00A896' },
    { lbl: 'Attended OPD', fn: r => r.filter(x => x.opd_status === 'Attended').length, color: '#059669' },
    { lbl: 'Emergency', fn: r => r.filter(x => x.priority === 'Emergency').length, color: '#C62828' },
    { lbl: 'SHA Registered', fn: r => r.filter(x => x.sha === 'Yes').length, color: '#1E40AF' },
    { lbl: 'Pending', fn: r => r.filter(x => !x.opd_status || x.opd_status === 'Pending').length, color: '#F59E0B' },
  ];
  const trendRows = trendMetrics
    .map(m => {
      const vals = MONTHS.map((_, mi) => m.fn(yRefs.filter(r => new Date(r.date).getMonth() === mi)));
      const tot = vals.reduce((a, b) => a + b, 0);
      return `<tr>
      <td><span class="metric-pill" style="background:${m.color}"></span>${m.lbl}</td>
      ${vals.map(v => `<td>${v || '-'}</td>`).join('')}
      <td style="font-weight:700;background:var(--PXL);color:${m.color}">${tot}</td>
    </tr>`;
    })
    .join('');

  const trendSec = `<div class="card">
    <div class="ch"><span class="ct"><i class="ti ti-chart-line"></i> Monthly Trend - Referral Performance</span></div>
    <div style="overflow-x:auto">
    <table class="trend-tbl">
      <thead><tr><th>Month</th>${MONTHS.map(m => `<th>${m}</th>`).join('')}<th style="background:var(--PXL)">Total</th></tr></thead>
      <tbody>${trendRows}</tbody>
    </table></div>
  </div>`;

  // SECTION 3: CHP Performance Summary table (matches PDF page 2 exactly)
  const chpRows = (f.chps || [])
    .map(c => {
      const cr = yRefs.filter(r => r.chp_code === c.code);
      const ca = cr.filter(r => r.opd_status === 'Attended').length;
      const ce = cr.filter(r => r.priority === 'Emergency').length;
      const cs = cr.filter(r => r.sha === 'Yes').length;
      return `<tr>
      <td style="font-weight:700;color:var(--P)">${c.code}</td>
      <td>${c.name || '-'}</td>
      <td style="font-size:11px">${c.unit || '-'}</td>
      <td style="text-align:center">${cr.length}</td>
      <td style="text-align:center">${ca}</td>
      <td style="text-align:center">${ce}</td>
      <td style="text-align:center">${cs}</td>
      <td style="text-align:center;font-weight:600">KES ${(ca * tok).toLocaleString()}</td>
      <td>
        <div class="chk-pair">
          <label><input type="checkbox" ${c.active == '1' || c.active === true ? 'checked' : ''}> Active</label>
          <label><input type="checkbox" ${!(c.active == '1' || c.active === true) ? 'checked' : ''}> Inact.</label>
        </div>
      </td>
    </tr>`;
    })
    .join('');

  const chpSec = (f.chps || []).length
    ? `<div class="card">
    <div class="ch"><span class="ct"><i class="ti ti-users"></i> CHP Performance Summary</span></div>
    <div style="overflow-x:auto"><table class="perf-tbl">
      <thead><tr><th>CHP Code</th><th>Name</th><th>Community Unit</th><th>Referrals</th><th>Attended</th><th>Emergency</th><th>SHA Reg.</th><th>Token Due (KES)</th><th>Status</th></tr></thead>
      <tbody>${chpRows}</tbody>
      <tfoot><tr style="background:var(--PXL)">
        <td colspan="3" style="font-weight:700;color:var(--PD)">TOTALS</td>
        <td style="text-align:center;font-weight:700">${yRefs.length}</td>
        <td style="text-align:center;font-weight:700">${totAtt}</td>
        <td style="text-align:center;font-weight:700">${totEmg}</td>
        <td style="text-align:center;font-weight:700">${totSha}</td>
        <td style="text-align:center;font-weight:700">KES ${totTok.toLocaleString()}</td>
        <td></td>
      </tr></tfoot>
    </table></div>
  </div>`
    : '';

  // SECTION 4: Period Summary & Sign-Off (matches PDF page 3 exactly)
  const signoff = `<div class="card">
    <div class="ch"><span class="ct"><i class="ti ti-clipboard-text"></i> Period Summary, Observations &amp; Sign-Off</span></div>
    <div class="signoff-box">
      <div class="signoff-title">Period Summary &amp; Sign-Off</div>
      <div class="signoff-grid">
        <div class="sf"><div class="sf-lbl">Total Active CHPs:</div><div class="sf-line">${(f.chps || []).filter(c => c.active == '1' || c.active === true).length}</div></div>
        <div class="sf"><div class="sf-lbl">Data Compiled By:</div><div class="sf-line">${f.compiler || ''}</div></div>
        <div class="sf"><div class="sf-lbl">Total Referrals This Period:</div><div class="sf-line">${yRefs.length}</div></div>
        <div class="sf"><div class="sf-lbl">Designation:</div><div class="sf-line"></div></div>
        <div class="sf"><div class="sf-lbl">OPD Attendance Rate:</div><div class="sf-line">${yRefs.length ? Math.round((totAtt / yRefs.length) * 100) + '%' : '-'}</div></div>
        <div class="sf"><div class="sf-lbl">Signature:</div><div class="sf-line"></div></div>
        <div class="sf"><div class="sf-lbl">SHA Registration Rate:</div><div class="sf-line">${yRefs.length ? Math.round((totSha / yRefs.length) * 100) + '%' : '-'}</div></div>
        <div class="sf"><div class="sf-lbl">Date of Submission:</div><div class="sf-line"></div></div>
        <div class="sf"><div class="sf-lbl">Emergency Cases Escalated:</div><div class="sf-line">${totEmg}</div></div>
        <div class="sf"><div class="sf-lbl">Reviewed By (COIC):</div><div class="sf-line">${f.coic || ''}</div></div>
        <div class="sf"><div class="sf-lbl">Tokens Due for Payment:</div><div class="sf-line">KES ${totTok.toLocaleString()}</div></div>
        <div class="sf"><div class="sf-lbl">Signature:</div><div class="sf-line"></div></div>
      </div>
    </div>
    <div style="font-size:12px;font-weight:600;color:var(--PD);margin-bottom:10px">Key Observations &amp; Action Items</div>
    <div class="card" style="padding:14px;box-shadow:none;border:1px solid var(--BD)">
      <div class="obs-list">
        ${Array.from({ length: 9 }, (_, i) => `<div class="obs-item"><div class="obs-num">${i + 1}</div><div class="obs-line"></div></div>`).join('')}
      </div>
    </div>
    <div class="meeting-bar" style="margin-top:14px">
      <div class="meeting-bar-lbl">Next CHP Coordination Meeting:</div>
      <div><div style="font-size:10px;color:var(--MU)">Date:</div><div class="meeting-bar-val"></div></div>
      <div class="meeting-bar-lbl">Venue:</div>
      <div><div class="meeting-bar-val"></div></div>
      <div class="meeting-bar-lbl">Chairperson:</div>
      <div><div class="meeting-bar-val"></div></div>
    </div>
    <div style="margin-top:14px;padding:10px 14px;background:var(--PXL);border-radius:8px;font-size:10px;color:var(--MU);text-align:center;border:1px solid var(--BD)">
      OHGL-CHP-DASH-${y} &nbsp;|&nbsp; CONFIDENTIAL - OHGL Internal Document &nbsp;|&nbsp; ${f.location} - ${f.name} &nbsp;|&nbsp; Page 3
    </div>
  </div>`;

  document.getElementById('report-content').innerHTML = repHdr + trendSec + chpSec + signoff;
}
