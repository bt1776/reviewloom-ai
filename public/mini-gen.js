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
    '<button class="btn mg-btn" type="submit"></button> <span class="small mg-note">2 free replies, no sign-in. <button type="button" class="linkish mg-sample">Try a sample review</button> · <a href="/#generator">More options</a></span>' +
    '<p class="err mg-err"></p><div class="mg-results"></div></form>';
  var q = function (s) { return box.querySelector(s); };
  q('.mg-btn').textContent = label;
  host.parentNode.replaceChild(box, host);
  // Sample review matched to the guide, so curious readers can see output without having a review handy.
  var path = location.pathname, sample = { text: 'Friendly staff and quick service. They explained everything clearly and the price was fair. Will be back!', rating: '5' };
  if (/price|expensive/.test(path)) sample = { text: 'Way overpriced. Paid almost double what I expected and nobody told me about the extra fees until the end.', rating: '2' };
  else if (/1-star|negative|fake|fault/.test(path)) sample = { text: 'Terrible experience. Waited over an hour past my appointment and nobody even apologized. Never coming back.', rating: '1' };
  else if (/2-star|3-star|old-reviews|employees/.test(path)) sample = { text: 'Service was okay but slow. The front desk seemed overwhelmed and it took three calls to get an update.', rating: '3' };
  else if (/4-star/.test(path)) sample = { text: 'Great work overall and fair price. Only reason it is not 5 stars is they showed up 30 minutes late.', rating: '4' };
  else if (/no-text/.test(path)) sample = { text: '(5 stars, no written review)', rating: '5' };
  q('.mg-sample').addEventListener('click', function () {
    var ta = q('.mg-review'); ta.value = sample.text; q('.mg-rating').value = sample.rating;
    ta.dispatchEvent(new Event('input', { bubbles: true })); q('.mg-btn').focus();
  });
  // Guide CTAs sit near the bottom; give readers who already have a review an early jump link.
  var intro = document.querySelector('article.prose > p:not(.small)');
  if (intro && intro.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING) {
    var jp = document.createElement('p'); jp.className = 'mg-jump';
    var ja = document.createElement('a'); ja.href = '#mini-generator'; ja.textContent = 'Have a review to answer right now? Paste it into the free reply writer \u2193';
    ja.addEventListener('click', function (e) {
      e.preventDefault(); if (window.rlTrack) window.rlTrack('generator_jump');
      box.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(function () { q('.mg-review').focus({ preventScroll: true }); }, 400);
    });
    jp.appendChild(ja); intro.parentNode.insertBefore(jp, intro.nextSibling);
  }
  q('.mg-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = q('.mg-btn'), err = q('.mg-err'), out = q('.mg-results');
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Writing...';
    fetch('/api/generate', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ review: q('.mg-review').value, rating: q('.mg-rating').value, tone: q('.mg-tone').value, businessName: q('.mg-biz').value, length: 'medium' }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
      .then(function (x) {
        if (!x.r.ok) {
          if (window.rlTrack) window.rlTrack(x.r.status === 429 ? 'generator_limit' : 'generator_error');
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
      .catch(function () { if (window.rlTrack) window.rlTrack('generator_error'); err.textContent = 'Network error. Please try again.'; })
      .then(function () { btn.disabled = false; btn.textContent = label; });
  });
})();
