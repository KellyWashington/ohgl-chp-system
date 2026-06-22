import { sb, requireSupabase } from './supabaseClient.js';
import { fetchUserProfile, writeAuditLog } from './dataService.js';
import { sanitizeText, setSafeHTML, h } from '../utils/sanitize.js';
import { ROLE_PERMS } from '../constants/appConstants.js';
import {
  currentUser,
  currentProfile,
  setCurrentUser,
  setCurrentProfile,
  DB,
  setDB,
} from './state.js';

// We import UI orchestrators from main.js (circular imports are resolved post-load in ESM)
import { showAuth, refreshDB, authAlert } from '../main.js';

export function hasPerm(perm) {
  const perms = ROLE_PERMS[currentProfile?.role] || [];
  return (
    perms.includes('*') ||
    perms.includes(perm) ||
    perms.some(p => p.endsWith(':*') && perm.startsWith(p.slice(0, -1)))
  );
}

export function applyPermissionsUI() {
  if (!currentProfile) return;
  const role = currentProfile.role;
  document.getElementById('nav-dashboard').style.display = 'block';
  document.getElementById('nav-new_referral').style.display = hasPerm('referral:create') ? 'block' : 'none';
  document.getElementById('nav-tracker').style.display =
    hasPerm('referral:read') || hasPerm('referral:read_own') ? 'block' : 'none';
  document.getElementById('nav-directory').style.display =
    hasPerm('chp:*') || hasPerm('chp:read_own') ? 'block' : 'none';
  document.getElementById('nav-report').style.display =
    hasPerm('facility:manage') || hasPerm('audit:read') ? 'block' : 'none';
  document.getElementById('nav-group').style.display = role === 'super_admin' ? 'block' : 'none';
  document.getElementById('nav-settings').style.display = hasPerm('facility:manage') ? 'block' : 'none';
  document.getElementById('nav-audit').style.display = hasPerm('audit:read') ? 'block' : 'none';
  document.getElementById('add-fac-btn').style.display = role === 'super_admin' ? 'block' : 'none';
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
  setCurrentProfile(profile);
  document.getElementById('current-user').textContent = `${profile.full_name || session.user.email} - ${profile.role}`;
  applyPermissionsUI();
  showAuth(true);
  await refreshDB();
}

export async function login(e) {
  e.preventDefault();
  const btn = document.getElementById('auth-submit-btn');
  const btnText = document.getElementById('auth-btn-text');
  const spinner = document.getElementById('auth-btn-spinner');
  
  if (btn && btnText && spinner) {
    btn.disabled = true;
    btnText.style.display = 'none';
    spinner.style.display = 'inline-block';
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
      btnText.style.display = 'inline-flex';
      spinner.style.display = 'none';
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
  const originalHtml = resetBtn ? resetBtn.innerHTML : '';
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
