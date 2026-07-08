import { fac, DB, currentProfile, currentUser } from '../services/state.js';
import { ensurePageAccess } from '../services/rbac.js';
import { h } from '../utils/sanitize.js';

const PAGE_SIZE = 50;
let reportState = { page: 1, lastRows: [], lastTitle: 'Report', lastPeriod: '-' };

const REPORTS = {
  register: 'Referral Register',
  chp: 'CHP Performance Report',
  facility: 'Facility Performance Report',
  department: 'Department Performance Report',
  executive: 'Executive Dashboard',
  timeline: 'Referral Timeline Report',
};

export function onReportFilterTypeChange() {
  const filterType = document.getElementById('r-filter-type')?.value;
  const monthCont = document.getElementById('r-month-select-container');
  const customCont = document.getElementById('r-custom-dates');
  if (monthCont && customCont) {
    monthCont.style.display = filterType === 'monthly' ? 'block' : 'none';
    customCont.style.display = filterType === 'custom' ? 'flex' : 'none';
  }
  reportState.page = 1;
  renderReport();
}

export function setReportPage(page) {
  reportState.page = Math.max(1, Number(page) || 1);
  renderReport();
}

function value(id) {
  return document.getElementById(id)?.value || '';
}

function getReportDateRange() {
  const filterType = value('r-filter-type') || 'monthly';
  const now = new Date();
  let start;
  let end;
  if (filterType === 'daily') {
    const today = now.toISOString().split('T')[0];
    start = new Date(today + 'T00:00:00');
    end = new Date(today + 'T23:59:59');
  } else if (filterType === 'weekly') {
    start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    start.setHours(0, 0, 0, 0);
    end = new Date(now.getTime());
  } else if (filterType === 'custom') {
    start = value('r-start-date') ? new Date(value('r-start-date') + 'T00:00:00') : new Date(0);
    end = value('r-end-date') ? new Date(value('r-end-date') + 'T23:59:59') : new Date();
  } else {
    const m = parseInt(value('r-month'), 10) || (now.getMonth() + 1);
    const y = parseInt(value('r-year'), 10) || now.getFullYear();
    start = new Date(y, m - 1, 1, 0, 0, 0);
    end = new Date(y, m, 0, 23, 59, 59);
  }
  return { start, end, label: `From ${start.toLocaleDateString()} to ${end.toLocaleDateString()}` };
}

function normalizeStatus(referral) {
  return referral.workflow_status || referral.referral_status || referral.opd_status || referral.status || 'Submitted';
}

function isEmergency(referral) {
  return String(referral.priority || '').toLowerCase() === 'emergency';
}

function isCompleted(referral) {
  return ['completed', 'closed', 'attended'].includes(String(normalizeStatus(referral)).toLowerCase());
}

function isCancelled(referral) {
  return ['cancelled', 'canceled', 'dna'].includes(String(normalizeStatus(referral)).toLowerCase());
}

function facilityNameFor(referral) {
  const byOriginFacility = DB.facilities.find(f => f.id === referral.facility_id);
  return byOriginFacility?.name || referral.referral_facility_name || referral.referral_facility || 'Unknown Facility';
}

function destinationNameFor(referral) {
  const byDestination = DB.facilities.find(f => f.id === referral.referral_facility_id);
  return byDestination?.name || referral.referral_facility_name || referral.referral_facility || facilityNameFor(referral);
}

function chpNameFor(referral) {
  const facility = DB.facilities.find(f => f.id === referral.facility_id);
  const chp = facility?.chps?.find(c => c.code === referral.chp_code || c.user_id === referral.created_by);
  return referral.created_by_name || chp?.name || referral.chp_code || '';
}

function getAllReferrals() {
  let rows = [];
  if (currentProfile?.role === 'super_admin') rows = DB.facilities.flatMap(f => f.referrals || []);
  else if (currentProfile?.role === 'chp') rows = DB.facilities.flatMap(f => f.referrals || []).filter(r => r.created_by === currentUser?.id || r.chp_code === currentProfile?.chp_code_requested);
  else rows = (fac()?.referrals || []);
  return rows;
}

function getFilters() {
  return {
    facility: value('r-facility'),
    department: value('r-department').toLowerCase(),
    chp: value('r-chp').toLowerCase(),
    status: value('r-status'),
    priority: value('r-priority'),
    sha: value('r-sha'),
    emergency: value('r-emergency'),
    search: value('r-search').toLowerCase().trim(),
  };
}

function filterReferrals(rows, range) {
  const filters = getFilters();
  return rows.filter(r => {
    const date = r.date ? new Date(r.date) : null;
    if (!date || date < range.start || date > range.end) return false;
    if (filters.facility && r.facility_id !== filters.facility) return false;
    if (filters.department && !String(r.department || '').toLowerCase().includes(filters.department)) return false;
    if (filters.chp && !`${chpNameFor(r)} ${r.chp_code || ''}`.toLowerCase().includes(filters.chp)) return false;
    if (filters.status && normalizeStatus(r) !== filters.status) return false;
    if (filters.priority && r.priority !== filters.priority) return false;
    if (filters.sha && (r.sha === 'Yes' || r.sha_registered === true ? 'yes' : 'no') !== filters.sha) return false;
    if (filters.emergency === 'yes' && !isEmergency(r)) return false;
    if (filters.emergency === 'no' && isEmergency(r)) return false;
    if (filters.search) {
      const haystack = [r.id, r.patient, r.national_id, r.phone, chpNameFor(r), r.chp_code, facilityNameFor(r), destinationNameFor(r), r.department, r.referral_reason, normalizeStatus(r)].join(' ').toLowerCase();
      if (!haystack.includes(filters.search)) return false;
    }
    return true;
  });
}

function averageDays(rows) {
  const durations = rows
    .filter(r => isCompleted(r) && r.date && (r.updated_at || r.created))
    .map(r => Math.max(0, (new Date(r.updated_at || r.created) - new Date(r.date)) / 86400000));
  if (!durations.length) return '-';
  return (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1) + ' days';
}

function reportShell(title, period, rows, body) {
  reportState.lastRows = rows;
  reportState.lastTitle = title;
  reportState.lastPeriod = period;
  const facilityLabel = currentProfile?.role === 'super_admin' ? 'All Facilities' : (fac()?.name || '-');
  return `
    <section class="report-doc" aria-label="${h(title)}">
      <div class="report-letterhead">
        <img src="./src/assets/logo.png" alt="OHGL Logo">
        <div><h2>Oasis Healthcare Group</h2><p>${h(title)}</p></div>
      </div>
      <div class="report-meta">
        <span><strong>Reporting period:</strong> ${h(period)}</span>
        <span><strong>Facility:</strong> ${h(facilityLabel)}</span>
        <span><strong>Generated by:</strong> ${h(currentProfile?.full_name || currentProfile?.email || 'Current user')}</span>
        <span><strong>Generated:</strong> ${h(new Date().toLocaleString())}</span>
      </div>
      ${summaryCards(rows)}
      ${body}
      <footer class="report-footer">Oasis Healthcare Group | Community Health Platform | Confidential operational report</footer>
    </section>`;
}

function summaryCards(rows) {
  const completed = rows.filter(isCompleted).length;
  const cancelled = rows.filter(isCancelled).length;
  const emergency = rows.filter(isEmergency).length;
  const sha = rows.filter(r => r.sha === 'Yes' || r.sha_registered === true).length;
  const pending = rows.length - completed - cancelled;
  return `<div class="report-kpis">
    ${kpi('Total Referrals', rows.length)}${kpi('Completed', completed)}${kpi('Pending', pending)}${kpi('Emergency', emergency)}${kpi('Cancelled', cancelled)}${kpi('SHA Registered', sha)}
  </div>`;
}

function kpi(label, value) {
  return `<div class="kpi"><div class="kv">${h(String(value))}</div><div class="kl">${h(label)}</div></div>`;
}

function table(headers, rows, className = '') {
  return `<div class="report-table-wrap"><table class="perf-tbl report-table ${className}"><thead><tr>${headers.map(x => `<th>${h(x)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}" class="empty-cell">No data for the selected filters.</td></tr>`}</tbody></table></div>`;
}

function paginate(rows) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  reportState.page = Math.min(reportState.page, pages);
  const start = (reportState.page - 1) * PAGE_SIZE;
  return { pageRows: rows.slice(start, start + PAGE_SIZE), pages };
}

function pagination(total, pages) {
  if (pages <= 1) return '';
  return `<div class="report-pagination no-print"><button class="btn btn-s btn-sm" onclick="setReportPage(${reportState.page - 1})" ${reportState.page <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${reportState.page} of ${pages} (${total} rows)</span><button class="btn btn-s btn-sm" onclick="setReportPage(${reportState.page + 1})" ${reportState.page >= pages ? 'disabled' : ''}>Next</button></div>`;
}

function compileRegister(rows, period) {
  const sorted = [...rows].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const { pageRows, pages } = paginate(sorted);
  const bodyRows = pageRows.map(r => `<tr><td>${h(r.id || '')}</td><td>${h(r.date || '')}</td><td>${h(r.patient || '')}</td><td>${h(r.national_id || '')}</td><td>${h(r.age || '')}</td><td>${h(r.sex || '')}</td><td>${h(r.phone || '')}</td><td>${h(chpNameFor(r))}</td><td>${h(r.chp_code || '')}</td><td>${h(facilityNameFor(r))}</td><td>${h(destinationNameFor(r))}</td><td>${h(r.department || '')}</td><td>${h(r.referral_reason || '')}</td><td>${h(r.priority || '')}</td><td>${h(r.sha || (r.sha_registered ? 'Yes' : 'No'))}</td><td>${h(normalizeStatus(r))}</td><td>${h(r.received_by || '')}</td><td>${h(r.file_no || '')}</td><td>${h(isCompleted(r) ? (r.updated_at || r.created || '') : '')}</td></tr>`);
  const headers = ['Referral No','Referral Date','Patient Name','National ID','Age','Sex','Phone','CHP Name','CHP Code','Origin Facility','Destination Facility','Department','Referral Reason','Priority','SHA Registered','Current Status','Received By','File Number','Date Completed'];
  return reportShell(REPORTS.register, period, rows, table(headers, bodyRows, 'wide-table') + pagination(sorted.length, pages));
}

function groupBy(rows, keyFn) {
  return rows.reduce((acc, row) => {
    const key = keyFn(row) || 'Not Specified';
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});
}

function metricRow(name, code, facility, rows, extra = []) {
  const completed = rows.filter(isCompleted).length;
  const cancelled = rows.filter(isCancelled).length;
  const emergency = rows.filter(isEmergency).length;
  const shaCount = rows.filter(r => r.sha === 'Yes' || r.sha_registered === true).length;
  const pending = rows.length - completed - cancelled;
  const last = rows.map(r => r.date).filter(Boolean).sort().pop() || '-';
  return `<tr><td>${h(name)}</td><td>${h(code || '')}</td><td>${h(facility || '')}</td><td>${rows.length}</td><td>${emergency}</td><td>${completed}</td><td>${pending}</td><td>${cancelled}</td><td>${h(averageDays(rows))}</td><td>${rows.length ? Math.round((shaCount / rows.length) * 100) : 0}%</td><td>${h(last)}</td>${extra.map(x => `<td>${h(String(x))}</td>`).join('')}</tr>`;
}

function simpleBars(title, entries) {
  const max = Math.max(1, ...entries.map(e => e.value));
  return `<div class="report-chart"><h3>${h(title)}</h3>${entries.length ? entries.map(e => `<div class="bar-row"><span>${h(e.label)}</span><div><i style="width:${Math.max(4, (e.value / max) * 100)}%"></i></div><b>${e.value}</b></div>`).join('') : '<p class="muted-mini">No chart data.</p>'}</div>`;
}

function compileChp(rows, period) {
  const grouped = groupBy(rows, r => `${chpNameFor(r)}|${r.chp_code || ''}|${facilityNameFor(r)}`);
  const bodyRows = Object.entries(grouped).map(([key, items]) => metricRow(...key.split('|'), items));
  const top = Object.entries(grouped).map(([key, items]) => ({ label: key.split('|')[0] || key.split('|')[1], value: items.length })).sort((a, b) => b.value - a.value).slice(0, 10);
  const monthly = Object.entries(groupBy(rows, r => (r.date || '').slice(0, 7))).map(([label, items]) => ({ label, value: items.length })).sort((a, b) => a.label.localeCompare(b.label));
  return reportShell(REPORTS.chp, period, rows, `<div class="report-charts">${simpleBars('Top 10 CHPs', top)}${simpleBars('Monthly Referrals', monthly)}</div>` + table(['Name','CHP Code','Facility','Total Referrals','Emergency Referrals','Completed','Pending','Cancelled','Average Completion Time','SHA Registration %','Last Referral Date'], bodyRows));
}

function compileFacility(rows, period) {
  const grouped = groupBy(rows, facilityNameFor);
  const bodyRows = Object.entries(grouped).map(([name, items]) => metricRow(name, '', name, items, [topLabel(items, r => r.department), topLabel(items, chpNameFor)]));
  const trend = Object.entries(groupBy(rows, r => (r.date || '').slice(0, 7))).map(([label, items]) => ({ label, value: items.length })).sort((a, b) => a.label.localeCompare(b.label));
  return reportShell(REPORTS.facility, period, rows, simpleBars('Referral Trend', trend) + table(['Facility','Code','Facility','Total Referrals','Emergency','Completed','Pending','Cancelled','Average Turnaround Time','SHA %','Last Referral Date','Top Department','Top CHP'], bodyRows));
}

function topLabel(rows, keyFn) {
  const entries = Object.entries(groupBy(rows, keyFn)).sort((a, b) => b[1].length - a[1].length);
  return entries[0]?.[0] || '-';
}

function compileDepartment(rows, period) {
  const grouped = groupBy(rows, r => r.department);
  const bodyRows = Object.entries(grouped).map(([department, items]) => {
    const count = s => items.filter(r => normalizeStatus(r) === s).length;
    return `<tr><td>${h(department)}</td><td>${items.length}</td><td>${count('Received')}</td><td>${count('In Consultation')}</td><td>${count('Admitted')}</td><td>${items.filter(isCompleted).length}</td><td>${items.filter(isCancelled).length}</td><td>${h(averageDays(items))}</td></tr>`;
  });
  return reportShell(REPORTS.department, period, rows, table(['Department','Total Referrals','Received','Consultation','Admitted','Completed','Cancelled','Average Processing Time'], bodyRows));
}

function compileExecutive(rows, period) {
  const facilityCompare = Object.entries(groupBy(rows, facilityNameFor)).map(([label, items]) => ({ label, value: items.length })).sort((a, b) => b.value - a.value);
  const departments = Object.entries(groupBy(rows, r => r.department)).map(([label, items]) => ({ label, value: items.length })).sort((a, b) => b.value - a.value).slice(0, 10);
  const status = Object.entries(groupBy(rows, normalizeStatus)).map(([label, items]) => ({ label, value: items.length })).sort((a, b) => b.value - a.value);
  const topChps = Object.entries(groupBy(rows, chpNameFor)).map(([label, items]) => ({ label, value: items.length })).sort((a, b) => b.value - a.value).slice(0, 10);
  const monthly = Object.entries(groupBy(rows, r => (r.date || '').slice(0, 7))).map(([label, items]) => ({ label, value: items.length })).sort((a, b) => a.label.localeCompare(b.label));
  return reportShell(REPORTS.executive, period, rows, `<div class="report-charts">${simpleBars('Monthly Trend', monthly)}${simpleBars('Facility Comparison', facilityCompare)}${simpleBars('Department Comparison', departments)}${simpleBars('Referral Status Distribution', status)}${simpleBars('Top CHPs', topChps)}</div>`);
}

function compileTimeline(rows, period) {
  const selected = getFilters().search;
  const list = selected ? rows.filter(r => `${r.id} ${r.patient}`.toLowerCase().includes(selected)) : rows;
  const body = list.slice(0, 20).map(r => {
    const events = Array.isArray(r.timeline) ? r.timeline : [];
    return `<article class="timeline-page"><h3>${h(r.id || '')} - ${h(r.patient || 'Patient')}</h3><p>${h(facilityNameFor(r))} | ${h(normalizeStatus(r))}</p><ol>${events.length ? events.map(e => `<li><strong>${h(e.status || e.event_name || 'Update')}</strong><span>${h(e.at || e.created_at || '')}</span><em>${h(e.by || e.actor || '')}</em><p>${h(e.notes || e.reason || '')}</p></li>`).join('') : `<li><strong>Submitted</strong><span>${h(r.date || '')}</span><em>${h(chpNameFor(r))}</em><p>${h(r.referral_reason || '')}</p></li>`}</ol></article>`;
  }).join('');
  return reportShell(REPORTS.timeline, period, rows, body || '<div class="empty">No referral timeline data for the selected filters.</div>');
}

export function renderReport() {
  if (!ensurePageAccess('report', 'report-content')) return;
  const reportType = value('r-type') || 'register';
  if (reportType === 'executive' && currentProfile?.role !== 'super_admin') {
    document.getElementById('report-content').innerHTML = '<div class="alert alert-i"><i class="ti ti-info-circle"></i> Executive Dashboard is available to Super Admin only.</div>';
    return;
  }
  const range = getReportDateRange();
  const rows = filterReferrals(getAllReferrals(), range);
  const compilers = { register: compileRegister, chp: compileChp, facility: compileFacility, department: compileDepartment, executive: compileExecutive, timeline: compileTimeline };
  document.getElementById('report-content').innerHTML = (compilers[reportType] || compileRegister)(rows, range.label);
}

function exportRows() {
  const reportType = value('r-type') || 'register';
  const range = getReportDateRange();
  const rows = filterReferrals(getAllReferrals(), range);
  if (reportType === 'register') return {
    headers: ['Referral No','Referral Date','Patient Name','National ID','Age','Sex','Phone','CHP Name','CHP Code','Origin Facility','Destination Facility','Department','Referral Reason','Priority','SHA Registered','Current Status','Received By','File Number','Date Completed'],
    rows: rows.map(r => [r.id, r.date, r.patient, r.national_id, r.age, r.sex, r.phone, chpNameFor(r), r.chp_code, facilityNameFor(r), destinationNameFor(r), r.department, r.referral_reason, r.priority, r.sha || (r.sha_registered ? 'Yes' : 'No'), normalizeStatus(r), r.received_by, r.file_no, isCompleted(r) ? (r.updated_at || r.created || '') : ''])
  };
  return { headers: ['Report', 'Facility', 'Period', 'Total Referrals'], rows: [[REPORTS[reportType], currentProfile?.role === 'super_admin' ? 'All Facilities' : fac()?.name, range.label, rows.length]] };
}

export function exportReport(format) {
  try {
    if (format === 'pdf') {
      window.print();
      return;
    }
    const reportType = value('r-type') || 'register';
    const range = getReportDateRange();
    const data = exportRows();
    const meta = [
      ['Oasis Healthcare Group'],
      [REPORTS[reportType] || 'Report'],
      ['Reporting Period', range.label],
      ['Facility', currentProfile?.role === 'super_admin' ? 'All Facilities' : fac()?.name || '-'],
      ['Generated By', currentProfile?.full_name || currentProfile?.email || 'Current user'],
      ['Generated Date/Time', new Date().toLocaleString()],
      []
    ];
    if (format === 'csv') {
      const csvRows = [...meta, data.headers, ...data.rows];
      downloadFile('\uFEFF' + csvRows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'), `OHGL_${reportType}_report.csv`, 'text/csv');
    } else if (format === 'excel') {
      const html = `<html><head><meta charset="UTF-8"><style>th{font-weight:bold;background:#e6f4f1}td,th{mso-number-format:'\\@';border:1px solid #ccc;padding:6px}.meta td{border:none;font-weight:bold}</style></head><body><table class="meta">${meta.map(r => `<tr>${r.map(c => `<td>${h(String(c || ''))}</td>`).join('')}</tr>`).join('')}</table><table><thead><tr>${data.headers.map(x => `<th>${h(x)}</th>`).join('')}</tr></thead><tbody>${data.rows.map(r => `<tr>${r.map(c => `<td>${h(String(c ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table><footer>Oasis Healthcare Group | Community Health Platform</footer></body></html>`;
      downloadFile(html, `OHGL_${reportType}_report.xls`, 'application/vnd.ms-excel');
    }
  } catch (err) {
    const target = document.getElementById('report-export-status');
    if (target) target.innerHTML = `<div class="alert alert-e">Export failed. Please retry.</div>`;
    console.error('Report export failed', err);
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

Object.assign(window, { setReportPage });