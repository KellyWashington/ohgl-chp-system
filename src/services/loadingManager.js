const loadingScopes = new Map();

function setButtonState(button, state, label) {
  if (!button) return;
  button.dataset.state = state;
  button.disabled = state === 'loading' || state === 'disabled';
  const textNode = button.querySelector('[data-button-text], span[id$="-text"]');
  if (label && textNode) textNode.textContent = label;
  const spinner = button.querySelector('.spinner');
  if (spinner) spinner.style.display = state === 'loading' ? 'inline-block' : 'none';
  button.classList.toggle('is-loading', state === 'loading');
  button.classList.toggle('is-success', state === 'success');
  button.classList.toggle('is-error', state === 'error');
}

export const ButtonStateManager = {
  setIdle(button, label) { setButtonState(button, 'idle', label); },
  setLoading(button, label) { setButtonState(button, 'loading', label); },
  setSuccess(button, label) { setButtonState(button, 'success', label); },
  setError(button, label) { setButtonState(button, 'error', label); },
  setDisabled(button, label) { setButtonState(button, 'disabled', label); },
};

export const LoadingManager = {
  begin(scope = 'global') {
    const count = (loadingScopes.get(scope) || 0) + 1;
    loadingScopes.set(scope, count);
    document.body.classList.toggle('app-loading', loadingScopes.size > 0);
    return () => LoadingManager.end(scope);
  },
  end(scope = 'global') {
    const count = (loadingScopes.get(scope) || 0) - 1;
    if (count > 0) loadingScopes.set(scope, count);
    else loadingScopes.delete(scope);
    document.body.classList.toggle('app-loading', loadingScopes.size > 0);
  },
  button: ButtonStateManager,
  isLoading(scope) { return scope ? loadingScopes.has(scope) : loadingScopes.size > 0; },
};