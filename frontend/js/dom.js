/* Small DOM helpers. */
export function setStatus(elId, msg, cls) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.className = 'status' + (cls ? ' ' + cls : '');
}
