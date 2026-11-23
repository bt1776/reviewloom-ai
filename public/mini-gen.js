// ReviewLoom AI inline reply generator for guide pages.
// Most visitors land on guides, not the homepage, so the first "#generator" CTA becomes a working generator.
(function () {
  var cta = document.querySelector('main a.btn[href$="#generator"], article a.btn[href$="#generator"], .prose a.btn[href$="#generator"]') || document.querySelector('a.btn[href$="#generator"]');
  if (!cta || document.getElementById('genForm')) return;
  var host = cta.closest('p') || cta;
  var label = (cta.textContent || '').trim() || 'Write my reply';
  var box = document.createElement('div');
  box.className = 'card mini-gen'; box.id = 'mini-generator';
  box.innerHTML = '<h3>Try it free: paste a review, get 3 replies</h3>' +
    '<form class="mg-form"><label>Customer review<textarea class="mg-review" rows="4" required maxlength="3000" placeholder="Paste the review you need to answer"></textarea></label>' +
    '<div class="mg-row"><label>Stars<select class="mg-rating"><option value="">Any</option><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select></label>' +
    '<label>Tone<select class="mg-tone"><option value="warm">Warm</option><option value="professional">Professional</option><option value="upbeat">Upbeat</option><option value="apologetic">Apologetic</option></select></label>' +
    '<label>Business name (optional)<input class="mg-biz" maxlength="80"></label></div>' +
    '<button class="btn mg-btn" type="submit"></button> <span class="small mg-note">2 free replies, no sign-in. <a href="/#generator">More options</a></span>' +
    '<p class="err mg-err"></p><div class="mg-results"></div></form>';
  var q = function (s) { return box.querySelector(s); };
  q('.mg-btn').textContent = label;
  host.parentNode.replaceChild(box, host);
  q('.mg-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = q('.mg-btn'), err = q('.mg-err'), out = q('.mg-results');
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Writing...';
    fetch('/api/generate', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ review: q('.mg-review').value, rating: q('.mg-rating').value, tone: q('.mg-tone').value, businessName: q('.mg-biz').value, length: 'medium' }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
      .then(function (x) {
        if (!x.r.ok) {
          err.textContent = x.j.error || 'Something went wrong. Please try again.';
          if (x.r.status === 429) { var a = document.createElement('a'); a.className = 'btn'; a.href = x.j.signedIn ? '/account?upgrade=1' : '/account'; a.textContent = x.j.signedIn ? 'Go Pro' : 'Sign in free for 5 a day'; err.append(' ', a); }
          return;
        }
        if (window.rlTrack) window.rlTrack('generator_use');
        out.innerHTML = '';
        (x.j.replies || []).forEach(function (t, i) {
          var d = document.createElement('div'); d.className = 'reply';
          var b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = 'Copy';
          b.onclick = function () { navigator.clipboard.writeText(t).then(function () { b.textContent = 'Copied!'; setTimeout(function () { b.textContent = 'Copy'; }, 1500); }); };
          d.append(b, document.createTextNode('Option ' + (i + 1) + ': ' + t)); out.append(d);
        });
        if (x.j.usage && x.j.usage.remaining != null) { var n = document.createElement('p'); n.className = 'small'; n.textContent = x.j.usage.remaining + ' free replies left today. Unlimited with ReviewLoom AI Pro.'; out.append(n); }
      })
      .catch(function () { err.textContent = 'Network error. Please try again.'; })
      .then(function () { btn.disabled = false; btn.textContent = label; });
  });
})();
