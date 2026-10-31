// ReviewLoom AI: Google review link generator (runs entirely in the browser).
(function (root) {
  function extractPlaceId(input) {
    const s = String(input || '').trim();
    if (!s) return null;
    let m = s.match(/(?:[?&](?:placeid|place_id|query_place_id)=|place_id:)([A-Za-z0-9_-]{16,})/);
    if (m) return m[1];
    try { const d = decodeURIComponent(s); if (d !== s) { m = d.match(/place_id:([A-Za-z0-9_-]{16,})/); if (m) return m[1]; } } catch (e) {}
    if (/^[A-Za-z0-9_-]{16,}$/.test(s) && !/^https?/.test(s)) return s;
    return null;
  }
  const reviewLink = id => 'https://search.google.com/local/writereview?placeid=' + encodeURIComponent(id);
  function templates(name, link) {
    const biz = name || 'our business';
    return {
      sms: `Hi! Thanks for choosing ${biz}. If you have a minute, an honest Google review would really help us: ${link}`,
      email: `Subject: How did we do?\n\nHi there,\n\nThank you for choosing ${biz}. If you have a minute, we'd really appreciate an honest review on Google. It helps other customers find us.\n\nLeave a review: ${link}\n\nThank you!\nThe ${biz} team`,
    };
  }
  const api = { extractPlaceId, reviewLink, templates };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof document === 'undefined') return;
  const $ = id => document.getElementById(id);
  function render() {
    const name = $('bizName').value.trim(), id = extractPlaceId($('placeInput').value);
    $('err').textContent = '';
    if (!id) { $('out').hidden = true; if ($('placeInput').value.trim()) $('err').textContent = 'No Place ID found. Paste a Place ID (it usually starts with ChIJ) or a Maps link that contains place_id. Use the Place ID Finder in step 1 if your link has none.'; return; }
    const link = reviewLink(id), t = templates(name, link);
    $('link').value = link; $('testLink').href = link; $('sms').value = t.sms; $('email').value = t.email;
    const qr = root.qrcode(0, 'M'); qr.addData(link); qr.make();
    const n = qr.getModuleCount(), cell = 8, pad = 4 * cell, size = n * cell + pad * 2, c = $('qr');
    c.width = c.height = size; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, size, size); g.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) g.fillRect(pad + k * cell, pad + r * cell, cell, cell);
    $('dl').href = c.toDataURL('image/png');
    $('dl').download = (name ? name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-' : '') + 'google-review-qr.png';
    $('out').hidden = false;
  }
  function finder() {
    const q = [$('bizName').value.trim(), $('bizCity').value.trim()].filter(Boolean).join(' ');
    $('mapsSearch').href = 'https://www.google.com/maps/search/' + encodeURIComponent(q || 'my business');
  }
  document.addEventListener('DOMContentLoaded', () => {
    $('linkForm').addEventListener('submit', e => { e.preventDefault(); render(); });
    ['bizName', 'bizCity'].forEach(i => $(i).addEventListener('input', () => { finder(); if (!$('out').hidden) render(); }));
    finder();
    document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
      const el = $(b.dataset.copy); navigator.clipboard.writeText(el.value).then(() => { b.textContent = 'Copied!'; setTimeout(() => b.textContent = 'Copy', 1500); }, () => { el.select(); });
    }));
  });
})(this);
