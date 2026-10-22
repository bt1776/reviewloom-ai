const $ = id => document.getElementById(id);
const api = async (url, opts = {}) => { const r = await fetch(url, { credentials: 'same-origin', ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } }); const j = await r.json().catch(() => ({})); return { r, j }; };
const qs = new URLSearchParams(location.search);
const go = async url => { $('aMsg').textContent = ''; const { r, j } = await api(url, { method: 'POST' }); if (r.ok && j.url) location.href = j.url; else $('aMsg').textContent = j.error || 'Something went wrong.'; };

async function init() {
  const { j } = await api('/api/me');
  if (!j.user) {
    $('signin').hidden = false;
    if (qs.get('error') === 'link') $('siMsg').textContent = 'That sign-in link is invalid or expired. Enter your email for a new one.';
    if (qs.get('upgrade')) localStorage.setItem('rl_upgrade', '1');
    return;
  }
  const u = j.user; $('acct').hidden = false;
  $('aEmail').textContent = u.email;
  $('aPlan').textContent = u.pro ? 'Pro ($9/mo), unlimited replies' : 'Free, 5 replies a day';
  $('aUsage').textContent = u.pro ? `${j.usage.used} (unlimited)` : `${j.usage.used} of ${j.usage.limit}`;
  $('upgradeBtn').hidden = u.pro; $('founderNote').hidden = u.pro; $('billingBtn').hidden = !u.has_billing;
  if (qs.get('welcome')) { $('banner').hidden = false; $('banner').textContent = u.pro ? 'Welcome to Pro! You now have unlimited replies.' : 'Thanks! Your payment is processing. This page will show Pro in a moment; refresh if it does not.'; }
  const wantUpgrade = !u.pro && (qs.get('upgrade') || localStorage.getItem('rl_upgrade'));
  localStorage.removeItem('rl_upgrade');
  if (qs.toString()) history.replaceState(null, '', '/account');
  if (wantUpgrade) return go('/api/billing/checkout');
  if (!u.pro) { $('profLock').hidden = false; for (const el of $('profForm').elements) el.disabled = true; return; }
  const s = j.settings || {};
  for (const k of ['businessName', 'businessType', 'tone', 'length']) if (s[k]) $(k).value = s[k];
  const h = await api('/api/replies'); const list = (h.j.replies || []);
  $('history').innerHTML = list.length ? '' : '<p class="small">No replies yet. <a href="/#generator">Write your first one</a>.</p>';
  for (const it of list) {
    const d = document.createElement('details');
    const sm = document.createElement('summary'); sm.textContent = `${new Date(it.created_at).toLocaleString()} · ${it.review.slice(0, 70)}${it.review.length > 70 ? '...' : ''}`;
    d.append(sm);
    for (const t of it.replies) {
      const r = document.createElement('div'); r.className = 'reply';
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Copy';
      b.onclick = () => navigator.clipboard.writeText(t).then(() => { b.textContent = 'Copied!'; setTimeout(() => b.textContent = 'Copy', 1500); });
      r.append(b, document.createTextNode(t)); d.append(r);
    }
    $('history').append(d);
  }
}
$('signinForm').addEventListener('submit', async e => {
  e.preventDefault(); $('siMsg').textContent = 'Sending...';
  const { r, j } = await api('/api/auth/request', { method: 'POST', body: JSON.stringify({ email: $('siEmail').value }) });
  $('siMsg').textContent = r.ok ? 'Check your inbox for a sign-in link. It expires in 15 minutes.' : j.error;
});
$('profForm').addEventListener('submit', async e => {
  e.preventDefault();
  const { r, j } = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ businessName: $('businessName').value, businessType: $('businessType').value, tone: $('tone').value, length: $('length').value }) });
  $('profMsg').textContent = r.ok ? 'Saved. The generator will be prefilled.' : j.error;
});
$('upgradeBtn').onclick = () => go('/api/billing/checkout');
$('billingBtn').onclick = () => go('/api/billing/portal');
$('logoutBtn').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/'; };
init();
