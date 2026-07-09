import { sb, requireSupabase } from './supabaseClient.js';
import { fetchUserProfile, writeAuditLog } from './dataService.js';
import { checkRegistrationRateLimit, logRegistrationAttempt } from './registrationRateLimitService.js';
import { h, sanitizeText } from '../utils/sanitize.js';
import { hasPerm, getAllowedPages, getDefaultPage, getRoleLabel, renderAccessDenied } from './rbac.js';
import { currentUser, currentProfile, setCurrentUser, setCurrentProfile, DB, setDB } from './state.js';
import { checkRateLimit } from '../utils/rateLimiter.js';

// We import UI orchestrators from main.js (circular imports are resolved post-load in ESM)
import { showAuth, refreshDB, authAlert, showPage } from '../main.js';

export { hasPerm } from "./rbac.js";

let authMode = 'login';
let dashboardPageHTML = null;

function authErrorMessage(err, fallback) {
  const message = err?.message || fallback;
  if (/invalid login credentials/i.test(message)) {
    return 'Email or password is incorrect, or the account has not been confirmed yet.';
  }
  if (/email.*not.*confirm|confirm.*email/i.test(message)) {
    return 'Please confirm your email address before signing in.';
  }
  if (/user already registered|already.*registered/i.test(message)) {
    return 'An account with this email already exists. Sign in or reset your password.';
  }
  if (/password/i.test(message) && /six|6|weak|short/i.test(message)) {
    return 'Use a stronger password with at least 6 characters.';
  }
  if (/rate.*limit|too.*many/i.test(message)) {
    return 'Too many registration attempts. Please try again in 1 hour.';
  }
  return message || fallback;
}

function setSubmitLoading(loading) {
  const btn = document.getElementById('auth-submit-btn');
  const btnText = document.getElementById('auth-btn-text');
  const spinner = document.getElementById('auth-btn-spinner');
  if (btn) btn.disabled = loading;
  if (btnText) btnText.style.display = loading ? 'none' : 'inline-flex';
  if (spinner) spinner.style.display = loading ? 'inline-block' : 'none';
}

export function setAuthMode(mode) {
  authMode = mode === 'register' ? 'register' : 'login';
  document.querySelectorAll('.auth-register-field').forEach(el => {
    el.style.display = authMode === 'register' ? 'block' : 'none';
  });
  const submitText = document.getElementById('auth-btn-text');
  const resetBtn = document.getElementById('auth-reset-btn');
  const password = document.getElementById('auth-password');
  const fullName = document.getElementById('auth-full-name');
  const phone = document.getElementById('auth-phone');
  const loginBtn = document.getElementById('auth-mode-login');
  const registerBtn = document.getElementById('auth-mode-register');
  if (submitText) submitText.innerHTML = authMode === 'register' ? '<i class="ti ti-user-plus" aria-hidden="true"></i> Register' : '<i class="ti ti-login" aria-hidden="true"></i> Sign in';
  if (resetBtn) resetBtn.style.display = authMode === 'register' ? 'none' : 'inline-flex';
  if (password) password.autocomplete = authMode === 'register' ? 'new-password' : 'current-password';
  if (fullName) fullName.required = authMode === 'register';
  if (phone) phone.required = authMode === 'register';
  if (loginBtn) loginBtn.classList.toggle('btn-p', authMode === 'login');
  if (registerBtn) registerBtn.classList.toggle('btn-p', authMode === 'register');
  const alertEl = document.getElementById('auth-alert');
  if (alertEl) alertEl.innerHTML = '';
}

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

function showLifecycleAccess(status, profile) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nt').forEach(t => t.classList.remove('active'));
  ['dashboard', 'new_referral', 'my_referrals', 'tracker', 'directory', 'report', 'group', 'settings', 'audit'].forEach(pageId => {
    setNavVisibility(pageId, false);
  });
  const page = document.getElementById('page-dashboard');
  if (!page) return;
  if (dashboardPageHTML === null) dashboardPageHTML = page.innerHTML;
  page.classList.add('active');
  const details = {
    pending: ['Awaiting Approval', 'Your registration has been submitted and is awaiting Super Admin review.'],
    rejected: ['Registration Rejected', 'Your registration was not approved. Contact the administrator if you believe this needs review.'],
    suspended: ['Account Suspended', 'Your account is temporarily suspended. Contact the administrator for assistance.'],
    deactivated: ['Account Deactivated', 'Your account has been deactivated. Contact the administrator for assistance.'],
  };
  const [title, body] = details[status] || ['Access Restricted', 'Your account is not currently approved for application access.'];
  page.innerHTML = `<div class="card" style="max-width:720px;margin:32px auto;padding:24px">
    <div class="ch"><span class="ct"><i class="ti ti-shield-lock"></i> ${h(title)}</span></div>
    <div style="padding:18px">
      <div class="alert alert-i"><strong>Status:</strong> ${h(status || 'unknown')}</div>
      <p style="margin:14px 0;color:var(--TX)">${h(body)}</p>
      <p class="muted-mini" style="font-size:12px;margin-bottom:18px">Signed in as ${h(profile?.full_name || profile?.email || 'current user')}. For support, contact your Oasis Community Health Platform administrator.</p>
      <button class="btn btn-p" onclick="logout()"><i class="ti ti-logout"></i> Logout</button>
    </div>
  </div>`;
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

  if (!profile) {
    showLockedAccess('Your account is signed in but has not been provisioned with an application profile yet. Contact a Super Admin for support.');
    return;
  }

  const lifecycleStatus = profile.approval_status || (profile.active ? 'approved' : 'suspended');
  if (lifecycleStatus !== 'approved') {
    showLifecycleAccess(lifecycleStatus, profile);
    return;
  }

  if (!profile.active) {
    showLifecycleAccess('suspended', profile);
    return;
  }

  const dashboardPage = document.getElementById('page-dashboard');
  if (dashboardPage && dashboardPageHTML !== null) dashboardPage.innerHTML = dashboardPageHTML;
  applyPermissionsUI();

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

export async function register(e) {
  e.preventDefault();

  if (!checkRateLimit('register', 3, 60000)) {
    authAlert('Too many registration attempts. Please wait 1 minute before trying again.');
    return;
  }

  setSubmitLoading(true);
  try {
    await requireSupabase();
    const fullName = sanitizeText(document.getElementById('auth-full-name')?.value, 160);
    const phone = sanitizeText(document.getElementById('auth-phone')?.value, 40);
    const chpCode = sanitizeText(document.getElementById('auth-chp-code')?.value, 40);
    const email = String(document.getElementById('auth-email')?.value ?? '').trim().toLowerCase();
    const password = document.getElementById('auth-password')?.value || '';

    if (!fullName || !phone || !email || !password) {
      authAlert('Full name, phone number, email, and password are required.');
      return;
    }

    // Check server-side rate limit before attempting signup
    const rateLimitCheck = await checkRegistrationRateLimit(email);
    if (rateLimitCheck.data?.is_rate_limited) {
      authAlert(rateLimitCheck.data.reason || 'Too many registration attempts. Please try again later.');
      await logRegistrationAttempt(email, 'rate_limited', rateLimitCheck.data.reason);
      return;
    }

    const signUpPayload = {
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          phone,
          chp_code_requested: chpCode || null,
        },
        emailRedirectTo: location.origin + location.pathname,
      },
    };

    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || sessionStorage.getItem('ochp_debug_signup') === '1') {
      console.debug('[OCHP signup] email type', typeof email);
      console.debug('[OCHP signup] email value', email);
      console.debug('[OCHP signup] payload', {
        ...signUpPayload,
        password: '[redacted]',
      });
    }

    const { error } = await sb.auth.signUp(signUpPayload);
    if (error) throw error;

    setAuthMode('login');
    authAlert('Registration submitted. Your account is awaiting Super Admin approval before system access is enabled.', 'alert-s');
    
    // Log successful registration attempt
    await logRegistrationAttempt(email, 'success');
  } catch (err) {
    console.warn('Registration failed', { code: err?.code, status: err?.status, name: err?.name });
    const errorMsg = authErrorMessage(err, 'Registration failed. Please check your details and try again.');
    authAlert(errorMsg);
    
    // Log failed registration attempt
    const email = String(document.getElementById('auth-email')?.value ?? '').trim().toLowerCase();
    await logRegistrationAttempt(email, 'failed', err?.message);
  } finally {
    setSubmitLoading(false);
  }
}

export async function login(e) {
  if (authMode === 'register') return register(e);
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
    const email = String(document.getElementById('auth-email')?.value ?? '').trim().toLowerCase();
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
    console.warn('Login failed', { code: err?.code, status: err?.status, name: err?.name });
    authAlert(authErrorMessage(err, 'Login failed. Please check your credentials and try again.'));
    if (btn && btnText && spinner) {
      btn.disabled = false;
      btnText.style.display = "inline-flex";
      spinner.style.display = "none";
    }
  }
}

export async function resetPassword() {
  const email = String(document.getElementById('auth-email')?.value ?? '').trim().toLowerCase();
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
    authAlert(authErrorMessage(err, 'Password reset failed. Please try again.'));
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
  setSubmitLoading(false);
  showAuth(false);
}
