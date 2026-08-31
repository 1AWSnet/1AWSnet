// "Menu" disclosure: folds the site header, table switcher and Old Rates
// toggle away so the table has the screen. Collapsed by default.
function toggleChrome() {
  const panel = document.getElementById('chromePanel');
  const btn = document.getElementById('chromeToggle');
  const opening = panel.hidden;
  panel.hidden = !opening;
  btn.setAttribute('aria-expanded', String(opening));
  btn.querySelectorAll('.chev').forEach(c => { c.textContent = opening ? '▴' : '▾'; });
}
