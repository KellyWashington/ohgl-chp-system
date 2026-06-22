export function h(v) {
  return String(v ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[c]));
}

export function sanitizeText(v, max = 500) {
  return String(v ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
}

export function setSafeHTML(elOrId, html) {
  const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
  if (el) {
    el.innerHTML = DOMPurify.sanitize(String(html ?? ''), { USE_PROFILES: { html: true } });
  }
}

export function installInnerHTMLSanitizer() {
  let isSanitizing = false;
  const rawInnerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', {
    get() { return rawInnerHTML.get.call(this); },
    set(value) {
      if (isSanitizing) {
        rawInnerHTML.set.call(this, value);
      } else {
        isSanitizing = true;
        try {
          const clean = DOMPurify.sanitize(String(value ?? ''), { USE_PROFILES: { html: true } });
          rawInnerHTML.set.call(this, clean);
        } finally {
          isSanitizing = false;
        }
      }
    },
  });
}
