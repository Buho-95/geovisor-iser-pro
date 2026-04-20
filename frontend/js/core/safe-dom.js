/**
 * Evita XSS al insertar texto o fragmentos con datos externos.
 */
export function setTextContent(el, text) {
  if (!el) return;
  el.textContent = text == null ? '' : String(text);
}

export function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}
