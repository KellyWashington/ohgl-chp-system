export function activatePage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + pageId)?.classList.add('active');
}

export function activateNavItem(el) {
  document.querySelectorAll('.nt').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
}
