const LIMIT = 5, KEY = 'rr_usage';
const today = () => new Date().toISOString().slice(0, 10);
function usage() { try { const u = JSON.parse(localStorage.getItem(KEY)); if (u && u.d === today()) return u; } catch {} return { d: today(), n: 0 }; }
function showQuota() { const left = LIMIT - usage().n; document.getElementById('quota').textContent = left > 0 ? `${left} of ${LIMIT} free replies left today` : 'Daily free limit reached. Pro (unlimited) is coming soon.'; }
const $ = id => document.getElementById(id);
showQuota();
$('genForm').addEventListener('submit', async e => {
  e.preventDefault(); $('err').textContent = '';
  const u = usage(); if (u.n >= LIMIT) { $('err').textContent = 'You have used your 5 free replies today. Join the Pro waitlist below!'; return; }
  $('genBtn').disabled = true; $('genBtn').textContent = 'Writing...';
  try {
    const r = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      review: $('review').value, rating: $('rating').value, businessName: $('businessName').value, businessType: $('businessType').value, tone: $('tone').value, length: $('length').value }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Something went wrong');
    u.n++; localStorage.setItem(KEY, JSON.stringify(u)); showQuota();
    $('results').innerHTML = '';
    j.replies.forEach((t, i) => {
      const d = document.createElement('div'); d.className = 'reply';
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Copy';
      b.onclick = () => navigator.clipboard.writeText(t).then(() => { b.textContent = 'Copied!'; setTimeout(() => b.textContent = 'Copy', 1500); });
      d.append(b, document.createTextNode(`Option ${i + 1}: ${t}`)); $('results').append(d);
    });
  } catch (x) { $('err').textContent = x.message; }
  $('genBtn').disabled = false; $('genBtn').textContent = 'Generate replies';
});
$('newsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const r = await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('email').value }) });
  const j = await r.json(); $('newsMsg').textContent = r.ok ? 'Thanks! You are on the list.' : j.error; if (r.ok) $('email').value = '';
});
