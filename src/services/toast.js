const queue = [];
let activeToast = null;

function ensureHost() {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.className = 'toast-host';
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-relevant', 'additions');
    document.body.appendChild(host);
  }
  return host;
}

function renderNext() {
  if (activeToast || !queue.length) return;
  const item = queue.shift();
  const host = ensureHost();
  const toast = document.createElement('div');
  toast.className = `platform-toast platform-toast-${item.kind || 'info'}`;
  toast.setAttribute('role', item.kind === 'error' ? 'alert' : 'status');
  toast.innerHTML = `<i class="ti ${item.icon || iconFor(item.kind)}" aria-hidden="true"></i><span></span>`;
  toast.querySelector('span').textContent = item.message;
  host.appendChild(toast);
  activeToast = toast;
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
      activeToast = null;
      renderNext();
    }, 180);
  }, item.duration ?? 3200);
}

function iconFor(kind) {
  return {
    success: 'ti-circle-check',
    warning: 'ti-alert-triangle',
    error: 'ti-alert-circle',
    info: 'ti-info-circle',
  }[kind] || 'ti-info-circle';
}

export const Toast = {
  show(message, options = {}) {
    queue.push({ message, ...options });
    renderNext();
  },
  success(message, options = {}) { Toast.show(message, { ...options, kind: 'success' }); },
  warning(message, options = {}) { Toast.show(message, { ...options, kind: 'warning' }); },
  error(message, options = {}) { Toast.show(message, { ...options, kind: 'error' }); },
  info(message, options = {}) { Toast.show(message, { ...options, kind: 'info' }); },
  clear() { queue.length = 0; activeToast?.remove(); activeToast = null; },
};