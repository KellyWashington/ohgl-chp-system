let previousFocus = null;

function closeSuccess() {
  const modal = document.getElementById('platform-success-modal');
  modal?.classList.remove('open');
  if (previousFocus?.focus) previousFocus.focus();
}

function renderMetadata(container, metadata = {}) {
  container.innerHTML = '';
  Object.entries(metadata).forEach(([label, value]) => {
    const row = document.createElement('div');
    const labelEl = document.createElement('span');
    const valueEl = document.createElement('strong');
    labelEl.textContent = label;
    valueEl.textContent = value ?? '';
    row.append(labelEl, valueEl);
    container.appendChild(row);
  });
}

export const SuccessModal = {
  show(options = {}) {
    const modal = document.getElementById('platform-success-modal');
    if (!modal) return false;
    modal.querySelector('#platform-success-title').textContent = options.title || 'Success';
    modal.querySelector('#platform-success-icon').className = `ti ${options.icon || 'ti-circle-check'}`;
    modal.querySelector('#platform-success-summary').textContent = options.summary || 'The action completed successfully.';
    const status = modal.querySelector('#platform-success-status');
    status.textContent = options.status || '';
    status.style.display = options.status ? 'inline-flex' : 'none';
    const meta = modal.querySelector('#platform-success-metadata');
    renderMetadata(meta, options.metadata || {});
    meta.style.display = Object.keys(options.metadata || {}).length ? 'grid' : 'none';
    const actions = modal.querySelector('#platform-success-actions');
    actions.innerHTML = '';
    (options.actions || [{ label: 'Close', kind: 'primary', onClick: closeSuccess }]).forEach(action => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn ${action.kind === 'secondary' ? 'btn-s' : 'btn-p'}`;
      btn.textContent = action.label;
      btn.onclick = () => {
        action.onClick?.();
        if (action.close !== false) closeSuccess();
      };
      actions.appendChild(btn);
    });
    previousFocus = document.activeElement;
    modal.classList.add('open');
    requestAnimationFrame(() => actions.querySelector('button')?.focus());
    return true;
  },
  close: closeSuccess,
};