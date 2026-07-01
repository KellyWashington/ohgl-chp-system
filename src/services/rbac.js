import { ROLE_PERMS, ROLE_LABELS } from '../constants/appConstants.js';
import { currentProfile } from './state.js';
import { h } from '../utils/sanitize.js';

export const ROLE_ALIASES = { clinician: 'facility_officer', viewer: 'chp' };

export const PAGE_ACCESS = {
  dashboard: ['super_admin', 'facility_admin', 'facility_officer', 'chp'],
  new_referral: ['super_admin', 'facility_admin', 'facility_officer', 'chp'],
  my_referrals: ['super_admin', 'facility_admin', 'facility_officer', 'chp'],
  tracker: ['super_admin', 'facility_admin', 'facility_officer'],
  directory: ['super_admin', 'facility_admin'],
  report: ['super_admin', 'facility_admin', 'facility_officer'],
  group: ['super_admin'],
  settings: ['super_admin', 'facility_admin'],
  audit: ['super_admin'],
};

export const NAV_ITEMS = Object.keys(PAGE_ACCESS);

export function normalizeRole(role) {
  return ROLE_ALIASES[role] || role || "";
}

export function getRoleLabel(role) {
  return ROLE_LABELS[normalizeRole(role)] || normalizeRole(role) || "Unknown";
}

export function hasPerm(perm, profile = currentProfile) {
  const perms = ROLE_PERMS[normalizeRole(profile?.role)] || [];
  return perms.includes('*') || perms.includes(perm) || perms.some(p => p.endsWith(':*') && perm.startsWith(p.slice(0, -1)));
}

export function canAccessPage(pageId, profile = currentProfile) {
  const role = normalizeRole(profile?.role);
  if (!role) return false;
  const allowedRoles = PAGE_ACCESS[pageId] || [];
  return allowedRoles.includes(role) || hasPerm("*", profile);
}

export function getAllowedPages(profile = currentProfile) {
  return NAV_ITEMS.filter(pageId => canAccessPage(pageId, profile));
}

export function getDefaultPage(profile = currentProfile) {
  const priority = ['new_referral', 'my_referrals', 'tracker', 'dashboard', 'directory', 'report', 'group', 'settings', 'audit'];
  return priority.find(pageId => canAccessPage(pageId, profile)) || null;
}

export function renderAccessDenied(targetId, message = 'You do not have access to this page.') {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.innerHTML = '<div class="alert alert-e"><i class="ti ti-lock"></i> ' + h(message) + '</div>';
}

export function ensurePageAccess(pageId, targetId, message) {
  if (canAccessPage(pageId)) return true;
  renderAccessDenied(targetId, message);
  return false;
}
