// Apply the saved theme before the first paint so dark mode never flashes white.
(function () {
  try {
    var pref = localStorage.getItem('folio.theme') || 'system';
    var dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (e) {
    document.documentElement.dataset.theme = 'light';
  }
})();
