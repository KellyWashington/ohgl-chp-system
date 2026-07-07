const DEFAULT_COPY = {
  title: 'Unsaved Changes',
  icon: 'ti-alert-triangle',
  message: 'You have unsaved changes.',
  detail: 'Leaving this page may cause patient information to be lost.',
  prompt: 'Choose how you would like to continue.',
  stayLabel: 'Stay Here',
  leaveLabel: 'Leave Without Saving',
  saveLabel: 'Save Draft & Leave',
};

const guards = new Map();
let pendingNavigation = null;
let previousFocus = null;
let focusTrapReady = false;

function tabbableElements(root) {
  return Array.from(root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter(el => !el.disabled && el.offsetParent !== null);
}

function activeDirtyGuards(context = {}) {
  return Array.from(guards.values()).filter(guard => {
    if (guard.disabled?.(context)) return false;
    if (guard.bypassConditions?.some(fn => fn(context))) return false;
    return !!guard.isDirty?.(context);
  });
}

function ensureFocusTrap() {
  if (focusTrapReady) return;
  focusTrapReady = true;
  document.addEventListener('keydown', event => {
    const modal = document.getElementById('unsaved-changes-modal');
    if (!modal?.classList.contains('open')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      resolvePending(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const nodes = tabbableElements(modal);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

function setBusy(isBusy) {
  const buttons = document.querySelectorAll('#unsaved-changes-modal button');
  buttons.forEach(btn => { btn.disabled = isBusy; });
  const saveBtn = document.getElementById('unsaved-save');
  if (saveBtn) saveBtn.classList.toggle('is-busy', isBusy);
}

function closeDialog() {
  const modal = document.getElementById('unsaved-changes-modal');
  modal?.classList.remove('open');
  setBusy(false);
  if (previousFocus?.focus) previousFocus.focus();
  previousFocus = null;
}

function resolvePending(value) {
  if (!pendingNavigation) return;
  const resolver = pendingNavigation.resolve;
  pendingNavigation = null;
  closeDialog();
  resolver(value);
}

function renderDialog(copy, mode) {
  const modal = document.getElementById('unsaved-changes-modal');
  if (!modal) return;
  document.getElementById('unsaved-title').textContent = copy.title;
  document.getElementById('unsaved-icon').className = `ti ${copy.icon || DEFAULT_COPY.icon}`;
  document.getElementById('unsaved-message').textContent = copy.message;
  document.getElementById('unsaved-detail').textContent = copy.detail;
  document.getElementById('unsaved-prompt').textContent = copy.prompt;
  document.getElementById('unsaved-stay').textContent = copy.stayLabel;
  document.getElementById('unsaved-leave').textContent = copy.leaveLabel;
  document.getElementById('unsaved-save').textContent = copy.saveLabel;
  modal.dataset.mode = mode || 'navigation';
  previousFocus = document.activeElement;
  modal.classList.add('open');
  ensureFocusTrap();
  requestAnimationFrame(() => document.getElementById('unsaved-stay')?.focus());
}

async function saveAndClear(dirtyGuards, context) {
  for (const guard of dirtyGuards) {
    await guard.saveDraft?.(context);
    guard.markClean?.(context);
  }
}

async function discardAll(dirtyGuards, context) {
  for (const guard of dirtyGuards) {
    await guard.discard?.(context);
    guard.markClean?.(context);
  }
}

export function registerUnsavedChangesGuard(config) {
  if (!config?.formId || typeof config.isDirty !== 'function') {
    throw new Error('Unsaved changes guard requires formId and isDirty().');
  }
  guards.set(config.formId, { ...DEFAULT_COPY, ...config });
  return () => guards.delete(config.formId);
}

export function hasUnsavedChanges(context = {}) {
  return activeDirtyGuards(context).length > 0;
}

export async function confirmNavigation(context = {}) {
  const dirtyGuards = activeDirtyGuards(context);
  if (!dirtyGuards.length) return true;
  const primary = dirtyGuards[0];
  const copy = {
    ...DEFAULT_COPY,
    ...(context.copy || {}),
    ...(primary.copy || {}),
  };
  if (context.type === 'logout') {
    copy.title = context.copy?.title || primary.logoutCopy?.title || 'Unsaved Referral';
    copy.message = context.copy?.message || primary.logoutCopy?.message || 'You have an unsaved referral.';
    copy.detail = context.copy?.detail || primary.logoutCopy?.detail || 'Would you like to save it before signing out?';
    copy.prompt = context.copy?.prompt || '';
    copy.stayLabel = context.copy?.stayLabel || primary.logoutCopy?.stayLabel || 'Stay Logged In';
    copy.saveLabel = context.copy?.saveLabel || primary.logoutCopy?.saveLabel || 'Save Draft & Logout';
    copy.leaveLabel = context.copy?.leaveLabel || primary.logoutCopy?.leaveLabel || 'Logout Without Saving';
  }

  return new Promise(resolve => {
    pendingNavigation = { resolve, dirtyGuards, context };
    renderDialog(copy, context.type || 'navigation');
  });
}

export function installUnsavedChangesGuard() {
  window.addEventListener('beforeunload', event => {
    if (!hasUnsavedChanges({ type: 'browser' })) return;
    event.preventDefault();
    event.returnValue = '';
  });

  window.addEventListener('popstate', async () => {
    if (await confirmNavigation({ type: 'history' })) return;
    history.pushState({ guarded: true }, '', location.href);
  });
  history.replaceState({ guarded: true }, '', location.href);

  document.getElementById('unsaved-stay')?.addEventListener('click', () => resolvePending(false));
  document.getElementById('unsaved-leave')?.addEventListener('click', async () => {
    const pending = pendingNavigation;
    if (!pending) return;
    setBusy(true);
    try {
      await discardAll(pending.dirtyGuards, pending.context);
      resolvePending(true);
    } catch (err) {
      console.error('Unable to discard unsaved changes', err);
      setBusy(false);
    }
  });
  document.getElementById('unsaved-save')?.addEventListener('click', async () => {
    const pending = pendingNavigation;
    if (!pending) return;
    setBusy(true);
    try {
      await saveAndClear(pending.dirtyGuards, pending.context);
      resolvePending(true);
    } catch (err) {
      console.error('Unable to save draft before leaving', err);
      const detail = document.getElementById('unsaved-detail');
      if (detail) detail.textContent = err?.message || 'Draft could not be saved. Please try again.';
      setBusy(false);
    }
  });
}

export function resetUnsavedChangesGuards(context = {}) {
  activeDirtyGuards(context).forEach(guard => guard.markClean?.(context));
}
