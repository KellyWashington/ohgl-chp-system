import { sb, requireSupabase } from './supabaseClient.js';
import { fetchUserProfile, writeAuditLog } from './dataService.js';
import { sanitizeText } from '../utils/sanitize.js';
import { hasPerm, getAllowedPages, getDefaultPage, getRoleLabel } from './rbac.js';
import { currentUser, currentProfile, setCurrentUser, setCurrentProfile, DB, setDB } from './state.js';

// We import UI orchestrators from main.js (circular imports are resolved post-load in ESM)
import { showAuth, refreshDB, authAlert, showPage } from '../main.js';

export { hasPerm } from "./rbac.js";

function setNavVisibility(pageId, visible) {
  const el = document.getElementById(`nav-${pageId}`);
  if (el) el.style.display = visible ? "block" : "none";
}

export function applyPermissionsUI() {
  if (!currentProfile) return;
  const allowed = new Set(getAllowedPages(currentProfile));
  ['dashboard', 'new_referral', 'tracker', 'directory', 'report', 'group', 'settings', 'audit'].forEach(pageId => {
    setNavVisibility(pageId, allowed.has(pageId));
  });
  setNavVisibility('dashboard', true);
  const addFacilityBtn = document.getElementById('add-fac-btn');
  if (addFacilityBtn) addFacilityBtn.style.display = hasPerm('facility:manage') ? "block" : "none";
  const activePage = document.querySelector('.page.active')?.id?.replace('page-', "");
  if (activePage && !allowed.has(activePage)) {
    const fallback = getDefaultPage(currentProfile);
    if (fallback) {
      const fallbackNav = document.getElementById(`nav-${fallback}`);
      showPage(fallback, fallbackNav || document.querySelector('.nt'));
    }
  }
}

export async function audit(action, tableName, recordId, changes = {}) {
  if (!sb || !currentUser) return;
  await writeAuditLog({
    actorId: currentUser.id,
    action,
    tableName,
    recordId,
    facilityId: DB.activeFacId,
    changes,
  });
}

export async function bootstrapSession(session) {
  setCurrentUser(session.user);
  const { data: profile, error: profileErr } = await fetchUserProfile(session.user.id);
  if (profileErr) throw profileErr;
  if (!profile || !profile.active) {
    await sb.auth.signOut();
    setCurrentUser(null);
    setCurrentProfile(null);
    showAuth(false);
    throw new Error('Your account is inactive or missing a profile.');
  }
  setCurrentProfile(profile);
  document.getElementById('current-user').textContent = `${profile.full_name || session.user.email} - ${getRoleLabel(profile.role)}`;
  applyPermissionsUI();
  showAuth(true);
  const defaultPage = getDefaultPage(profile);
  if (!defaultPage) {
    await sb.auth.signOut();
    setCurrentUser(null);
    setCurrentProfile(null);
    showAuth(false);
    throw new Error('Your role does not have access to any application modules.');
  }
  await refreshDB();
}

export async function login(e) {
  e.preventDefault();
  const btn = document.getElementById('auth-submit-btn');
  const btnText = document.getElementById('auth-btn-text');
  const spinner = document.getElementById('auth-btn-spinner');
  
  if (btn && btnText && spinner) {
    btn.disabled = true;
    btnText.style.display = "none";
    spinner.style.display = "inline-block";
  }

  try {
    await requireSupabase();
    const email = sanitizeText(document.getElementById('auth-email').value, 160);
    const password = document.getElementById('auth-password').value;
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await bootstrapSession(data.session);
    await audit('login', 'auth.users', data.session.user.id, { email });
  } catch (err) {
    authAlert(err.message || 'Login failed');
    if (btn && btnText && spinner) {
      btn.disabled = false;
      btnText.style.display = "inline-flex";
      spinner.style.display = "none";
    }
  }
}

export async function resetPassword() {
  const email = sanitizeText(document.getElementById('auth-email').value, 160);
  if (!email) {
    authAlert('Enter your email first.');
    return;
  }
  
  const resetBtn = document.getElementById('auth-reset-btn');
  const originalHtml = resetBtn ? resetBtn.innerHTML : "";
  if (resetBtn) {
    resetBtn.disabled = true;
    resetBtn.innerHTML = '<span class="spinner"></span> Sending...';
  }

  try {
    await requireSupabase();
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname,
    });
    if (error) throw error;
    authAlert('Password reset email sent.', 'alert-s');
  } catch (err) {
    authAlert(err.message || 'Password reset failed');
  } finally {
    if (resetBtn) {
      resetBtn.disabled = false;
      resetBtn.innerHTML = originalHtml;
    }
  }
}

export async function logout() {
  if (sb && currentUser) await audit('logout', 'auth.users', currentUser.id, {});
  await sb?.auth.signOut();
  setCurrentUser(null);
  setCurrentProfile(null);
  setDB({ facilities: [], activeFacId: null });
  showAuth(false);
}
