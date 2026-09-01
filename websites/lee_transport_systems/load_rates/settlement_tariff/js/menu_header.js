// Collapsible top menu bar.
function toggleTopMenuBar() {
  const panel = document.getElementById('chromePanel');
  const btn = document.getElementById('chromeToggle');
  const opening = panel.hidden;
  panel.hidden = !opening;
  btn.setAttribute('aria-expanded', String(opening));
  btn.querySelectorAll('.chev').forEach(c => { c.textContent = opening ? '▴' : '▾'; });
}
