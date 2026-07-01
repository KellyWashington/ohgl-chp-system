import { MONTHS } from '../constants/appConstants.js';
import { fac, DB, currentProfile } from '../services/state.js';
import { ensurePageAccess } from '../services/rbac.js';
import { h } from '../utils/sanitize.js';

export function onReportFilterTypeChange() {
  const filterType = document.getElementById('r-filter-type')?.value;
  const monthCont = document.getElementById('r-month-select-container');
  const customCont = document.getElementById('r-custom-dates');
  
  if (monthCont && customCont) {
    if (filterType === 'custom') {
      monthCont.style.display = 'none';
      customCont.style.display = 'flex';
    } else if (filterType === 'monthly') {
      monthCont.style.display = 'block';
      customCont.style.display = 'none';
    } else {
      monthCont.style.display = 'none';
      customCont.style.display = 'none';
    }
  }
  renderReport();
}

function getReportDateRange() {
  const filterType = document.getElementById('r-filter-type')?.value || 'monthly';
  const now = new Date();
  let start, end;
  
  if (filterType === 'daily') {
    const today = now.toISOString().split('T')[0];
    start = new Date(today + 'T00:00:00');
    end = new Date(today + 'T23:59:59');
  } else if (filterType === 'weekly') {
    const startWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    startWeek.setHours(0, 0, 0, 0);
    start = startWeek;
    end = new Date(now.getTime());
  } else if (filterType === 'monthly') {
    const m = parseInt(document.getElementById('r-month')?.value) || (now.getMonth() + 1);
    const y = parseInt(document.getElementById('r-year')?.value) || now.getFullYear();
    start = new Date(y, m - 1, 1, 0, 0, 0);
    end = new Date(y, m, 0, 23, 59, 59);
  } else if (filterType === 'custom') {
    const startVal = document.getElementById('r-start-date')?.value;
    const endVal = document.getElementById('r-end-date')?.value;
    start = startVal ? new Date(startVal + 'T00:00:00') : new Date(0);
    end = endVal ? new Date(endVal + 'T23:59:59') : new Date();
  }
  return { start, end };
}

export function renderReport() {
  if (!ensurePageAccess('report', 'report-content')) return;
  const f = fac();
  if (!f && currentProfile?.role !== 'super_admin') {
    document.getElementById('report-content').innerHTML = `<div class="alert alert-i"><i class="ti ti-info-circle"></i> Please select a facility.</div>`;
    return;
  }

  const { start, end } = getReportDateRange();
  const reportType = document.getElementById('r-type').value;
  
  // 1. Gather relevant referrals based on user role (Super Admin can see all facility data)
  let referrals = [];
  if (currentProfile?.role === 'super_admin') {
    referrals = DB.facilities.flatMap(facObj => facObj.referrals || []);
  } else if (f) {
    referrals = f.referrals || [];
  }
  
  // 2. Filter referrals by date range
  const filtered = referrals.filter(r => {
    if (!r.date) return false;
    const d = new Date(r.date);
    return d >= start && d <= end;
  });

  // 3. Compile report type
  let reportHtml = '';
  const rangeStr = `From ${start.toLocaleDateString()} to ${end.toLocaleDateString()}`;
  
  if (reportType === 'facility') {
    reportHtml = compileFacilityReport(filtered, rangeStr);
  } else if (reportType === 'county') {
    reportHtml = compileCountyReport(filtered, rangeStr);
  } else if (reportType === 'outcome') {
    reportHtml = compileOutcomeReport(filtered, rangeStr);
  } else if (reportType === 'completion') {
    reportHtml = compileCompletionReport(filtered, rangeStr);
  } else if (reportType === 'trends') {
    reportHtml = compileTrendsReport(filtered, rangeStr);
  }

  document.getElementById('report-content').innerHTML = reportHtml;
}

function compileFacilityReport(refs, rangeStr) {
  const facGroup = {};
  
  refs.forEach(r => {
    const fName = r.referral_facility || 'Unknown Facility';
    if (!facGroup[fName]) {
      facGroup[fName] = { total: 0, completed: 0, pending: 0, emergency: 0 };
    }
    const g = facGroup[fName];
    g.total++;
    const status = r.workflow_status || r.status || 'Submitted';
    if (status === 'Completed') {
      g.completed++;
    } else if (['Submitted', 'Under Review', 'Received', 'In Consultation', 'Admitted'].includes(status)) {
      g.pending++;
    }
    if (r.priority === 'Emergency') {
      g.emergency++;
    }
  });

  const rows = Object.entries(facGroup).map(([name, g]) => `
    <tr>
      <td><strong>${h(name)}</strong></td>
      <td style="text-align:center">${g.total}</td>
      <td style="text-align:center">${g.completed}</td>
      <td style="text-align:center">${g.pending}</td>
      <td style="text-align:center">${g.emergency}</td>
    </tr>
  `).join('');

  return `
    <div class="card">
      <div class="ch"><span class="ct"><i class="ti ti-building-hospital"></i> Referrals by Facility Summary - ${rangeStr}</span></div>
      <div style="overflow-x:auto">
        <table class="perf-tbl">
          <thead>
            <tr><th>Facility Name</th><th>Total Referrals</th><th>Completed</th><th>Pending</th><th>Emergency</th></tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="5" style="text-align:center;color:#888;">No data in this period.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function compileCountyReport(refs, rangeStr) {
  const countyGroup = {};
  refs.forEach(r => {
    const county = r.county || 'Not Specified';
    if (!countyGroup[county]) {
      countyGroup[county] = { total: 0, completed: 0, pending: 0 };
    }
    const g = countyGroup[county];
    g.total++;
    const status = r.workflow_status || r.status || 'Submitted';
    if (status === 'Completed') {
      g.completed++;
    } else if (['Submitted', 'Under Review', 'Received', 'In Consultation', 'Admitted'].includes(status)) {
      g.pending++;
    }
  });

  const rows = Object.entries(countyGroup).map(([name, g]) => `
    <tr>
      <td><strong>${h(name)}</strong></td>
      <td style="text-align:center">${g.total}</td>
      <td style="text-align:center">${g.completed}</td>
      <td style="text-align:center">${g.pending}</td>
    </tr>
  `).join('');

  return `
    <div class="card">
      <div class="ch"><span class="ct"><i class="ti ti-map-pin"></i> Referrals by Patient County - ${rangeStr}</span></div>
      <div style="overflow-x:auto">
        <table class="perf-tbl">
          <thead>
            <tr><th>County</th><th>Total Referrals</th><th>Completed</th><th>Pending</th></tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="4" style="text-align:center;color:#888;">No data in this period.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function compileOutcomeReport(refs, rangeStr) {
  const outcomeGroup = {};
  refs.forEach(r => {
    const status = r.workflow_status || r.status || 'Submitted';
    outcomeGroup[status] = (outcomeGroup[status] || 0) + 1;
  });

  const total = refs.length;
  const rows = Object.entries(outcomeGroup).map(([status, count]) => {
    const pct = total ? Math.round((count / total) * 100) : 0;
    return `
      <tr>
        <td><strong>${h(status)}</strong></td>
        <td style="text-align:center">${count}</td>
        <td style="text-align:center">${pct}%</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="card">
      <div class="ch"><span class="ct"><i class="ti ti-chart-pie"></i> Referral Outcomes / Status Breakdown - ${rangeStr}</span></div>
      <div style="overflow-x:auto">
        <table class="perf-tbl">
          <thead>
            <tr><th>Workflow Status Outcome</th><th>Count</th><th>Percentage</th></tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="3" style="text-align:center;color:#888;">No data in this period.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function compileCompletionReport(refs, rangeStr) {
  const facGroup = {};
  refs.forEach(r => {
    const fName = r.referral_facility || 'Unknown Facility';
    if (!facGroup[fName]) {
      facGroup[fName] = { total: 0, completed: 0 };
    }
    const g = facGroup[fName];
    g.total++;
    const status = r.workflow_status || r.status || 'Submitted';
    if (status === 'Completed') g.completed++;
  });

  const rows = Object.entries(facGroup).map(([name, g]) => {
    const pct = g.total ? Math.round((g.completed / g.total) * 100) : 0;
    return `
      <tr>
        <td><strong>${h(name)}</strong></td>
        <td style="text-align:center">${g.total}</td>
        <td style="text-align:center">${g.completed}</td>
        <td style="text-align:center; font-weight:700; color:var(--T,#00A896);">${pct}%</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="card">
      <div class="ch"><span class="ct"><i class="ti ti-trending-up"></i> Case Completion Rates by Facility - ${rangeStr}</span></div>
      <div style="overflow-x:auto">
        <table class="perf-tbl">
          <thead>
            <tr><th>Facility Name</th><th>Total Referrals</th><th>Completed Cases</th><th>Completion Rate</th></tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="4" style="text-align:center;color:#888;">No data in this period.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function compileTrendsReport(refs, rangeStr) {
  const dateGroup = {};
  refs.forEach(r => {
    if (r.date) {
      dateGroup[r.date] = (dateGroup[r.date] || 0) + 1;
    }
  });

  const sortedDates = Object.keys(dateGroup).sort((a, b) => new Date(b) - new Date(a));
  const rows = sortedDates.map(date => `
    <tr>
      <td><strong>${date}</strong></td>
      <td style="text-align:center">${dateGroup[date]}</td>
    </tr>
  `).join('');

  return `
    <div class="card">
      <div class="ch"><span class="ct"><i class="ti ti-chart-line"></i> Daily Referral Trends - ${rangeStr}</span></div>
      <div style="overflow-x:auto">
        <table class="perf-tbl">
          <thead>
            <tr><th>Date</th><th>Referrals Count</th></tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="2" style="text-align:center;color:#888;">No data in this period.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

export function exportReport(format) {
  if (format === 'pdf') {
    window.print();
    return;
  }
  
  const reportType = document.getElementById('r-type')?.value || 'facility';
  const table = document.querySelector('#report-content table');
  if (!table) {
    alert('No report data to export.');
    return;
  }
  
  let content = '';
  const rows = Array.from(table.querySelectorAll('tr'));
  
  if (format === 'csv') {
    content = rows.map(r => 
      Array.from(r.querySelectorAll('th, td'))
        .map(cell => `"${cell.textContent.replace(/"/g, '""').trim()}"`)
        .join(',')
    ).join('\n');
    
    downloadFile(content, `OHGL_${reportType}_report.csv`, 'text/csv');
  } else if (format === 'excel') {
    // Generate tab-separated values which Excel opens directly
    content = rows.map(r => 
      Array.from(r.querySelectorAll('th, td'))
        .map(cell => cell.textContent.trim())
        .join('\t')
    ).join('\n');
    
    downloadFile(content, `OHGL_${reportType}_report.xls`, 'application/vnd.ms-excel');
  }
}

function downloadFile(content, filename, contentType) {
  const blob = new Blob([content], { type: contentType + ';charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
