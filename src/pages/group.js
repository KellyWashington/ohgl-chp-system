import { DB } from '../services/state.js';
import { ensurePageAccess } from '../services/rbac.js';
import { switchFac, showPage } from '../main.js';

export function renderGroup() {
  if (!ensurePageAccess('group', 'group-cards')) return;
  const allR = DB.facilities.flatMap(f => f.referrals || []);
  const tot = allR.length;
  const att = allR.filter(r => r.opd_status === 'Attended').length;
  const emg = allR.filter(r => r.priority === 'Emergency').length;
  const allCHPs = DB.facilities.flatMap(f => f.chps || []);
  
  document.getElementById('group-kpis').innerHTML = [
    { icon: 'ti-clipboard-list', val: tot, lbl: 'Total Referrals (Group)', c: '#6B3FA0' },
    { icon: 'ti-users', val: allCHPs.length, lbl: 'Total CHPs (Group)', c: '#00A896' },
    { icon: 'ti-circle-check', val: att, lbl: 'OPD Attended (Group)', c: '#059669' },
    { icon: 'ti-alert-triangle', val: emg, lbl: 'Emergency Cases', c: '#C62828' },
  ]
    .map(
      k =>
        `<div class="kpi" style="--kpi-c:${k.c}"><div class="kpi-icon"><i class="ti ${k.icon}"></i></div><div class="kpi-val">${k.val}</div><div class="kpi-underline"></div><div class="kpi-lbl">${k.lbl}</div></div>`
    )
    .join('');

  document.getElementById('group-cards').innerHTML = DB.facilities
    .map(
      f => `
    <div class="gcard" onclick="switchFac('${f.id}');showPage('dashboard',document.querySelectorAll('.nt')[0])">
      <div class="gcard-name">${f.name}</div>
      <div class="gcard-loc"><i class="ti ti-map-pin" style="color:var(--T);font-size:13px"></i>${f.location} - ${f.level}</div>
      <div class="gcard-stats">
        <div><div class="gsv">${(f.referrals || []).length}</div><div class="gsl">Referrals</div></div>
        <div><div class="gsv">${(f.referrals || []).filter(r => r.opd_status === 'Attended').length}</div><div class="gsl">Attended</div></div>
        <div><div class="gsv">${(f.chps || []).length}</div><div class="gsl">CHPs</div></div>
      </div>
    </div>`
    )
    .join('');
}
