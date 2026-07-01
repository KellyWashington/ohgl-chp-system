import { fac } from '../services/state.js';
import { ensurePageAccess } from '../services/rbac.js';

const PAGE_SIZE = 8;
const STEPS = ['Submitted', 'Under Review', 'Received', 'In Consultation', 'Admitted', 'Completed'];
let page = 1;

function fmtDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function timelineFor(ref) {
  const events = Array.isArray(ref.timeline) ? ref.timeline : [];
  const status = ref.workflow_status || ref.status || 'Submitted';
  if (!events.length) {
    events.push({ status: 'Submitted', at: ref.created || ref.date, by: ref.created_by_name || 'CHP' });
    if (status !== 'Submitted') events.push({ status, at: ref.updated_at || ref.created || ref.date, by: ref.updated_by_name || 'Facility Officer' });
  }
  return STEPS.map(step => {
    const hit = events.find(e => e.status === step);
    const active = hit || step === status;
    return `<div class="timeline-step ${active ? 'done' : ''}">
      <div class="timeline-dot"></div>
      <div><strong>${step}</strong><span>${hit ? fmtDate(hit.at) : '-'}</span><small>${hit?.by || ''}</small></div>
    </div>`;
  }).join('');
}

export function renderMyReferrals(nextPage = page) {
  if (!ensurePageAccess('my_referrals', 'my-referrals-content')) return;
  const f = fac();
  const target = document.getElementById('my-referrals-content');
  if (!f || !target) return;
  page = Math.max(1, nextPage);
  const q = (document.getElementById('my-search')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('my-status')?.value || '';
  const rows = [...(f.referrals || [])]
    .reverse()
    .filter(r => {
      const status = r.workflow_status || r.status || 'Submitted';
      const haystack = [r.id, r.patient, r.national_id, r.referral_facility, r.department, r.date, status].filter(Boolean).join(' ').toLowerCase();
      return (!q || haystack.includes(q)) && (!statusFilter || status === statusFilter);
    });

  if (!rows.length) {
    target.innerHTML = `<div class="empty"><i class="ti ti-notes"></i><p>No referrals found.</p></div>`;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  page = Math.min(page, totalPages);
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  target.innerHTML = `
    <div class="reg-wrap">
      <table class="reg-tbl my-ref-tbl">
        <thead><tr><th>Referral Number</th><th>Patient Name</th><th>National ID</th><th>Facility</th><th>Date Submitted</th><th>Status</th></tr></thead>
        <tbody>${visible.map(r => `<tr>
          <td style="font-family:monospace;font-weight:700;color:var(--P)">${r.id || '-'}</td>
          <td>${r.patient || '-'}</td>
          <td>${r.national_id || '-'}</td>
          <td>${r.referral_facility || '-'}</td>
          <td>${fmtDate(r.created || r.date)}</td>
          <td><span class="bdg bdg-t">${r.workflow_status || r.status || 'Submitted'}</span></td>
        </tr><tr><td colspan="6"><div class="ref-timeline">${timelineFor(r)}</div></td></tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="pager no-print">
      <button class="btn btn-s btn-sm" ${page === 1 ? 'disabled' : ''} onclick="renderMyReferrals(${page - 1})"><i class="ti ti-chevron-left"></i> Prev</button>
      <span>Page ${page} of ${totalPages}</span>
      <button class="btn btn-s btn-sm" ${page === totalPages ? 'disabled' : ''} onclick="renderMyReferrals(${page + 1})">Next <i class="ti ti-chevron-right"></i></button>
    </div>`;
}
