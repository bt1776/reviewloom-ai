// Storage layer: Postgres when DATABASE_URL is set, else a JSON file under data/ (local dev).
// All methods are async so both backends share one interface.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const newId = () => crypto.randomUUID();
const now = () => new Date().toISOString();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, pro BOOLEAN NOT NULL DEFAULT FALSE,
  stripe_customer_id TEXT, stripe_subscription_id TEXT, subscription_status TEXT,
  welcomed BOOLEAN NOT NULL DEFAULT FALSE, pro_welcomed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_login_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS usage (
  subject TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (subject, day));
CREATE TABLE IF NOT EXISTS replies (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  review TEXT NOT NULL, rating INTEGER, tone TEXT, length TEXT, replies JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS replies_user_idx ON replies (user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  business_name TEXT, business_type TEXT, tone TEXT, length TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
`;

const USER_FIELDS = ['pro', 'stripe_customer_id', 'stripe_subscription_id', 'subscription_status', 'welcomed', 'pro_welcomed', 'last_login_at'];
const iso = v => (v instanceof Date ? v.toISOString() : v);
const normUser = u => u && { ...u, created_at: iso(u.created_at), last_login_at: iso(u.last_login_at) };

function pgStore(url) {
  const { Pool } = require('pg');
  const ssl = /localhost|127\.0\.0\.1/.test(url) || process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: url, ssl, max: 5 });
  const q = (sql, p) => pool.query(sql, p);
  return {
    kind: 'postgres',
    async init() { await q(SCHEMA); },
    async getUserById(id) { return normUser((await q('SELECT * FROM users WHERE id=$1', [id])).rows[0]); },
    async getUserByEmail(e) { return normUser((await q('SELECT * FROM users WHERE email=$1', [e])).rows[0]); },
    async getUserByCustomer(c) { return normUser((await q('SELECT * FROM users WHERE stripe_customer_id=$1', [c])).rows[0]); },
    async createUser(email) {
      const r = await q('INSERT INTO users (id,email) VALUES ($1,$2) ON CONFLICT (email) DO NOTHING RETURNING *', [newId(), email]);
      return normUser(r.rows[0]) || this.getUserByEmail(email);
    },
    async updateUser(id, patch) {
      const keys = Object.keys(patch).filter(k => USER_FIELDS.includes(k));
      if (!keys.length) return this.getUserById(id);
      const r = await q(`UPDATE users SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1 RETURNING *`, [id, ...keys.map(k => patch[k])]);
      return normUser(r.rows[0]);
    },
    async saveToken(hash, email, expiresAt) { await q('INSERT INTO login_tokens (token_hash,email,expires_at) VALUES ($1,$2,$3)', [hash, email, expiresAt]); },
    // Atomically marks a token used; returns email if valid, unused, unexpired.
    async consumeToken(hash) {
      const r = await q('UPDATE login_tokens SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() RETURNING email', [hash]);
      return r.rows[0] ? r.rows[0].email : null;
    },
    async pruneTokens() { await q("DELETE FROM login_tokens WHERE expires_at < now() - interval '1 day'"); },
    async getUsage(subject, day) { const r = await q('SELECT count FROM usage WHERE subject=$1 AND day=$2', [subject, day]); return r.rows[0] ? r.rows[0].count : 0; },
    // Increments only if below limit (limit=Infinity for unlimited). Returns new count or null if over.
    async incrUsage(subject, day, limit) {
      const lim = Number.isFinite(limit) ? limit : 2147483647;
      const r = await q(`INSERT INTO usage (subject,day,count) VALUES ($1,$2,1)
        ON CONFLICT (subject,day) DO UPDATE SET count=usage.count+1 WHERE usage.count < $3 RETURNING count`, [subject, day, lim]);
      if (!r.rows[0]) return null;
      return r.rows[0].count > lim ? null : r.rows[0].count;
    },
    async addReply(userId, rec) {
      await q('INSERT INTO replies (id,user_id,review,rating,tone,length,replies) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [newId(), userId, rec.review, rec.rating, rec.tone, rec.length, JSON.stringify(rec.replies)]);
    },
    async listReplies(userId, n = 20) {
      const r = await q('SELECT id,review,rating,tone,length,replies,created_at FROM replies WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2', [userId, n]);
      return r.rows.map(x => ({ ...x, created_at: iso(x.created_at) }));
    },
    async getSettings(userId) {
      const r = (await q('SELECT business_name,business_type,tone,length FROM settings WHERE user_id=$1', [userId])).rows[0];
      return r ? { businessName: r.business_name || '', businessType: r.business_type || '', tone: r.tone || '', length: r.length || '' } : null;
    },
    async saveSettings(userId, s) {
      await q(`INSERT INTO settings (user_id,business_name,business_type,tone,length,updated_at) VALUES ($1,$2,$3,$4,$5,now())
        ON CONFLICT (user_id) DO UPDATE SET business_name=$2,business_type=$3,tone=$4,length=$5,updated_at=now()`,
        [userId, s.businessName, s.businessType, s.tone, s.length]);
    },
    async close() { await pool.end(); },
  };
}

function fileStore(file) {
  let db = { users: [], login_tokens: [], usage: {}, replies: [], settings: {} };
  const load = () => { try { db = { ...db, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {} };
  const save = () => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db, null, 2)); fs.renameSync(tmp, file); };
  const clone = o => (o ? JSON.parse(JSON.stringify(o)) : o);
  return {
    kind: 'file',
    async init() { fs.mkdirSync(path.dirname(file), { recursive: true }); load(); save(); },
    async getUserById(id) { return clone(db.users.find(u => u.id === id)); },
    async getUserByEmail(e) { return clone(db.users.find(u => u.email === e)); },
    async getUserByCustomer(c) { return clone(db.users.find(u => c && u.stripe_customer_id === c)); },
    async createUser(email) {
      let u = db.users.find(x => x.email === email);
      if (!u) { u = { id: newId(), email, pro: false, stripe_customer_id: null, stripe_subscription_id: null, subscription_status: null, welcomed: false, pro_welcomed: false, created_at: now(), last_login_at: null }; db.users.push(u); save(); }
      return clone(u);
    },
    async updateUser(id, patch) {
      const u = db.users.find(x => x.id === id); if (!u) return null;
      for (const k of Object.keys(patch)) if (USER_FIELDS.includes(k)) u[k] = patch[k];
      save(); return clone(u);
    },
    async saveToken(hash, email, expiresAt) { db.login_tokens.push({ token_hash: hash, email, expires_at: iso(expiresAt), used_at: null, created_at: now() }); save(); },
    async consumeToken(hash) {
      const t = db.login_tokens.find(x => x.token_hash === hash);
      if (!t || t.used_at || new Date(t.expires_at) <= new Date()) return null;
      t.used_at = now(); save(); return t.email;
    },
    async pruneTokens() { const cut = Date.now() - 86400000; db.login_tokens = db.login_tokens.filter(t => new Date(t.expires_at).getTime() > cut); save(); },
    async getUsage(subject, day) { return db.usage[subject + '|' + day] || 0; },
    async incrUsage(subject, day, limit) {
      const k = subject + '|' + day, n = db.usage[k] || 0;
      if (n >= limit) return null;
      db.usage[k] = n + 1;
      for (const key of Object.keys(db.usage)) if (!key.endsWith('|' + day)) delete db.usage[key]; // keep file small
      save(); return n + 1;
    },
    async addReply(userId, rec) {
      db.replies.push({ id: newId(), user_id: userId, ...rec, created_at: now() });
      const mine = db.replies.filter(r => r.user_id === userId);
      if (mine.length > 100) { const drop = new Set(mine.slice(0, mine.length - 100).map(r => r.id)); db.replies = db.replies.filter(r => !drop.has(r.id)); }
      save();
    },
    async listReplies(userId, n = 20) {
      return clone(db.replies.filter(r => r.user_id === userId).slice(-n).reverse().map(({ user_id, ...r }) => r));
    },
    async getSettings(userId) { return clone(db.settings[userId] || null); },
    async saveSettings(userId, s) { db.settings[userId] = { ...s }; save(); },
    async close() {},
  };
}

function createStore(opts = {}) {
  const url = opts.databaseUrl !== undefined ? opts.databaseUrl : process.env.DATABASE_URL;
  if (url) return pgStore(url);
  return fileStore(opts.file || process.env.STORE_FILE || path.join(__dirname, '..', 'data', 'store.json'));
}

module.exports = { createStore };
