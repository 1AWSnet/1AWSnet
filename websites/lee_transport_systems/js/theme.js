(function () {
  function getStoredTheme() {
    const match = document.cookie.match(/(?:^|; )theme=(light|dark)/);
    return match ? match[1] : 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.classList.toggle('light', theme === 'light');
  }

  // Runs synchronously while <head> is still parsing, before <body> paints,
  // so the page never flashes the wrong theme on load.
  applyTheme(getStoredTheme());

  function isLight() {
    return document.documentElement.classList.contains('light');
  }

  function updateThemeLabel() {
    const btn = document.getElementById('themeBtn');
    if (btn) btn.textContent = isLight() ? 'Switch to Dark Mode' : 'Switch to Light Mode';
  }

  function setTheme(light) {
    document.documentElement.classList.toggle('light', light);
    document.cookie = 'theme=' + (light ? 'light' : 'dark') + '; path=/; max-age=31536000; SameSite=Lax';
    updateThemeLabel();
  }

  function closeMenu() {
    const dropdown = document.getElementById('menuDropdown');
    const btn = document.getElementById('menuBtn');
    if (dropdown) dropdown.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function toggleMenu() {
    const dropdown = document.getElementById('menuDropdown');
    const btn = document.getElementById('menuBtn');
    if (!dropdown) return;
    const open = dropdown.classList.toggle('open');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  document.addEventListener('DOMContentLoaded', function () {
    updateThemeLabel();

    const menuBtn = document.getElementById('menuBtn');
    const themeBtn = document.getElementById('themeBtn');

    if (menuBtn) {
      menuBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        toggleMenu();
      });
    }
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        setTheme(!isLight());
        closeMenu();
      });
    }
    document.addEventListener('click', function (event) {
      const dropdown = document.getElementById('menuDropdown');
      if (!dropdown || !dropdown.classList.contains('open')) return;
      if (!dropdown.contains(event.target) && event.target !== menuBtn) closeMenu();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeMenu();
    });
  });
})();
