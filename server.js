const express = require('express');
const fs = require('fs');
const path = require('path');
const { generateTemplates } = require('./lib/templates');
const app = express();
const PORT = process.env.PORT || 3456;
const DATA = path.join(__dirname, 'data', 'subscribers.json');
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
const LIMIT = Number(process.env.FREE_DAILY_LIMIT) || 5;
const hits = new Map();
function rateLimit(req, res, next) {
  const day = new Date().toISOString().slice(0, 10), k = req.ip + '|' + day;
  if (hits.size > 50000) for (const key of hits.keys()) if (!key.endsWith(day)) hits.delete(key);
  const n = (hits.get(k) || 0) + 1;
  res.set('X-RateLimit-Limit', String(LIMIT)); res.set('X-RateLimit-Remaining', String(Math.max(0, LIMIT - n)));
  if (n > LIMIT) return res.status(429).json({ error: `Free limit of ${LIMIT} replies per day reached. Pro (unlimited) is coming soon.` });
  hits.set(k, n); next();
}
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const TONES = ['warm', 'professional', 'upbeat', 'apologetic'];
const LENGTHS = ['short', 'medium', 'long'];

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

app.post('/api/generate', rateLimit, async (req, res) => {
  const b = req.body || {};
  const review = String(b.review || '').trim().slice(0, 3000);
  if (review.length < 3) return res.status(400).json({ error: 'Please paste a review.' });
  const o = {
    review,
    rating: [1,2,3,4,5].includes(Number(b.rating)) ? Number(b.rating) : null,
    businessName: String(b.businessName || '').slice(0, 80).trim(),
    businessType: String(b.businessType || '').slice(0, 60).trim(),
    tone: TONES.includes(b.tone) ? b.tone : 'warm',
    length: LENGTHS.includes(b.length) ? b.length : 'medium',
  };
  try {
    const r = await llmReplies(o);
    if (r && r.length) return res.json({ source: 'llm', replies: r });
  } catch (e) { console.error('LLM failed, falling back:', e.message); }
  res.json({ source: 'template', ...generateTemplates(o) });
});

function saveLocal(email) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch {}
  if (!list.some(s => s.email === email)) { list.push({ email, at: new Date().toISOString() }); fs.writeFileSync(DATA, JSON.stringify(list, null, 2)); }
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

app.post('/api/subscribe', async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Please enter a valid email.' });
  if (process.env.BUTTONDOWN_API_KEY) {
    try { await buttondownSubscribe(email, req.ip); return res.json({ ok: true }); }
    catch (e) { console.error('Buttondown subscribe failed, saving locally:', e.message); }
  }
  try { saveLocal(email); } catch (e) { console.error('Local subscriber save failed:', e.message); return res.status(500).json({ error: 'Could not subscribe right now. Please try again.' }); }
  res.json({ ok: true });
});

app.get('/healthz', (_, res) => res.json({ ok: true, llm: !!(process.env.XAI_API_KEY || process.env.OPENAI_API_KEY) }));
const HOST = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
app.listen(PORT, HOST, () => console.log('ReviewLoom AI on http://' + HOST + ':' + PORT));
