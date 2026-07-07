export function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('open');
  const focusTarget = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (focusTarget) focusTarget.focus();
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('open');
}

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const openModals = Array.from(document.querySelectorAll('.mwrap.open'));
  const topModal = openModals.at(-1);
  if (['unsaved-changes-modal', 'platform-confirmation-modal', 'platform-success-modal'].includes(topModal?.id)) return;
  if (topModal?.id) {
    topModal.classList.remove('open');
    event.preventDefault();
  }
});