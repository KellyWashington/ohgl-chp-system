# OCHP Form Framework

## Purpose

The OCHP Form Framework is the reusable UX foundation for platform forms. It centralizes form lifecycle behavior without changing IAM, RLS, secure RPCs, referral numbering, workflow transitions, or database design.

Current and future modules should consume the framework instead of recreating page-local dirty tracking, draft persistence, loading state, success dialogs, confirmation dialogs, and toast notifications.

## Components

### FormManager

`src/services/formManager.js` owns form lifecycle state:

- dirty state by comparing current values with the last clean fingerprint
- blank-form clean detection through ignored keys
- debounced autosave
- debounced validation
- reset, discard, clear, and submit hooks
- loading, success, and error status transitions

Example:

```js
const form = FormManager.register({
  formId: 'coverage-area-editor',
  getValues: readCoverageAreaForm,
  ignoredDirtyKeys: ['updatedAt'],
  validate: values => validateCoverageArea(values),
  autosave: values => DraftEngine.save('coverage-area-editor', values),
  submit: values => saveCoverageArea(values),
  discard: resetCoverageAreaForm,
});
```

### DraftEngine

`src/services/draftEngine.js` provides a generic draft provider registry. Providers can use the default local storage implementation or supply secure custom `save`, `load`, and `clear` hooks.

Every draft must be scoped by form and user. Browser scoping is supported for modules that store temporary data locally.

```js
DraftEngine.register({
  formId: 'user-profile',
  userId: () => currentUser.id,
  expireAfter: 24 * 60 * 60 * 1000,
});
```

### UnsavedChangesGuard

`src/services/unsavedChangesGuard.js` blocks unsafe exits from dirty forms. It supports internal navigation, logout, browser refresh/close, address-bar navigation, and back/forward handling. Forms register once and provide `isDirty`, `saveDraft`, `discard`, and optional copy.

### SuccessModal

`src/components/successModal.js` provides a configurable success dialog with title, icon, summary, status, metadata, and actions. Metadata is rendered with `textContent` to avoid unsafe HTML injection.

### ConfirmationDialog

`src/components/confirmationDialog.js` provides reusable confirmation dialogs for delete, discard, archive, deactivate, and future clinical actions. It includes focus trapping, Escape handling, and focus restoration.

### LoadingManager and ButtonStateManager

`src/services/loadingManager.js` standardizes loading scopes and button states: idle, loading, success, error, and disabled.

### Toast

`src/services/toast.js` provides queued success, warning, error, and information notifications with accessible live regions and auto-dismiss behavior.

## Lifecycle

1. A module registers a draft provider if drafts are needed.
2. The module registers a `FormManager` instance with `getValues`, validation, autosave, submit, reset, and discard hooks.
3. The module registers with `UnsavedChangesGuard` using the form manager's dirty, autosave, and discard methods.
4. Field changes call `form.setDirty()` and `form.scheduleAutosave()`.
5. Autosave writes the draft and marks the current value fingerprint clean.
6. Submit validates, calls the module's secure service/RPC, then marks the form clean.
7. Discard/reset clears temporary data and marks the form clean.
8. Logout, user switch, session timeout, submission, and discard clear PHI-bearing temporary state.

## New Referral Migration

New Referral now uses the framework for lifecycle concerns while preserving referral business behavior:

- secure referral creation still uses the existing `createReferralRecord` path
- duplicate active referral validation remains page-local business validation
- referral slip numbers remain database-generated
- draft ownership remains user and browser scoped
- success display uses `SuccessModal.show()`
- submit button state uses `LoadingManager.button`
- unsaved navigation uses `UnsavedChangesGuard`

## Extension Guide

When adding a new form:

1. Define a stable `formId`.
2. Implement `getValues()` using normalized field names.
3. Register `DraftEngine` if the form can be safely drafted.
4. Register `FormManager` with validation, autosave, submit, reset, and discard hooks.
5. Register `UnsavedChangesGuard` using the form manager.
6. Use `LoadingManager.button` for submit buttons.
7. Use `SuccessModal.show()` after successful completion.
8. Use `ConfirmationDialog.show()` for destructive or irreversible actions.
9. Use `Toast` for short status updates.
10. Clear PHI from memory, session storage, and local drafts on logout, user switch, submission, and discard.

## Best Practices

- Keep business rules in the owning module or backend service; keep lifecycle plumbing in the framework.
- Never store drafts without a user scope.
- Treat autosaved drafts as the new clean state.
- Keep blank untouched forms clean.
- Do not trigger API writes from dirty detection alone.
- Do not bypass secure RPCs, workflow commands, IAM, RLS, or audit boundaries.
- Render user-provided values with `textContent` or existing sanitizers.

## Coding Standards

- Use one `formId` per logical form.
- Register framework services lazily when the page is initialized.
- Debounce field autosave and validation.
- Avoid duplicate listeners and duplicate autosave timers.
- Prefer framework APIs over page-local modal, toast, loading, and dirty-state implementations.