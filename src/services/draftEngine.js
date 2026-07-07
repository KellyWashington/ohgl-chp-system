const providers = new Map();
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DRAFT_PREFIX = 'ochp_form_draft:';

function defaultBrowserId() {
  try {
    const key = 'ochp_form_browser_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch (_err) {
    return 'session-only';
  }
}

function storageKey(config) {
  const userId = typeof config.userId === 'function' ? config.userId() : config.userId;
  const browserId = typeof config.browserId === 'function' ? config.browserId() : (config.browserId || defaultBrowserId());
  return userId ? `${DRAFT_PREFIX}${config.formId}:${userId}:${browserId}` : null;
}

function removeMatching(predicate) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(DRAFT_PREFIX) && predicate(key)) localStorage.removeItem(key);
    }
  } catch (_err) {}
}

function registerDraftProvider(config) {
  if (!config?.formId) throw new Error('DraftEngine.register requires formId.');
  providers.set(config.formId, config);
  return () => providers.delete(config.formId);
}

async function save(formId, data) {
  const provider = providers.get(formId);
  if (!provider) return false;
  if (provider.save) return provider.save(data);
  const key = storageKey(provider);
  const userId = typeof provider.userId === 'function' ? provider.userId() : provider.userId;
  if (!key || !userId) return false;
  const now = Date.now();
  localStorage.setItem(key, JSON.stringify({
    formId,
    userId,
    browserId: typeof provider.browserId === 'function' ? provider.browserId() : (provider.browserId || defaultBrowserId()),
    savedAt: now,
    expiresAt: now + (provider.expireAfter || DEFAULT_TTL_MS),
    data,
  }));
  return true;
}

async function load(formId) {
  const provider = providers.get(formId);
  if (!provider) return null;
  if (provider.load) return provider.load();
  const key = storageKey(provider);
  if (!key) return null;
  try {
    const draft = JSON.parse(localStorage.getItem(key) || 'null');
    if (!draft || draft.expiresAt <= Date.now()) {
      localStorage.removeItem(key);
      return null;
    }
    return draft;
  } catch (_err) {
    localStorage.removeItem(key);
    return null;
  }
}

async function clear(formId) {
  const provider = providers.get(formId);
  if (!provider) return;
  if (provider.clear) return provider.clear();
  const key = storageKey(provider);
  if (key) localStorage.removeItem(key);
}

function clearForUser(userId) {
  if (!userId) return;
  removeMatching(key => key.includes(`:${userId}:`));
}

function clearAll() {
  removeMatching(() => true);
}

export const DraftEngine = { register: registerDraftProvider, save, load, clear, clearForUser, clearAll, defaultBrowserId };
export { registerDraftProvider };