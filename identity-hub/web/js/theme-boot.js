// Runs before the first paint so that the chosen theme shows with no flash.
// The theme is the only value this app keeps in localStorage. No saved value = the dark theme.
(function () {
  try {
    var t = localStorage.getItem('postern.theme');
    if (t === 'light' || t === 'system') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage is blocked: the dark theme */ }
})();
