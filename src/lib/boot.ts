// The start screen drawn by index.html (eagle + PRIME CAPITOL) stays until the app knows who you are, then fades.
// Nov 8: it replaced the old React splash, which made everyone wait ~2 s on every open even when the app was ready.
export function hideBoot() {
  const b = document.getElementById('boot')
  if (!b || b.classList.contains('out')) return
  b.classList.add('out')
  setTimeout(() => b.remove(), 400)
}
