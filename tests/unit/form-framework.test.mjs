import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FormManager } from '../../src/services/formManager.js';

const newReferral = readFileSync('src/pages/newReferral.js', 'utf8');
const indexHtml = readFileSync('index.html', 'utf8');
const guard = readFileSync('src/services/unsavedChangesGuard.js', 'utf8');
const successModal = readFileSync('src/components/successModal.js', 'utf8');
const toast = readFileSync('src/services/toast.js', 'utf8');
const loading = readFileSync('src/services/loadingManager.js', 'utf8');

test('FormManager tracks dirty and clean states against persisted values', async () => {
  let values = { name: '', date: '2026-07-07' };
  const form = FormManager.register({
    formId: 'unit-form',
    getValues: () => values,
    ignoredDirtyKeys: ['date'],
    autosave: async current => { values = { ...current }; },
  });

  assert.equal(form.isDirty(), false);
  values = { name: 'Patient A', date: '2026-07-07' };
  assert.equal(form.isDirty(), true);
  await form.autosave(true);
  assert.equal(form.isDirty(), false);
  values = { name: '', date: '2026-07-07' };
  assert.equal(form.isDirty(), false);
  form.clear();
});

test('DraftEngine exposes provider API for user-scoped drafts', async () => {
  const { DraftEngine } = await import('../../src/services/draftEngine.js');
  let stored = null;
  const unregister = DraftEngine.register({
    formId: 'draft-unit',
    userId: 'user-1',
    save: data => { stored = { userId: 'user-1', data }; return true; },
    load: () => stored,
    clear: () => { stored = null; },
  });

  assert.equal(await DraftEngine.save('draft-unit', { field: 'value' }), true);
  assert.deepEqual(await DraftEngine.load('draft-unit'), { userId: 'user-1', data: { field: 'value' } });
  await DraftEngine.clear('draft-unit');
  assert.equal(await DraftEngine.load('draft-unit'), null);
  unregister();
});

test('platform form framework components are reusable and wired to New Referral', () => {
  assert.match(newReferral, /FormManager\.register/);
  assert.match(newReferral, /DraftEngine\.register/);
  assert.match(newReferral, /SuccessModal\.show/);
  assert.match(newReferral, /LoadingManager\.button\.setLoading/);
  assert.match(newReferral, /Toast\.show/);
  assert.match(guard, /registerUnsavedChangesGuard/);
  assert.match(guard, /beforeunload/);
  assert.match(guard, /popstate/);
});

test('generic platform dialogs and accessibility hooks exist', () => {
  assert.match(indexHtml, /id="platform-confirmation-modal"/);
  assert.match(indexHtml, /id="platform-success-modal"/);
  assert.match(indexHtml, /aria-modal="true"/);
  assert.match(successModal, /textContent/);
  assert.doesNotMatch(successModal, /metadataRows/);
  assert.match(toast, /aria-live/);
  assert.match(loading, /ButtonStateManager/);
});