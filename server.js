const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generateTemplates } = require('./lib/templates');
const { createStore } = require('./lib/store');
const mail = require('./lib/mail');

const PROD = !!(process.env.RENDER || process.env.NODE_ENV === 'production');
const ANON_LIMIT = Number(process.env.ANON_DAILY_LIMIT) || 2;
const FREE_LIMIT = Number(process.env.FREE_DAILY_LIMIT) || 5;
const PAYMENT_LINK = process.env.STRIPE_PAYMENT_LINK || 'https://buy.stripe.com/fZu8wOa3qbcx3lz2Le7Zu02';
const SITE = 'https://reviewloomai.com';
const COOKIE = 'rl_session', SESSION_DAYS = 30, TOKEN_MIN = 15;
const PRO_STATUSES = ['active', 'trialing', 'past_due'];
const TONES = ['warm', 'professional', 'upbeat', 'apologetic'];
const LENGTHS = ['short', 'medium', 'long'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SUBS = path.join(__dirname, 'data', 'subscribers.json');

const today = () => new Date().toISOString().slice(0, 10);
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const cleanEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => EMAIL_RE.test(e) && e.length <= 254;

let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString('hex');
  console[PROD ? 'error' : 'warn']('SESSION_SECRET not set: using a random secret, sessions reset on restart.');
}

// ---- signed session cookie: <userId>.<expiresMs>.<hmac> ----
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
function makeSession(userId) { const v = `${userId}.${Date.now() + SESSION_DAYS * 864e5}`; return `${v}.${sign(v)}`; }
function readSession(raw) {
  if (!raw) return null;
  const i = raw.lastIndexOf('.'); if (i < 0) return null;
  const v = raw.slice(0, i), mac = raw.slice(i + 1), good = sign(v);
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  const [userId, exp] = v.split('.');
  return Number(exp) > Date.now() ? userId : null;
}
function getCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const j = part.indexOf('='); if (j < 0) continue;
    if (part.slice(0, j).trim() === name) { try { return decodeURIComponent(part.slice(j + 1).trim()); } catch { return null; } }
  }
  return null;
}
const cookieOpts = () => ({ httpOnly: true, secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE !== '0' : PROD, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 864e5 });

// ---- tiny in-memory throttle for sign-in emails (abuse guard) ----
const throttle = new Map();
function allow(key, max, windowMs) {
  const t = Date.now(), arr = (throttle.get(key) || []).filter(x => t - x < windowMs);
  if (throttle.size > 20000) throttle.clear();
  if (arr.length >= max) { throttle.set(key, arr); return false; }
  arr.push(t); throttle.set(key, arr); return true;
}

async function llmReplies(o) {
  let key, base, model;
  if (process.env.XAI_API_KEY) { key = process.env.XAI_API_KEY; base = 'https://api.x.ai/v1'; model = process.env.LLM_MODEL || 'grok-3-mini'; }
  else if (process.env.OPENAI_API_KEY) { key = process.env.OPENAI_API_KEY; base = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'; model = process.env.LLM_MODEL || 'gpt-4o-mini'; }
  else return null;
  const prompt = `Write 3 distinct reply options to this Google review on behalf of the business owner.
Business: ${o.businessName || 'our business'} (${o.businessType || 'small business'}). Star rating: ${o.rating || 'unknown'}. Tone: ${o.tone}. Length: ${o.length} (short=1-2 sentences, medium=3-4, long=5-6).
Rules: sound human, reference specifics from the review, never invent facts or offer discounts, no hashtags or emojis. For negative reviews, apologize, take ownership, and invite them to continue offline.
Return ONLY a JSON array of 3 strings.
Review: """${o.review}"""`;
  const r = await fetch(base + '/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model, temperature: 0.8, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(20000)
  });
  if (!r.ok) throw new Error('LLM HTTP ' + r.status);
  const j = await r.json();
  const txt = j.choices[0].message.content.replace(/```json|```/g, '').trim();
  const arr = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1));
  return arr.filter(s => typeof s === 'string').slice(0, 3);
}

function saveLocal(email) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(SUBS, 'utf8')); } catch {}
  if (!list.some(s => s.email === email)) { list.push({ email, at: new Date().toISOString() }); fs.writeFileSync(SUBS, JSON.stringify(list, null, 2)); }
}

// Returns true on success (incl. already subscribed); throws on failure. Never logs the key.
async function buttondownSubscribe(email, ip) {
  const r = await fetch('https://api.buttondown.com/v1/subscribers', {
    method: 'POST',
    headers: {
      'Authorization': 'Token ' + process.env.BUTTONDOWN_API_KEY,
      'Content-Type': 'application/json',
      'X-Buttondown-Collision-Behavior': 'add', // merge tags instead of 400 for existing subscribers
    },
    body: JSON.stringify({ email_address: email, tags: ['reviewloom'], ...(ip ? { ip_address: ip } : {}) }),
    signal: AbortSignal.timeout(10000),
  });
  if (r.ok) return true;
  const text = (await r.text().catch(() => '')).slice(0, 500);
  if (r.status === 400 && /already|exists|duplicate/i.test(text)) return true;
  throw new Error(`Buttondown HTTP ${r.status}: ${text}`);
}

function createApp({ store, stripe } = {}) {
  store = store || createStore();
  if (stripe === undefined && process.env.STRIPE_SECRET_KEY) stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const app = express();
  app.locals.store = store;
  fs.mkdirSync(path.dirname(SUBS), { recursive: true });
  if (process.env.TRUST_PROXY || process.env.RENDER) app.set('trust proxy', 1); // Render sits behind one proxy; needed for per-IP limits
  const baseUrl = req => (process.env.APP_URL || (PROD ? SITE : `${req.protocol}://${req.get('host')}`)).replace(/\/$/, '');
  const wrapA = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  function limitFor(user) { return !user ? ANON_LIMIT : user.pro ? Infinity : FREE_LIMIT; }
  const subjectFor = (req, user) => (user ? 'user:' + user.id : 'ip:' + req.ip);
  async function usageInfo(req, user) {
    const used = await store.getUsage(subjectFor(req, user), today()), limit = limitFor(user);
    return { used, limit: Number.isFinite(limit) ? limit : null, remaining: Number.isFinite(limit) ? Math.max(0, limit - used) : null };
  }
  const publicUser = u => u && { id: u.id, email: u.email, pro: !!u.pro, plan: u.pro ? 'pro' : 'free', subscription_status: u.subscription_status || null, has_billing: !!u.stripe_customer_id };

  async function setPro(user, patch, base) {
    const before = !!user.pro;
    const u = await store.updateUser(user.id, patch);
    if (u && u.pro && !before && !u.pro_welcomed) {
      await store.updateUser(u.id, { pro_welcomed: true });
      mail.welcomePro(u.email, base).catch(e => console.error('Pro welcome email failed:', e.message));
    }
    return u;
  }

  // ---- Stripe webhook: needs the raw body, so it is registered before express.json ----
  app.post('/api/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), wrapA(async (req, res) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ error: 'Webhook not configured' });
    let event;
    try {
      const verifier = stripe || require('stripe')('sk_unused');
      event = verifier.webhooks.constructEvent(req.body, req.get('stripe-signature') || '', secret);
    } catch (e) { return res.status(400).json({ error: 'Invalid signature' }); }
    const base = process.env.APP_URL || SITE;
    const o = event.data.object;
    if (event.type === 'checkout.session.completed') {
      let user = o.client_reference_id ? await store.getUserById(o.client_reference_id) : null;
      const email = cleanEmail((o.customer_details && o.customer_details.email) || o.customer_email);
      if (!user && email) user = await store.getUserByEmail(email);
      if (!user && email && validEmail(email)) user = await store.createUser(email); // paid before signing in: account waits for them
      if (user) await setPro(user, { pro: true, stripe_customer_id: o.customer || user.stripe_customer_id, stripe_subscription_id: o.subscription || user.stripe_subscription_id, subscription_status: 'active' }, base);
      else console.warn('Stripe checkout completed with no matching user:', o.id);
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const meta = o.metadata || {};
      let user = meta.user_id ? await store.getUserById(meta.user_id) : null;
      if (!user && o.customer) user = await store.getUserByCustomer(o.customer);
      if (!user && o.customer && stripe) {
        try { const c = await stripe.customers.retrieve(o.customer); if (c && c.email) user = await store.getUserByEmail(cleanEmail(c.email)); } catch (e) { console.error('Stripe customer lookup failed:', e.message); }
      }
      if (user) {
        const status = event.type === 'customer.subscription.deleted' ? 'canceled' : o.status;
        await setPro(user, { pro: PRO_STATUSES.includes(status), subscription_status: status, stripe_customer_id: o.customer || user.stripe_customer_id, stripe_subscription_id: o.id }, base);
      } else console.warn('Stripe subscription event with no matching user:', o.id);
    }
    res.json({ received: true });
  }));

  app.use(express.json({ limit: '20kb' }));
  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

  // Attach req.user from session cookie
  app.use(wrapA(async (req, res, next) => {
    const id = readSession(getCookie(req, COOKIE));
    req.user = id ? (await store.getUserById(id)) || null : null;
    next();
  }));
  const needUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Please sign in.' }));

  // ---- auth ----
  app.post('/api/auth/request', wrapA(async (req, res) => {
    const email = cleanEmail((req.body || {}).email);
    if (!validEmail(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
    if (!allow('e:' + email, 5, 15 * 6e4) || !allow('i:' + req.ip, 20, 36e5)) return res.status(429).json({ error: 'Too many sign-in requests. Please wait a few minutes and try again.' });
    const token = crypto.randomBytes(32).toString('base64url');
    await store.saveToken(sha256(token), email, new Date(Date.now() + TOKEN_MIN * 6e4));
    const link = `${baseUrl(req)}/auth/verify?token=${token}`;
    try { await mail.magicLink(email, link); }
    catch (e) { console.error('Magic link email failed:', e.message); return res.status(502).json({ error: 'Could not send the email right now. Please try again.' }); }
    store.pruneTokens().catch(() => {});
    res.json({ ok: true });
  }));

  app.get('/auth/verify', wrapA(async (req, res) => {
    const token = String(req.query.token || '');
    const email = token ? await store.consumeToken(sha256(token)) : null;
    if (!email) return res.redirect('/account?error=link');
    let user = await store.getUserByEmail(email);
    if (!user) user = await store.createUser(email);
    user = await store.updateUser(user.id, { last_login_at: new Date().toISOString() });
    if (!user.welcomed) {
      await store.updateUser(user.id, { welcomed: true });
      mail.welcome(email, baseUrl(req)).catch(e => console.error('Welcome email failed:', e.message));
    }
    res.cookie(COOKIE, makeSession(user.id), cookieOpts());
    res.redirect('/account');
  }));

  app.post('/api/auth/logout', (req, res) => { const { maxAge, ...o } = cookieOpts(); res.clearCookie(COOKIE, o); res.json({ ok: true }); });

  app.get('/api/me', wrapA(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const settings = req.user && req.user.pro ? await store.getSettings(req.user.id) : null;
    res.json({ user: publicUser(req.user), usage: await usageInfo(req, req.user), settings });
  }));

  app.put('/api/settings', needUser, wrapA(async (req, res) => {
    if (!req.user.pro) return res.status(403).json({ error: 'Saved business profile is a Pro feature.' });
    const b = req.body || {};
    const s = {
      businessName: String(b.businessName || '').slice(0, 80).trim(),
      businessType: String(b.businessType || '').slice(0, 60).trim(),
      tone: TONES.includes(b.tone) ? b.tone : 'warm',
      length: LENGTHS.includes(b.length) ? b.length : 'medium',
    };
    await store.saveSettings(req.user.id, s);
    res.json({ ok: true, settings: s });
  }));

  app.get('/api/replies', needUser, wrapA(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ replies: await store.listReplies(req.user.id, 20) });
  }));

  // ---- generate ----
  app.post('/api/generate', wrapA(async (req, res) => {
    const b = req.body || {};
    const review = String(b.review || '').trim().slice(0, 3000);
    if (review.length < 3) return res.status(400).json({ error: 'Please paste a review.' });
    const user = req.user, limit = limitFor(user);
    const n = await store.incrUsage(subjectFor(req, user), today(), limit);
    const usage = n === null ? { used: limit, limit, remaining: 0 } : { used: n, limit: Number.isFinite(limit) ? limit : null, remaining: Number.isFinite(limit) ? Math.max(0, limit - n) : null };
    if (Number.isFinite(limit)) { res.set('X-RateLimit-Limit', String(limit)); res.set('X-RateLimit-Remaining', String(usage.remaining)); }
    if (n === null) {
      const error = user
        ? `You have used your ${limit} free replies today. Go Pro for unlimited replies.`
        : `You have used your ${limit} free replies today. Create a free account for ${FREE_LIMIT} a day, or go Pro for unlimited.`;
      return res.status(429).json({ error, usage, signedIn: !!user });
    }
    const o = {
      review,
      rating: [1, 2, 3, 4, 5].includes(Number(b.rating)) ? Number(b.rating) : null,
      businessName: String(b.businessName || '').slice(0, 80).trim(),
      businessType: String(b.businessType || '').slice(0, 60).trim(),
      tone: TONES.includes(b.tone) ? b.tone : 'warm',
      length: LENGTHS.includes(b.length) ? b.length : 'medium',
    };
    let out = null;
    try { const r = await llmReplies(o); if (r && r.length) out = { source: 'llm', replies: r }; }
    catch (e) { console.error('LLM failed, falling back:', e.message); }
    if (!out) out = { source: 'template', ...generateTemplates(o) };
    if (user && user.pro) store.addReply(user.id, { review, rating: o.rating, tone: o.tone, length: o.length, replies: out.replies }).catch(e => console.error('Save reply failed:', e.message));
    res.json({ ...out, usage });
  }));

  // ---- billing ----
  app.post('/api/billing/checkout', needUser, wrapA(async (req, res) => {
    const u = req.user;
    if (u.pro) return res.json({ url: '/account' });
    if (!stripe || !process.env.STRIPE_PRICE_ID) {
      const url = `${PAYMENT_LINK}?prefilled_email=${encodeURIComponent(u.email)}&client_reference_id=${encodeURIComponent(u.id)}`;
      return res.json({ url });
    }
    const base = process.env.APP_URL || SITE;
    const s = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      ...(u.stripe_customer_id ? { customer: u.stripe_customer_id } : { customer_email: u.email }),
      client_reference_id: u.id,
      subscription_data: { metadata: { user_id: u.id } },
      allow_promotion_codes: true,
      success_url: `${base}/account?welcome=1`,
      cancel_url: `${base}/#pricing`,
    });
    res.json({ url: s.url });
  }));

  app.post('/api/billing/portal', needUser, wrapA(async (req, res) => {
    if (!stripe) return res.status(503).json({ error: 'Billing is not configured yet. Email us and we will help.' });
    if (!req.user.stripe_customer_id) return res.status(400).json({ error: 'No billing account yet.' });
    const s = await stripe.billingPortal.sessions.create({ customer: req.user.stripe_customer_id, return_url: `${process.env.APP_URL || SITE}/account` });
    res.json({ url: s.url });
  }));

  // ---- newsletter ----
  app.post('/api/subscribe', async (req, res) => {
    const email = cleanEmail((req.body || {}).email);
    if (!validEmail(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
    if (process.env.BUTTONDOWN_API_KEY) {
      try { await buttondownSubscribe(email, req.ip); return res.json({ ok: true }); }
      catch (e) { console.error('Buttondown subscribe failed, saving locally:', e.message); }
    }
    try { saveLocal(email); } catch (e) { console.error('Local subscriber save failed:', e.message); return res.status(500).json({ error: 'Could not subscribe right now. Please try again.' }); }
    res.json({ ok: true });
  });

  app.get('/healthz', (_, res) => res.json({ ok: true, llm: !!(process.env.XAI_API_KEY || process.env.OPENAI_API_KEY), store: store.kind }));

  app.use((err, req, res, next) => { console.error('Error:', err.message); if (res.headersSent) return next(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); });
  return app;
}

if (require.main === module) {
  const PORT = process.env.PORT || 3456;
  const HOST = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
  const store = createStore();
  store.init().then(() => {
    createApp({ store }).listen(PORT, HOST, () => console.log(`ReviewLoom AI on http://${HOST}:${PORT} (store: ${store.kind})`));
  }).catch(e => { console.error('Store init failed:', e.message); process.exit(1); });
}

module.exports = { createApp };
