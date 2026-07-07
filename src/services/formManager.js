const forms = new Map();
const DEFAULTS = {
  autosaveMs: 30000,
  validationDebounceMs: 400,
  autosaveDebounceMs: 2000,
  blankIsClean: true,
};

function fingerprint(value) {
  return JSON.stringify(value ?? {});
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delay);
  };
}

function hasMeaningfulValue(values, ignoredKeys = []) {
  return Object.entries(values || {}).some(([key, value]) => !ignoredKeys.includes(key) && String(value ?? '').trim());
}

function createForm(config) {
  if (!config?.formId) throw new Error('FormManager.register requires formId.');
  if (typeof config.getValues !== 'function') throw new Error('FormManager.register requires getValues().');

  const options = { ...DEFAULTS, ...config };
  const state = {
    formId: options.formId,
    status: 'idle',
    errors: [],
    lastSavedFingerprint: fingerprint(options.initialValues ?? options.getValues()),
    autosaveTimer: null,
    touched: false,
  };

  const api = {
    formId: options.formId,
    get state() { return { ...state }; },
    getValues: options.getValues,
    isBlank() {
      return !hasMeaningfulValue(options.getValues(), options.ignoredDirtyKeys || []);
    },
    isDirty() {
      if (options.blankIsClean && api.isBlank()) return false;
      return fingerprint(options.getValues()) !== state.lastSavedFingerprint;
    },
    markClean(values = options.getValues()) {
      state.lastSavedFingerprint = fingerprint(values);
      state.touched = false;
      options.onDirtyChange?.(false, api);
    },
    setDirty() {
      state.touched = true;
      options.onDirtyChange?.(api.isDirty(), api);
    },
    async validate() {
      state.status = 'validating';
      state.errors = await Promise.resolve(options.validate?.(options.getValues(), api) || []);
      state.status = state.errors.length ? 'error' : 'idle';
      options.onValidate?.(state.errors, api);
      return state.errors;
    },
    async autosave(force = false) {
      if (!force && !api.isDirty()) return false;
      if (api.isBlank()) {
        await Promise.resolve(options.clearDraft?.(api));
        api.markClean();
        return true;
      }
      state.status = 'saving';
      await Promise.resolve(options.autosave?.(options.getValues(), api));
      api.markClean();
      state.status = 'idle';
      options.onAutosave?.(api);
      return true;
    },
    async submit() {
      if (state.status === 'submitting') return null;
      const errors = await api.validate();
      if (errors.length) return { ok: false, errors };
      state.status = 'submitting';
      options.onStatusChange?.(state.status, api);
      try {
        const result = await Promise.resolve(options.submit?.(options.getValues(), api));
        state.status = 'success';
        api.markClean();
        options.onSuccess?.(result, api);
        return { ok: true, result };
      } catch (err) {
        state.status = 'error';
        options.onError?.(err, api);
        throw err;
      } finally {
        options.onStatusChange?.(state.status, api);
      }
    },
    async reset() {
      await Promise.resolve(options.reset?.(api));
      api.markClean();
      state.status = 'idle';
    },
    async discard() {
      await Promise.resolve(options.discard?.(api));
      api.markClean();
      state.status = 'idle';
    },
    clear() {
      if (state.autosaveTimer) clearInterval(state.autosaveTimer);
      state.autosaveTimer = null;
      forms.delete(options.formId);
      options.onClear?.(api);
    },
    scheduleAutosave: debounce(() => api.autosave(false), options.autosaveDebounceMs),
    scheduleValidation: debounce(() => api.validate(), options.validationDebounceMs),
    startAutosave() {
      if (!options.autosave || state.autosaveTimer) return;
      state.autosaveTimer = setInterval(() => api.autosave(false), options.autosaveMs);
    },
    stopAutosave() {
      if (state.autosaveTimer) clearInterval(state.autosaveTimer);
      state.autosaveTimer = null;
    },
  };

  forms.set(options.formId, api);
  return api;
}

export const FormManager = {
  register: createForm,
  get(formId) { return forms.get(formId) || null; },
  reset(formId) { return forms.get(formId)?.reset(); },
  submit(formId) { return forms.get(formId)?.submit(); },
  setDirty(formId) { return forms.get(formId)?.setDirty(); },
  clear(formId) { return forms.get(formId)?.clear(); },
  all() { return Array.from(forms.values()); },
  fingerprint,
  hasMeaningfulValue,
};

export { debounce };