import { sb, requireSupabase } from './supabaseClient.js';
import { fetchUserProfile, writeAuditLog } from './dataService.js';
import { sanitizeText } from '../utils/sanitize.js';
import { hasPerm, getAllowedPages, getDefaultPage, getRoleLabel, renderAccessDenied } from './rbac.js';
import { currentUser, currentProfile, setCurrentUser, setCurrentProfile, DB, setDB } from './state.js';
import { checkRateLimit } from '../utils/rateLimiter.js';


// We import UI orchestrators from main.js (circular imports are resolved post-load in ESM)
import { showAuth, refreshDB, authAlert, showPage } from '../main.js';

export { hasPerm } from "./rbac.js";

function setNavVisibility(pageId, visible) {
  const el = document.getElementById(`nav-${pageId}`);
  if (el) el.style.display = visible ? "block" : "none";
}

function showLockedAccess(message) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nt').forEach(t => t.classList.remove('active'));
  const page = document.getElementById('page-dashboard');
  const nav = document.getElementById('nav-dashboard');
  if (page) page.classList.add('active');
  if (nav) nav.classList.add('active');
  renderAccessDenied('page-dashboard', message);
}

export function applyPermissionsUI() {
  if (!currentProfile) return;
  const allowed = new Set(getAllowedPages(currentProfile));
  ['dashboard', 'new_referral', 'my_referrals', 'tracker', 'directory', 'report', 'group', 'settings', 'audit'].forEach(pageId => {
    setNavVisibility(pageId, allowed.has(pageId));
  });
  setNavVisibility('dashboard', true);
  const addFacilityBtn = document.getElementById('add-fac-btn');
  if (addFacilityBtn) addFacilityBtn.style.display = hasPerm('facility:manage') ? "block" : "none";
  
  const isSuper = currentProfile?.role === 'super_admin';
  const facSel = document.getElementById('fac-sel');
  const facLbl = document.querySelector('.fac-bar-lbl');
  if (facSel) facSel.style.display = isSuper ? "inline-block" : "none";
  if (facLbl) facLbl.style.display = isSuper ? "inline-block" : "none";

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

  const displayProfile = profile || {
    id: session.user.id,
    full_name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email,
    email: session.user.email,
    role: null,
    active: false,
  };

  setCurrentProfile(displayProfile);
  showAuth(true);
  document.getElementById('current-user').textContent = `${displayProfile.full_name || session.user.email} - ${getRoleLabel(displayProfile.role)}`;
  applyPermissionsUI();

  if (!profile) {
    showLockedAccess('Your account is signed in but has not been provisioned with an application role yet. Contact a Super Admin to assign access.');
    return;
  }

  if (!profile.active) {
    showLockedAccess('Your account is disabled. Contact a Super Admin to restore access.');
    return;
  }

  const defaultPage = getDefaultPage(profile);
  if (!defaultPage) {
    showLockedAccess('Your role does not have access to any application modules.');
    return;
  }

  const defaultNav = document.getElementById(`nav-${defaultPage}`) || document.querySelector('.nt');
  showPage(defaultPage, defaultNav);

  try {
    await refreshDB();
  } catch (err) {
    console.error('Background data load failed after login', err);
    showLockedAccess('You are signed in, but the application data could not be loaded yet. Please refresh or contact support if this persists.');
  }
}

export async function login(e) {
  e.preventDefault();
  
  if (!checkRateLimit('login', 5, 60000)) {
    authAlert('Too many login attempts. Please wait 1 minute before trying again.');
    return;
  }

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
    try {
      await audit('login', 'auth.users', data.session.user.id, { email });
    } catch (auditErr) {
      console.warn('Login audit failed', auditErr);
    }
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
