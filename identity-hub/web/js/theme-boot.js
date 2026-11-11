// Runs before the first paint so that the chosen theme shows with no flash.
// The theme is the only value this app keeps in localStorage.
(function () {
  try {
    var t = localStorage.getItem('postern.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage is blocked: follow the system theme */ }
})();
