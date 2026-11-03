// Runs before the first paint (a blocking script in <head>; the CSP allows no inline script): the
// theme this browser last showed, so a dark page never flashes light while the app loads.
// app/lib/theme.ts takes over from here and stays the only writer afterwards; keep the key and the
// values in step with it.
(function () {
  try {
    var pref = localStorage.getItem('freero:theme');
    var dark = pref === 'dark' || (pref !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) {
    // no storage (private window): the app decides once it runs
  }
})();
