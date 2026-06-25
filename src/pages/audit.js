import { fetchAuditEvents } from '../services/dataService.js';
import { hasPerm } from '../services/authService.js';
import { ensurePageAccess } from '../services/rbac.js';
import { h } from '../utils/sanitize.js';

export async function renderAudit() {
  if (!ensurePageAccess('audit', 'audit-content')) return;
  const el = document.getElementById('audit-content');
  if (!hasPerm('audit:read')) {
    el.innerHTML = '<div class="alert alert-e"><i class="ti ti-lock"></i> Audit logs are restricted to administrators.</div>';
    return;
  }
  const { data, error } = await fetchAuditEvents(100);
  if (error) {
    el.innerHTML = `<div class="alert alert-e">${h(error.message)}</div>`;
    return;
  }
  const rows = (data || [])
    .map(
      r =>
        `<tr><td>${new Date(r.created_at).toLocaleString()}</td><td>${h(r.action)}</td><td>${h(
          r.table_name
        )}</td><td>${h(r.record_id || '')}</td><td>${h(r.actor_id || '')}</td><td><code>${h(
          JSON.stringify(r.changes || {})
        )}</code></td></tr>`
    )
    .join('');
  el.innerHTML = `<table class="reg-tbl"><thead><tr><th>Time</th><th>Action</th><th>Table</th><th>Record</th><th>Actor</th><th>Changes</th></tr></thead><tbody>${
    rows || '<tr><td colspan="6">No audit events found.</td></tr>'
  }</tbody></table>`;
}
