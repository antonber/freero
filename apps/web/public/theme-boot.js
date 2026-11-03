// Runs before the first paint (a blocking script in <head>; the CSP allows no inline script): the
// theme this browser last showed, so a dark page never flashes light while the app loads. A board
// embedded on another page (/embed/b/…, /embed/board/…) doesn't follow this browser's choice: it is
// light unless the embedding page asks with ?theme=dark (or #…&theme=dark). app/lib/theme.ts takes
// over from here and stays the only writer afterwards; keep the key, values and rules in step.
(function () {
  try {
    var embedded = /^\/embed\/(b|board)\//.test(location.pathname);
    var dark;
    if (embedded) {
      var asked = new URLSearchParams(location.search).get('theme') || new URLSearchParams(location.hash.slice(1)).get('theme');
      dark = asked === 'dark';
    } else {
      var pref = localStorage.getItem('freero:theme');
      dark = pref === 'dark' || (pref !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) {
    // no storage (a private window, a partitioned frame): the app decides once it runs
  }
})();
