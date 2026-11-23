// Pre-paint theme bootstrap. Kept as a separate file (not an inline script) so
// the Content-Security-Policy can forbid inline JavaScript. The rest of the
// theme logic lives in src/stores/theme.ts and reads the same key.
(function () {
  try {
    var stored = localStorage.getItem('fireconverter.theme');
    var dark =
      stored === 'dark' ||
      ((!stored || stored === 'system') &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (error) {
    /* Private mode: the CSS media query still reflects the system setting. */
  }
})();
