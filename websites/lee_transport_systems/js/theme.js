function toggleTheme() {
  document.body.classList.toggle('light');
  const isLight = document.body.classList.contains('light');
  const btn = document.getElementById('themeBtn');
  if (btn) btn.innerHTML = (isLight ? 'Switch to<br>Dark Mode' : 'Switch to<br>Light Mode');
}
