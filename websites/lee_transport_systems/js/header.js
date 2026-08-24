// Single source of truth for the site's top bar. Every page calls
// renderSiteHeader('<relative path to site root>') as the first thing in <body>,
// so editing this file changes the header on every page at once. The back
// button always renders (even on the root page) so the header stays the same
// width everywhere; on the root page it's just hidden via CSS since there's
// no parent directory to go up to.
function renderSiteHeader(homeHref) {
  document.write(
    '<header class="site-header">' +
      '<div class="left-group">' +
        '<button class="back-btn" id="backBtn" aria-label="Go back">&larr;</button>' +
        '<a class="home-link" href="' + homeHref + '">Lee Transport Systems</a>' +
      '</div>' +
      '<div class="menu">' +
        '<button class="hamburger-btn" id="menuBtn" aria-label="Menu" aria-haspopup="true" aria-expanded="false">' +
          '<span></span><span></span><span></span>' +
        '</button>' +
        '<div class="menu-dropdown" id="menuDropdown">' +
          '<button class="menu-item" id="themeBtn">Switch to Light Mode</button>' +
        '</div>' +
      '</div>' +
    '</header>'
  );
}

document.addEventListener('DOMContentLoaded', function () {
  const backBtn = document.getElementById('backBtn');
  if (!backBtn) return;

  let path = location.pathname;
  if (path === '/index.html') path = '/';
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  if (path === '/' || path === '') {
    backBtn.classList.add('back-btn-hidden');
    backBtn.disabled = true;
    return;
  }

  const parentPath = path.slice(0, path.lastIndexOf('/') + 1) || '/';
  backBtn.addEventListener('click', function () { location.href = parentPath; });
});
