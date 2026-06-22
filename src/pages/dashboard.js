import { CATS, CAT_COLORS, CAT_ICONS, MONTHS } from '../constants/appConstants.js';
import { fac } from '../services/state.js';
import { filterRefs, refInCategory, setPrintHeader, docCode } from '../utils/helpers.js';

export function renderDash() {
  const f = fac();
  if (!f) return;
  
  document.getElementById('dash-fac-name').textContent = f.location + ' - ' + f.name;
  const m = document.getElementById('d-month').value;
  const y = document.getElementById('d-year').value;
  const refs = filterRefs(f.referrals, m, y);
  const tot = refs.length;
  const att = refs.filter(r => r.opd_status === 'Attended').length;
  const pend = refs.filter(r => !r.opd_status || r.opd_status === 'Pending').length;
  const emg = refs.filter(r => r.priority === 'Emergency').length;
  const sha = refs.filter(r => r.sha === 'Yes').length;
  const tok = att * (f.token || 200);
  const period = m ? MONTHS[m - 1] + ' ' + y : 'All time - ' + y;
  
  document.getElementById('hdr-period-val').textContent = period;
  setPrintHeader(
    'dash-print-head',
    'COMMUNITY REFERRAL DASHBOARD',
    'Live tracking across active CHPs - ' + f.location + ' catchment',
    docCode('DASH')
  );

  const kpiDefs = [
    { icon: 'ti-clipboard-list', val: tot, lbl: 'Total Referrals', c: '#6B3FA0' },
    { icon: 'ti-clock', val: pend, lbl: 'Pending Review', c: '#F59E0B' },
    { icon: 'ti-circle-check', val: att, lbl: 'Received at OPD', c: '#00A896' },
    { icon: 'ti-alert-triangle', val: emg, lbl: 'Emergency Flags', c: '#C62828' },
  ];
  
  document.getElementById('kpi-grid').innerHTML = kpiDefs
    .map(
      k => `
    <div class="kpi" style="--kpi-c:${k.c}">
      <div class="kpi-icon"><i class="ti ${k.icon}"></i></div>
      <div class="kpi-val">${k.val}</div>
      <div class="kpi-underline"></div>
      <div class="kpi-lbl">${k.lbl}</div>
    </div>`
    )
    .join('');

  document.getElementById('cat-grid').innerHTML = CATS.map((cat, i) => {
    const n = refs.filter(r => refInCategory(r, cat)).length;
    const pct = tot ? Math.round((n / tot) * 100) : 0;
    return `<div class="cat-card">
      <div class="cat-top">
        <div class="cat-dot" style="background:${CAT_COLORS[i]}"></div>
        <div class="cat-name" style="color:${CAT_COLORS[i]}">${cat.label}</div>
        <div class="cat-icon-box">${CAT_ICONS[i]}</div>
      </div>
      <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${pct}%;background:${CAT_COLORS[i]}"></div></div>
      <div class="cat-stats">Referrals: <span>${n}</span> &nbsp; %: <span>${pct}%</span></div>
    </div>`;
  }).join('');
}
