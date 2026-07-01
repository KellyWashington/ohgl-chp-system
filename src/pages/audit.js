import { fetchAuditEvents } from '../services/dataService.js';
import { hasPerm } from '../services/authService.js';
import { ensurePageAccess } from '../services/rbac.js';
import { h } from '../utils/sanitize.js';

function getActionLabel(action, tableName) {
  const a = String(action).toLowerCase();
  const t = String(tableName).toLowerCase();
  if (a === 'login') return 'Login';
  if (a === 'logout') return 'Logout';
  if (t === 'referrals') {
    if (a === 'insert' || a === 'create') return 'Referral Creation';
    if (a === 'update') return 'Referral Updates';
    if (a === 'delete') return 'Referral Deletion';
  }
  if (t === 'users') {
    if (a === 'insert' || a === 'create' || a === 'upsert') return 'User Creation';
    if (a === 'update') return 'User Updates';
    if (a === 'delete') return 'User Deletion';
  }
  if (t === 'facilities') {
    if (a === 'insert' || a === 'create') return 'Facility Creation';
    if (a === 'update') return 'Facility Updates';
    if (a === 'delete') return 'Facility Deletion';
  }
  return action.charAt(0).toUpperCase() + action.slice(1);
}

export async function renderAudit() {
  if (!ensurePageAccess('audit', 'audit-content')) return;
  const el = document.getElementById('audit-content');
  if (!hasPerm('*')) { // Only Super Admin has wildcard permission
    el.innerHTML = '<div class="alert alert-e"><i class="ti ti-lock"></i> Audit logs are restricted to Super Administrators.</div>';
    return;
  }
  const { data, error } = await fetchAuditEvents(100);
  if (error) {
    el.innerHTML = `<div class="alert alert-e">${h(error.message)}</div>`;
    return;
  }
  const rows = (data || [])
    .map(
      r => {
        const actorName = r.users ? (r.users.full_name || r.users.email) : (r.actor_id || 'System');
        const actionLabel = getActionLabel(r.action, r.table_name);
        const resourceLabel = `${h(r.table_name)}: ${h(r.record_id || '')}`;
        return `<tr>
          <td>${new Date(r.created_at).toLocaleString()}</td>
          <td>${h(actorName)}</td>
          <td><span class="bdg bdg-t" style="font-size:10px">${h(actionLabel)}</span></td>
          <td>${resourceLabel}</td>
          <td><code>${h(r.ip_address || 'N/A')}</code></td>
          <td><code>${h(JSON.stringify(r.changes || {}))}</code></td>
        </tr>`;
      }
    )
    .join('');
  el.innerHTML = `<table class="reg-tbl">
    <thead>
      <tr>
        <th>Timestamp</th>
        <th>User</th>
        <th>Action</th>
        <th>Resource</th>
        <th>IP Address</th>
        <th>Changes</th>
      </tr>
    </thead>
    <tbody>${
      rows || '<tr><td colspan="6">No audit events found.</td></tr>'
    }</tbody>
  </table>`;
}

