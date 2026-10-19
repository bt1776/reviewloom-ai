const $ = id => document.getElementById(id);
const api = async (url, opts = {}) => { const r = await fetch(url, { credentials: 'same-origin', ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } }); const j = await r.json().catch(() => ({})); return { r, j }; };
let ME = { user: null, usage: null };
function showQuota(u) {
  const q = $('quota'); if (!q || !u) return;
  if (ME.user && ME.user.pro) { q.textContent = 'Pro: unlimited replies. Thank you!'; return; }
  q.textContent = u.remaining > 0 ? `${u.remaining} of ${u.limit} free replies left today` : ME.user ? 'Daily free limit reached. Go Pro for unlimited replies.' : 'Free limit reached. Sign in free for 5 a day.';
}
async function loadMe() {
  const { r, j } = await api('/api/me'); if (!r.ok) return;
  ME = j; showQuota(j.usage);
  const a = $('acctLink'); if (a) a.textContent = j.user ? 'Account' : 'Sign in';
  const s = j.settings;
  if (s) { if (s.businessName) $('businessName').value = s.businessName; if (s.businessType) $('businessType').value = s.businessType; if (s.tone) $('tone').value = s.tone; if (s.length) $('length').value = s.length; }
}
loadMe();
$('proBtn').addEventListener('click', async e => {
  if (!ME.user) return; // falls through to /account?upgrade=1 (sign in first)
  e.preventDefault();
  const { r, j } = await api('/api/billing/checkout', { method: 'POST' });
  if (r.ok && j.url) location.href = j.url;
});
$('genForm').addEventListener('submit', async e => {
  e.preventDefault(); $('err').textContent = '';
  $('genBtn').disabled = true; $('genBtn').textContent = 'Writing...';
  try {
    const { r, j } = await api('/api/generate', { method: 'POST', body: JSON.stringify({
      review: $('review').value, rating: $('rating').value, businessName: $('businessName').value, businessType: $('businessType').value, tone: $('tone').value, length: $('length').value }) });
    if (j.usage) showQuota(j.usage);
    if (!r.ok) {
      const err = new Error(j.error || 'Something went wrong');
      if (r.status === 429) { $('err').textContent = j.error + ' '; const l = document.createElement('a'); l.href = j.signedIn ? '#pricing' : '/account'; l.textContent = j.signedIn ? 'See Pro' : 'Sign in free'; $('err').append(l); throw null; }
      throw err;
    }
    $('results').innerHTML = '';
    j.replies.forEach((t, i) => {
      const d = document.createElement('div'); d.className = 'reply';
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Copy';
      b.onclick = () => navigator.clipboard.writeText(t).then(() => { b.textContent = 'Copied!'; setTimeout(() => b.textContent = 'Copy', 1500); });
      d.append(b, document.createTextNode(`Option ${i + 1}: ${t}`)); $('results').append(d);
    });
  } catch (x) { if (x) $('err').textContent = x.message; }
  $('genBtn').disabled = false; $('genBtn').textContent = 'Generate replies';
});
$('newsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const { r, j } = await api('/api/subscribe', { method: 'POST', body: JSON.stringify({ email: $('email').value }) });
  $('newsMsg').textContent = r.ok ? 'Thanks! You are on the list.' : j.error; if (r.ok) $('email').value = '';
});
