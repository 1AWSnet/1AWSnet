function toggleTheme() {
  document.body.classList.toggle('light');
  const isLight = document.body.classList.contains('light');
  document.getElementById('themeBtn').innerHTML = (isLight ? 'Switch to<br>Dark Mode' : 'Switch to<br>Light Mode');
}
