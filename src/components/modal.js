export function openModal(id) {
  document.getElementById(id).classList.add('open');
}

export function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
