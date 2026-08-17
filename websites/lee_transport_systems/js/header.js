// Single source of truth for the site's top bar. Every page calls
// renderSiteHeader('<relative path to site root>') as the first thing in <body>,
// so editing this file changes the header on every page at once. Pass false as the
// second argument to omit the back button (used on the homepage).
function renderSiteHeader(homeHref, showBackButton) {
  const backBtnHtml = showBackButton === false
    ? ''
    : '<button class="back-btn" id="backBtn" aria-label="Go back">&larr;</button>';
  document.write(
    '<header class="site-header">' +
      '<div class="left-group">' +
        backBtnHtml +
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
  if (backBtn) backBtn.addEventListener('click', function () { history.back(); });
});
