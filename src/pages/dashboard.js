import { CATS, CAT_COLORS, CAT_ICONS, MONTHS } from '../constants/appConstants.js';
import { fac, DB, currentProfile } from '../services/state.js';
import { ensurePageAccess } from '../services/rbac.js';
import { filterRefs, refInCategory, setPrintHeader, docCode } from '../utils/helpers.js';
import { fetchUsers } from '../services/dataService.js';
import { h } from '../utils/sanitize.js';

export async function renderDash() {
  if (!ensurePageAccess('dashboard', 'kpi-grid')) return;
  const f = fac();
  const role = currentProfile?.role;
  if (!role) return;

  // Set header info
  if (f) {
    document.getElementById('dash-fac-name').textContent = f.location + ' - ' + f.name;
    const m = document.getElementById('d-month').value;
    const y = document.getElementById('d-year').value;
    const period = m ? MONTHS[m - 1] + ' ' + y : 'All time - ' + y;
    document.getElementById('hdr-period-val').textContent = period;
    setPrintHeader(
      'dash-print-head',
      'COMMUNITY REFERRAL DASHBOARD',
      'Live tracking across active CHPs - ' + f.location + ' catchment',
      docCode('DASH')
    );
  }

  // Render role-specific dashboard
  if (role === 'super_admin') {
    await renderSuperAdminDash();
  } else if (role === 'facility_admin') {
    renderFacilityAdminDash(f);
  } else if (role === 'facility_officer' || role === 'clinician') {
    renderFacilityOfficerDash(f);
  } else {
    renderCHPDash(f);
  }
}

// 1. CHP Dashboard
function renderCHPDash(f) {
  if (!f) return;
  
  const m = document.getElementById('d-month').value;
  const y = document.getElementById('d-year').value;
  const allRefs = filterRefs(f.referrals || [], m, y);
  
  // CHP can only see referrals they created
  const chpRefs = allRefs.filter(r => r.created_by === currentProfile.id);
  
  const total = chpRefs.length;
  const completed = chpRefs.filter(r => r.workflow_status === 'Completed' || r.status === 'Completed').length;
  const pending = chpRefs.filter(r => !['Completed', 'Closed', 'Cancelled'].includes(r.workflow_status || r.status || 'Submitted')).length;
  
  const kpis = [
    { icon: 'ti-clipboard-list', val: total, lbl: 'Total Referrals Submitted', c: '#6B3FA0' },
    { icon: 'ti-clock', val: pending, lbl: 'Pending Referrals', c: '#F59E0B' },
    { icon: 'ti-circle-check', val: completed, lbl: 'Completed Referrals', c: '#00A896' }
  ];
  
  document.getElementById('kpi-grid').innerHTML = kpis.map(k => `
    <div class="kpi" style="--kpi-c:${k.c}">
      <div class="kpi-icon"><i class="ti ${k.icon}"></i></div>
      <div class="kpi-val">${k.val}</div>
      <div class="kpi-underline"></div>
      <div class="kpi-lbl">${k.lbl}</div>
    </div>
  `).join('');
  
  // Recent 5 referrals
  const recent = [...chpRefs].slice(0, 5);
  const rows = recent.map(r => `
    <tr>
      <td style="font-family:monospace;font-weight:700">${h(r.id)}</td>
      <td>${h(r.patient)}</td>
      <td>${h(r.referral_facility || f.name)}</td>
      <td>${h(r.date)}</td>
      <td><span class="bdg bdg-t">${h(r.workflow_status || r.status || 'Submitted')}</span></td>
    </tr>
  `).join('');
  
  const card = document.getElementById('dash-card');
  if (card) {
    card.innerHTML = `
      <div class="ch"><span class="ct"><i class="ti ti-history"></i> My Recent Referrals</span></div>
      <div style="padding:15px; overflow-x:auto;">
        <table class="reg-tbl">
          <thead>
            <tr><th>Referral No</th><th>Patient Name</th><th>Destination Facility</th><th>Date</th><th>Status</th></tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="5" style="text-align:center;color:#888;">No recent referrals found.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  }
}

// 2. Facility Officer Dashboard
function renderFacilityOfficerDash(f) {
  if (!f) return;
  
  const m = document.getElementById('d-month').value;
  const y = document.getElementById('d-year').value;
  const refs = filterRefs(f.referrals || [], m, y);
  
  const todayStr = new Date().toISOString().split('T')[0];
  const receivedToday = refs.filter(r => (r.workflow_status === 'Received' || r.status === 'Received') && (r.date === todayStr || r.created?.startsWith(todayStr))).length;
  const pendingReviews = refs.filter(r => (r.workflow_status === 'Submitted' || r.status === 'Submitted')).length;
  const activeCases = refs.filter(r => ['Under Review', 'Received', 'In Consultation', 'Admitted'].includes(r.workflow_status || r.status)).length;
  const completedCases = refs.filter(r => r.workflow_status === 'Completed' || r.status === 'Completed').length;
  
  const kpis = [
    { icon: 'ti-bell', val: receivedToday, lbl: 'Referrals Received Today', c: '#0284c7' },
    { icon: 'ti-clipboard-text', val: pendingReviews, lbl: 'Pending Reviews', c: '#F59E0B' },
    { icon: 'ti-heart-rate-monitor', val: activeCases, lbl: 'Active Cases', c: '#6B3FA0' },
    { icon: 'ti-discount-check', val: completedCases, lbl: 'Completed Cases', c: '#00A896' }
  ];
  
  document.getElementById('kpi-grid').innerHTML = kpis.map(k => `
    <div class="kpi" style="--kpi-c:${k.c}">
      <div class="kpi-icon"><i class="ti ${k.icon}"></i></div>
      <div class="kpi-val">${k.val}</div>
      <div class="kpi-underline"></div>
      <div class="kpi-lbl">${k.lbl}</div>
    </div>
  `).join('');
  
  // Render active referrals worklist card
  const activeRefs = refs.filter(r => ['Submitted', 'Under Review', 'Received'].includes(r.workflow_status || r.status || 'Submitted')).slice(0, 5);
  const rows = activeRefs.map(r => `
    <tr>
      <td style="font-family:monospace;font-weight:700">${h(r.id)}</td>
      <td>${h(r.patient)}</td>
      <td>${h(r.chp_code)}</td>
      <td>${h(r.priority)}</td>
      <td><span class="bdg bdg-t">${h(r.workflow_status || r.status || 'Submitted')}</span></td>
    </tr>
  `).join('');
  
  const card = document.getElementById('dash-card');
  if (card) {
    card.innerHTML = `
      <div class="ch"><span class="ct"><i class="ti ti-alert-circle"></i> Attention Needed (Active Worklist)</span></div>
      <div style="padding:15px; overflow-x:auto;">
        <table class="reg-tbl">
          <thead>
            <tr><th>Referral No</th><th>Patient Name</th><th>CHP Code</th><th>Priority</th><th>Status</th></tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="5" style="text-align:center;color:#888;">No active referrals waiting review.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  }
}

// 3. Facility Administrator Dashboard
function renderFacilityAdminDash(f) {
  if (!f) return;
  
  const m = document.getElementById('d-month').value;
  const y = document.getElementById('d-year').value;
  const refs = filterRefs(f.referrals || [], m, y);
  
  const total = refs.length;
  const completed = refs.filter(r => r.workflow_status === 'Completed' || r.status === 'Completed').length;
  
  // Facility Performance metrics
  const completionRate = total ? Math.round((completed / total) * 100) : 0;
  const activeCHPsCount = (f.chps || []).filter(c => c.active).length;
  const totalTokens = completed * (f.token || 200);
  
  const kpis = [
    { icon: 'ti-trending-up', val: `${completionRate}%`, lbl: 'Case Completion Rate', c: '#00A896' },
    { icon: 'ti-users', val: activeCHPsCount, lbl: 'Active CHPs (Catchment)', c: '#6B3FA0' },
    { icon: 'ti-coin', val: `KES ${totalTokens.toLocaleString()}`, lbl: 'Total Sign-off Tokens', c: '#3b82f6' }
  ];
  
  document.getElementById('kpi-grid').innerHTML = kpis.map(k => `
    <div class="kpi" style="--kpi-c:${k.c}">
      <div class="kpi-icon"><i class="ti ${k.icon}"></i></div>
      <div class="kpi-val" style="font-size: 18px; line-height: 1.5;">${k.val}</div>
      <div class="kpi-underline"></div>
      <div class="kpi-lbl">${k.lbl}</div>
    </div>
  `).join('');
  
  // Department statistics calculation
  const deptStats = {};
  refs.forEach(r => {
    const dept = r.department || 'General OPD';
    deptStats[dept] = (deptStats[dept] || 0) + 1;
  });
  
  const deptList = Object.entries(deptStats).map(([dept, count]) => {
    const pct = total ? Math.round((count / total) * 100) : 0;
    return `
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600;margin-bottom:4px">
          <span>${h(dept)}</span><span>${count} (${pct}%)</span>
        </div>
        <div style="height:6px;background:#eee;border-radius:3px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:var(--P,#6B3FA0)"></div>
        </div>
      </div>
    `;
  }).join('');
  
  // Referral Trends calculation (by month)
  const monthlyTrends = {};
  f.referrals.forEach(r => {
    if (r.date) {
      const monthIdx = new Date(r.date).getMonth();
      if (!isNaN(monthIdx)) {
        monthlyTrends[monthIdx] = (monthlyTrends[monthIdx] || 0) + 1;
      }
    }
  });
  
  const trendList = MONTHS.map((name, idx) => {
    const count = monthlyTrends[idx] || 0;
    return `
      <div style="text-align:center;flex:1;min-width:30px">
        <div style="font-size:10px;color:#888;margin-bottom:4px">${count}</div>
        <div style="height:60px;background:#f1f5f9;border-radius:2px;display:flex;align-items:flex-end;justify-content:center;margin:0 auto 4px">
          <div style="width:12px;height:${Math.min(50, count * 4)}px;background:var(--T,#00A896);border-radius:2px"></div>
        </div>
        <div style="font-size:10px;font-weight:600">${name}</div>
      </div>
    `;
  }).join('');
  
  const card = document.getElementById('dash-card');
  if (card) {
    card.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:15px">
        <div class="card" style="box-shadow:none;border:1px solid #f1f5f9;margin:0">
          <div class="ch"><span class="ct"><i class="ti ti-chart-bar"></i> Department Statistics</span></div>
          <div style="padding:15px">${deptList || '<div style="color:#888;font-size:12px;text-align:center;">No departmental data.</div>'}</div>
        </div>
        <div class="card" style="box-shadow:none;border:1px solid #f1f5f9;margin:0">
          <div class="ch"><span class="ct"><i class="ti ti-chart-line"></i> Referral Trends (Current Year)</span></div>
          <div style="padding:15px;display:flex;gap:4px;justify-content:space-between;align-items:flex-end;height:120px">${trendList}</div>
        </div>
      </div>
    `;
  }
}

// 4. Super Admin Dashboard
async function renderSuperAdminDash() {
  const facCount = DB.facilities.length;
  
  // Calculate total referrals across all facilities
  let totalRefs = 0;
  DB.facilities.forEach(f => {
    totalRefs += (f.referrals || []).length;
  });
  
  // Fetch users count from Supabase
  let usersCount = 0;
  try {
    const { data: usersList, error } = await fetchUsers();
    if (!error && usersList) {
      usersCount = usersList.length;
    }
  } catch (err) {
    console.error('Failed to load total users count', err);
  }
  
  const kpis = [
    { icon: 'ti-building-hospital', val: facCount, lbl: 'Total Registered Facilities', c: '#00A896' },
    { icon: 'ti-users', val: usersCount, lbl: 'Total Provisioned Users', c: '#6B3FA0' },
    { icon: 'ti-clipboard-list', val: totalRefs, lbl: 'Total System Referrals', c: '#F59E0B' }
  ];
  
  document.getElementById('kpi-grid').innerHTML = kpis.map(k => `
    <div class="kpi" style="--kpi-c:${k.c}">
      <div class="kpi-icon"><i class="ti ${k.icon}"></i></div>
      <div class="kpi-val">${k.val}</div>
      <div class="kpi-underline"></div>
      <div class="kpi-lbl">${k.lbl}</div>
    </div>
  `).join('');
  
  // Render referral trends across the system
  const systemTrends = {};
  DB.facilities.forEach(f => {
    (f.referrals || []).forEach(r => {
      if (r.date) {
        const monthIdx = new Date(r.date).getMonth();
        if (!isNaN(monthIdx)) {
          systemTrends[monthIdx] = (systemTrends[monthIdx] || 0) + 1;
        }
      }
    });
  });
  
  const trendList = MONTHS.map((name, idx) => {
    const count = systemTrends[idx] || 0;
    return `
      <div style="text-align:center;flex:1;min-width:30px">
        <div style="font-size:10px;color:#888;margin-bottom:4px">${count}</div>
        <div style="height:60px;background:#f1f5f9;border-radius:2px;display:flex;align-items:flex-end;justify-content:center;margin:0 auto 4px">
          <div style="width:12px;height:${Math.min(50, count * 2)}px;background:var(--P,#6B3FA0);border-radius:2px"></div>
        </div>
        <div style="font-size:10px;font-weight:600">${name}</div>
      </div>
    `;
  }).join('');
  
  // Facilities summary table
  const facRows = DB.facilities.map(f => `
    <tr>
      <td><strong>${h(f.name)}</strong></td>
      <td>${h(f.location)}</td>
      <td>${h(f.level)}</td>
      <td>${(f.chps || []).length}</td>
      <td>${(f.referrals || []).length}</td>
    </tr>
  `).join('');
  
  const card = document.getElementById('dash-card');
  if (card) {
    card.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:15px">
        <div class="card" style="box-shadow:none;border:1px solid #f1f5f9;margin:0">
          <div class="ch"><span class="ct"><i class="ti ti-list"></i> Facility Summary Table</span></div>
          <div style="padding:15px; overflow-x:auto;">
            <table class="reg-tbl">
              <thead>
                <tr><th>Facility Name</th><th>Location</th><th>Level</th><th>CHPs</th><th>Referrals</th></tr>
              </thead>
              <tbody>
                ${facRows || '<tr><td colspan="5" style="text-align:center;color:#888;">No facilities registered.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
        <div class="card" style="box-shadow:none;border:1px solid #f1f5f9;margin:0">
          <div class="ch"><span class="ct"><i class="ti ti-chart-line"></i> System-wide Monthly Trends</span></div>
          <div style="padding:15px;display:flex;gap:4px;justify-content:space-between;align-items:flex-end;height:120px">${trendList}</div>
        </div>
      </div>
    `;
  }
}

