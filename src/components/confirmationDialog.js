let previousFocus = null;
let installed = false;

function getModal() {
  return document.getElementById('platform-confirmation-modal');
}

function focusable(root) {
  return Array.from(root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter(el => !el.disabled && el.offsetParent !== null);
}

function close(value) {
  const modal = getModal();
  if (!modal) return;
  modal.classList.remove('open');
  if (previousFocus?.focus) previousFocus.focus();
  const resolver = modal._resolver;
  modal._resolver = null;
  resolver?.(value);
}

function install() {
  if (installed) return;
  installed = true;
  document.addEventListener('keydown', event => {
    const modal = getModal();
    if (!modal?.classList.contains('open')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const nodes = focusable(modal);
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

export const ConfirmationDialog = {
  show(options = {}) {
    const modal = getModal();
    if (!modal) return Promise.resolve(false);
    install();
    modal.querySelector('#platform-confirm-title').textContent = options.title || 'Confirm Action';
    modal.querySelector('#platform-confirm-icon').className = `ti ${options.icon || 'ti-alert-triangle'}`;
    modal.querySelector('#platform-confirm-message').textContent = options.message || 'Please confirm this action.';
    modal.querySelector('#platform-confirm-detail').textContent = options.detail || '';
    const cancel = modal.querySelector('#platform-confirm-cancel');
    const confirm = modal.querySelector('#platform-confirm-ok');
    cancel.textContent = options.cancelLabel || 'Cancel';
    confirm.textContent = options.confirmLabel || 'Confirm';
    confirm.className = `btn ${options.danger ? 'btn-d' : 'btn-p'}`;
    cancel.onclick = () => close(false);
    confirm.onclick = () => close(true);
    previousFocus = document.activeElement;
    modal.classList.add('open');
    requestAnimationFrame(() => (options.focusConfirm ? confirm : cancel).focus());
    return new Promise(resolve => { modal._resolver = resolve; });
  },
};