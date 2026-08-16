// Single source of truth for the site's top bar. Every page calls
// renderSiteHeader('<relative path to site root>') as the first thing in <body>,
// so editing this file changes the header on every page at once.
function renderSiteHeader(homeHref) {
  document.write(
    '<header class="site-header">' +
      '<a class="home-link" href="' + homeHref + '">Lee Transport Systems</a>' +
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
