// Run with: npm test. Uses the JSON file store in a temp dir, dev-mode email, and a mocked Stripe signature.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), fs = require('fs'), path = require('path');
for (const k of ['DATABASE_URL', 'RESEND_API_KEY', 'XAI_API_KEY', 'OPENAI_API_KEY', 'STRIPE_PRICE_ID', 'BUTTONDOWN_API_KEY', 'RENDER', 'APP_URL']) delete process.env[k];
process.env.SESSION_SECRET = 'test-secret';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test123';
const Stripe = require('stripe');
const { createApp } = require('../server');
const { createStore } = require('../lib/store');
const mail = require('../lib/mail');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
const PG = process.env.TEST_DATABASE_URL || '';
const store = createStore({ databaseUrl: PG, file: path.join(dir, 'store.json') });
const stripe = new Stripe('sk_test_dummy');
stripe.customers.retrieve = async id => ({ id, email: 'bymail@example.com' }); // no network in tests
let server, base;
const origLog = console.log; console.log = () => {}; // silence dev-mail output

test.before(async () => {
  await store.init();
  if (PG) { const { Client } = require('pg'); const c = new Client({ connectionString: PG }); await c.connect(); await c.query('TRUNCATE users, login_tokens, usage, replies, settings CASCADE'); await c.end(); } // test DB only
  server = createApp({ store, stripe }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await store.close(); console.log = origLog; fs.rmSync(dir, { recursive: true, force: true }); });

const req = (p, { method = 'GET', body, cookie, headers = {} } = {}) => fetch(base + p, {
  method, redirect: 'manual',
  headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
  body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
});
const gen = (cookie, headers) => req('/api/generate', { method: 'POST', cookie, headers, body: { review: 'Great coffee and friendly staff!', tone: 'warm' } });

async function signIn(email) {
  const r = await req('/api/auth/request', { method: 'POST', body: { email } });
  assert.strictEqual(r.status, 200);
  const m = mail.sent.filter(x => x.to === email.toLowerCase() && /sign-in link/.test(x.subject)).pop();
  const link = m.text.match(/https?:\/\/\S+\/auth\/verify\?token=\S+/)[0];
  const v = await fetch(link.replace(/^https?:\/\/[^/]+/, base), { redirect: 'manual' });
  assert.strictEqual(v.status, 302); assert.strictEqual(v.headers.get('location'), '/account');
  const sc = v.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/i); assert.match(sc, /Max-Age=2592000/);
  return { cookie: sc.split(';')[0], link };
}

test('auth: request -> verify -> me -> logout; tokens single-use and hashed', async () => {
  const bad = await req('/api/auth/request', { method: 'POST', body: { email: 'nope' } });
  assert.strictEqual(bad.status, 400);
  const { cookie, link } = await signIn('Owner@Example.com');
  const me = await (await req('/api/me', { cookie })).json();
  assert.strictEqual(me.user.email, 'owner@example.com'); assert.strictEqual(me.user.plan, 'free');
  assert.deepStrictEqual(me.usage, { used: 0, limit: 5, remaining: 5 });
  // welcome email sent once
  assert.strictEqual(mail.sent.filter(x => x.to === 'owner@example.com' && x.subject === 'Welcome to ReviewLoom AI').length, 1);
  // reuse of link fails
  const again = await fetch(link.replace(/^https?:\/\/[^/]+/, base), { redirect: 'manual' });
  assert.strictEqual(again.headers.get('location'), '/account?error=link');
  // raw token not in store file
  const token = new URL(link).searchParams.get('token');
  if (!PG) assert.ok(!fs.readFileSync(path.join(dir, 'store.json'), 'utf8').includes(token));
  else assert.strictEqual(await store.consumeToken(token), null);
  // tampered cookie rejected
  const t = await (await req('/api/me', { cookie: cookie.slice(0, -2) + 'xx' })).json();
  assert.strictEqual(t.user, null);
  const lo = await req('/api/auth/logout', { method: 'POST', cookie });
  assert.match(lo.headers.get('set-cookie'), /rl_session=;/);
  // second sign-in: no second welcome
  await signIn('owner@example.com');
  assert.strictEqual(mail.sent.filter(x => x.subject === 'Welcome to ReviewLoom AI' && x.to === 'owner@example.com').length, 1);
});

test('auth: expired token rejected', async () => {
  const crypto = require('crypto');
  await store.saveToken(crypto.createHash('sha256').update('oldtok').digest('hex'), 'old@example.com', new Date(Date.now() - 1000));
  const r = await req('/auth/verify?token=oldtok');
  assert.strictEqual(r.headers.get('location'), '/account?error=link');
});

test('limits: anonymous 2/day by IP, x-rl-pro header ignored', async () => {
  for (let i = 0; i < 2; i++) { const r = await gen(undefined, { 'x-rl-pro': '1' }); assert.strictEqual(r.status, 200); const j = await r.json(); assert.strictEqual(j.replies.length, 3); assert.strictEqual(j.usage.remaining, 1 - i); }
  const r = await gen(undefined, { 'x-rl-pro': '1' }); assert.strictEqual(r.status, 429);
  assert.strictEqual((await r.json()).signedIn, false);
  const me = await (await req('/api/me')).json(); assert.deepStrictEqual(me.usage, { used: 2, limit: 2, remaining: 0 });
});

test('limits: signed-in free 5/day, Pro unlimited with history + settings', async () => {
  const { cookie } = await signIn('free@example.com');
  for (let i = 0; i < 5; i++) assert.strictEqual((await gen(cookie)).status, 200);
  assert.strictEqual((await gen(cookie)).status, 429);
  assert.strictEqual((await req('/api/settings', { method: 'PUT', cookie, body: { businessName: 'X' } })).status, 403);
  const u = await store.getUserByEmail('free@example.com');
  await store.updateUser(u.id, { pro: true });
  for (let i = 0; i < 3; i++) assert.strictEqual((await gen(cookie)).status, 200);
  const me = await (await req('/api/me', { cookie })).json();
  assert.strictEqual(me.user.plan, 'pro'); assert.strictEqual(me.usage.remaining, null); assert.strictEqual(me.usage.used, 8);
  const s = await req('/api/settings', { method: 'PUT', cookie, body: { businessName: 'Desert Bloom Cafe', businessType: 'cafe', tone: 'upbeat', length: 'short' } });
  assert.strictEqual(s.status, 200);
  assert.strictEqual((await (await req('/api/me', { cookie })).json()).settings.businessName, 'Desert Bloom Cafe');
  await new Promise(r => setTimeout(r, 50));
  const h = await (await req('/api/replies', { cookie })).json();
  assert.strictEqual(h.replies.length, 3); assert.strictEqual(h.replies[0].replies.length, 3);
  assert.strictEqual((await req('/api/replies')).status, 401);
});

test('billing: checkout falls back to payment link with prefilled email when no price', async () => {
  const { cookie } = await signIn('buyer@example.com');
  const j = await (await req('/api/billing/checkout', { method: 'POST', cookie })).json();
  assert.match(j.url, /^https:\/\/buy\.stripe\.com\/fZu8wOa3qbcx3lz2Le7Zu02\?prefilled_email=buyer%40example\.com&client_reference_id=/);
  assert.strictEqual((await req('/api/billing/checkout', { method: 'POST' })).status, 401);
});

const hook = (event, secret = 'whsec_test123') => {
  const payload = JSON.stringify(event);
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return req('/api/stripe/webhook', { method: 'POST', body: payload, headers: { 'Stripe-Signature': sig, 'Content-Type': 'application/json' } });
};

test('webhook: signature verification and pro lifecycle', async () => {
  const u = await store.getUserByEmail('buyer@example.com');
  const ev = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1', client_reference_id: u.id, customer: 'cus_1', subscription: 'sub_1', customer_details: { email: 'buyer@example.com' } } } };
  assert.strictEqual((await hook(ev, 'whsec_wrong')).status, 400);
  assert.strictEqual((await req('/api/stripe/webhook', { method: 'POST', body: JSON.stringify(ev), headers: { 'Content-Type': 'application/json' } })).status, 400);
  assert.strictEqual((await store.getUserById(u.id)).pro, false);
  assert.strictEqual((await hook(ev)).status, 200);
  let x = await store.getUserById(u.id);
  assert.strictEqual(x.pro, true); assert.strictEqual(x.stripe_customer_id, 'cus_1');
  assert.strictEqual(mail.sent.filter(m => m.to === 'buyer@example.com' && /Pro/.test(m.subject)).length, 1);
  // past_due keeps pro, unpaid removes
  await hook({ id: 'evt_2', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'past_due', metadata: {} } } });
  assert.strictEqual((await store.getUserById(u.id)).pro, true);
  await hook({ id: 'evt_3', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'unpaid', metadata: {} } } });
  assert.strictEqual((await store.getUserById(u.id)).pro, false);
  await hook({ id: 'evt_4', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: {} } } });
  assert.strictEqual((await store.getUserById(u.id)).pro, true);
  assert.strictEqual(mail.sent.filter(m => m.to === 'buyer@example.com' && /Pro/.test(m.subject)).length, 1, 'pro welcome only once');
  await hook({ id: 'evt_5', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', metadata: {} } } });
  x = await store.getUserById(u.id); assert.strictEqual(x.pro, false); assert.strictEqual(x.subscription_status, 'canceled');
});

test('webhook: match by email (payment link, no client_reference_id) and by customer lookup', async () => {
  await signIn('linkbuyer@example.com');
  const r = await hook({ id: 'evt_6', type: 'checkout.session.completed', data: { object: { id: 'cs_2', customer: 'cus_2', subscription: 'sub_2', customer_details: { email: 'LinkBuyer@example.com' } } } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await store.getUserByEmail('linkbuyer@example.com')).pro, true);
  await signIn('bymail@example.com'); // no stripe_customer_id yet; resolved via mocked customers.retrieve
  await hook({ id: 'evt_7', type: 'customer.subscription.updated', data: { object: { id: 'sub_3', customer: 'cus_3', status: 'active', metadata: {} } } });
  const x = await store.getUserByEmail('bymail@example.com'); assert.strictEqual(x.pro, true); assert.strictEqual(x.stripe_customer_id, 'cus_3');
});

test('static routes and health', async () => {
  for (const p of ['/', '/account', '/privacy.html', '/app.js', '/account.js']) assert.strictEqual((await req(p)).status, 200, p);
  const h = await (await req('/healthz')).json(); assert.strictEqual(h.store, PG ? 'postgres' : 'file');
  const idx = await (await req('/')).text(); assert.ok(!idx.includes('x-rl-pro') && !/X-RL-Pro/.test(await (await req('/app.js')).text()));
  assert.ok(!(await (await req('/app.js')).text()).includes('rr_pro'));
});

test('grader: validates input and returns score + tips', async () => {
  const bad = await req('/api/grade', { method: 'POST', body: { review: 'x' } });
  assert.strictEqual(bad.status, 400);
  const r = await req('/api/grade', { method: 'POST', body: { rating: 1, review: 'The technician was late and rude.', reply: 'Thanks.' } });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.source, 'heuristic'); assert.ok(j.score >= 0 && j.score <= 100); assert.ok(j.tips.length > 0);
  const good = await (await req('/api/grade', { method: 'POST', body: { rating: 1, review: 'The technician was late and rude.', reply: 'Thank you for telling us, and I am sorry our technician arrived late and was rude. That is not how we treat customers. Please call me at (555) 123-4567 so I can make this right. – Dana, Owner' } })).json();
  assert.ok(good.score > j.score);
});

test('new SEO and tool pages load', async () => {
  for (const p of ['/dentist-review-response-examples.html', '/contractor-review-response-examples.html', '/auto-repair-review-response-examples.html', '/salon-spa-review-response-examples.html', '/pet-grooming-review-response-examples.html', '/review-response-grader.html']) {
    const r = await req(p); assert.strictEqual(r.status, 200, p); assert.match(await r.text(), /ReviewLoom AI/);
  }
});

test('admin outreach: auth, dry run, cap, send', async () => {
  const items = [{ to: 'a@example.com', subject: 'Hi', body: 'Hello there' }, { to: 'b@example.com', subject: 'Yo', body: 'Second' }];
  const post = (q, headers, body = items) => req('/admin/outreach' + q, { method: 'POST', headers, body });
  delete process.env.ADMIN_TOKEN;
  assert.strictEqual((await post('', { Authorization: 'Bearer x' })).status, 404);
  process.env.ADMIN_TOKEN = 'tok-' + 'a'.repeat(40);
  process.env.OUTREACH_DELAY_MS = '5';
  const auth = { Authorization: 'Bearer ' + process.env.ADMIN_TOKEN };
  assert.strictEqual((await post('', {})).status, 401);
  assert.strictEqual((await post('', { Authorization: 'Bearer wrong' })).status, 401);
  const before = mail.sent.length;
  let r = await post('', auth); assert.strictEqual(r.status, 200);
  let j = await r.json();
  assert.strictEqual(j.dryRun, true); assert.strictEqual(j.previews.length, 2);
  assert.strictEqual(j.previews[0].from, 'Brad at ReviewLoom AI <hello@reviewloomai.com>');
  assert.strictEqual(j.previews[0].replyTo, 'hello@reviewloomai.com');
  assert.strictEqual(mail.sent.length, before);
  assert.strictEqual((await post('', auth, Array(21).fill(items[0]))).status, 400);
  assert.strictEqual((await post('', auth, [{ to: 'bad', subject: 's', body: 'b' }])).status, 400);
  assert.strictEqual((await post('', auth, { to: 'a@example.com' })).status, 400);
  r = await post('?send=true', auth); j = await r.json();
  assert.strictEqual(j.dryRun, false); assert.strictEqual(j.results.length, 2);
  assert.ok(j.results.every(x => x.ok));
  const last = mail.sent.slice(-2);
  assert.deepStrictEqual(last.map(x => x.to), ['a@example.com', 'b@example.com']);
  assert.strictEqual(last[0].replyTo, 'hello@reviewloomai.com');
  delete process.env.ADMIN_TOKEN;
});
