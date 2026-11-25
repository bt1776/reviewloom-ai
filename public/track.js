// ReviewLoom AI first-party analytics: event name, page, and src/utm only. No cookies, IPs, or user agents.
(function () {
  var KEY = 'rl_src', qs = new URLSearchParams(location.search), tags = {};
  try { tags = JSON.parse(sessionStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
  ['src', 'utm_source', 'utm_medium', 'utm_campaign'].forEach(function (k) { var v = qs.get(k); if (v) tags[k] = v.slice(0, 80); });
  try { sessionStorage.setItem(KEY, JSON.stringify(tags)); } catch (e) {}
  function track(name) {
    var body = JSON.stringify(Object.assign({ name: name, page: location.pathname }, tags));
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/event', new Blob([body], { type: 'application/json' }))) return;
    } catch (e) {}
    fetch('/api/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
  }
  window.rlTrack = track;
  track('landing_view');
  // engaged: first real interaction (scroll, tap, key) on this page view, to separate humans from JS-running bots.
  var engaged = false;
  function onEngage() { if (engaged) return; engaged = true; track('engaged'); ['scroll', 'pointerdown', 'keydown', 'touchstart'].forEach(function (t) { window.removeEventListener(t, onEngage, true); }); }
  ['scroll', 'pointerdown', 'keydown', 'touchstart'].forEach(function (t) { window.addEventListener(t, onEngage, { capture: true, passive: true }); });
  // generator_start: visitor began typing a review into a generator (homepage or inline guide generator).
  var started = false;
  document.addEventListener('input', function (e) {
    var t = e.target; if (started || !t || t.tagName !== 'TEXTAREA') return;
    if (t.closest && t.closest('#genForm, .mg-form')) { started = true; track('generator_start'); }
  }, true);
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a,button'); if (!a) return;
    var href = a.getAttribute('href') || '';
    if (a.dataset.track) track(a.dataset.track);
    else if (a.id === 'proBtn' || a.id === 'upgradeBtn' || /upgrade=1/.test(href)) track('pro_click');
  }, true);
  document.addEventListener('submit', function (e) {
    var id = e.target && e.target.id;
    if (id === 'newsForm') track('newsletter_optin');
    else if (id === 'signinForm') track('signup_start');
  }, true);
})();
