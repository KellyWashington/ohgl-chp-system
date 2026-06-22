import { MONTHS } from '../constants/appConstants.js';
import { fac } from '../services/state.js';

export function filterRefs(refs, m, y) {
  return (refs || []).filter(r => {
    if (!r.date) return false;
    const d = new Date(r.date);
    return (
      (!m || d.getMonth() + 1 === parseInt(m)) &&
      (!y || d.getFullYear() === parseInt(y))
    );
  });
}

export function refInCategory(ref, cat) {
  const vals = String(ref.category || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
  return vals.some(v => cat.match.includes(v));
}

export function docCode(suffix) {
  const f = fac();
  return 'ODSL-SIAYA-CHP-' + suffix + '-' + ((f && f.year) || 2026);
}

export function printHeader(title, subtitle, code) {
  const f = fac();
  if (!f) return '';
  return `<div class="print-head">
    <div class="print-brand"><div class="print-logo">+</div><div><div class="print-org">OASIS HEALTH</div><div class="print-sub">Together for Better</div><div class="print-sub">${f.name}</div></div></div>
    <div style="flex:1"><div class="print-title">${title}</div><div class="print-sub" style="text-align:center">${subtitle}</div></div>
    <div class="print-meta">${f.email || ''}<br>${f.phone || ''}<br>${code}</div>
  </div>`;
}

export function setPrintHeader(id, title, subtitle, code) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = printHeader(title, subtitle, code);
}
