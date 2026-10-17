# ReviewLoom AI (MVP), by Bold Forge, LLC
https://reviewloomai.com
AI Google review-reply generator. Node 20 + Express, static frontend.
## Run
    npm install && npm start          # http://127.0.0.1:3456  (PORT env to change)
    XAI_API_KEY=... npm start         # uses xAI (grok-3-mini, override with LLM_MODEL)
    OPENAI_API_KEY=... npm start      # uses OpenAI (gpt-4o-mini; OPENAI_BASE_URL for any compatible API)
No key means the built-in template generator is used (lib/templates.js). If the LLM call fails, the app falls back to templates.
## API
POST /api/generate {review, rating?, businessName?, businessType?, tone, length} -> {source, replies[3], usage}
POST /api/subscribe {email} -> Buttondown, else data/subscribers.json
POST /api/auth/request {email} -> emails a single-use 15-minute magic link
GET  /auth/verify?token=... -> sets 30-day signed httpOnly session cookie, redirects to /account
POST /api/auth/logout · GET /api/me -> {user, usage:{used,limit,remaining}, settings}
PUT  /api/settings {businessName, businessType, tone, length} (Pro) · GET /api/replies (last 20, Pro)
POST /api/billing/checkout -> {url} · POST /api/billing/portal -> {url}
POST /api/stripe/webhook (Stripe-signed, raw body)
GET /healthz
## Newsletter
Set BUTTONDOWN_API_KEY to send signups to Buttondown (tag "reviewloom"). Without it, or if Buttondown fails, signups go to data/subscribers.json.
## Plans and limits (server is the source of truth)
- Anonymous: 2 replies per UTC day per IP (ANON_DAILY_LIMIT)
- Free account: 5 replies per UTC day per account (FREE_DAILY_LIMIT)
- Pro: unlimited, saved business profile, reply history (last 20 shown on /account)
Usage counters live in the store, so they survive restarts.

## Storage
DATABASE_URL set -> Postgres (tables users, login_tokens, usage, replies, settings auto-created on startup).
Otherwise a JSON file at data/store.json (STORE_FILE to override) for local dev. Login tokens are stored as SHA-256 hashes.

## Tests
    npm test                                              # JSON store, dev-mode email, mocked Stripe signatures
    TEST_DATABASE_URL=postgres://... npm test             # same suite against Postgres (TRUNCATES the tables, use a throwaway DB)

## Environment variables
| Var | Required in prod | What it is |
|---|---|---|
| SESSION_SECRET | yes | Long random string (e.g. `openssl rand -hex 32`) used to sign session cookies. If unset a random one is used and everyone is logged out on restart. |
| DATABASE_URL | yes | Postgres connection string (Render Postgres internal URL). Unset = JSON file, which is wiped on every Render deploy. |
| RESEND_API_KEY | yes | Resend API key for magic links + welcome emails. Unset = links are printed to the server log (dev mode). |
| MAIL_FROM | no | Sender, default `ReviewLoom AI <hello@reviewloomai.com>`. Domain must be verified in Resend. |
| STRIPE_SECRET_KEY | yes | Stripe secret key (sk_live_...). Needed for Checkout Sessions, the customer portal, and customer email lookup. |
| STRIPE_PRICE_ID | recommended | Price ID (price_...) of the $9/mo Pro price. Unset = checkout falls back to the payment link with ?prefilled_email=&client_reference_id=. |
| STRIPE_WEBHOOK_SECRET | yes | Signing secret (whsec_...) of the webhook endpoint below. Unset = webhook returns 503 and nobody becomes Pro. |
| STRIPE_PAYMENT_LINK | no | Override the fallback payment link URL. |
| APP_URL | no | Base URL for links/redirects, default https://reviewloomai.com in production. |
| XAI_API_KEY / OPENAI_API_KEY, LLM_MODEL, OPENAI_BASE_URL | no | LLM provider (unchanged). |
| BUTTONDOWN_API_KEY | no | Newsletter (unchanged). |
| ANON_DAILY_LIMIT / FREE_DAILY_LIMIT | no | Defaults 2 / 5. |
| TRUST_PROXY | no | Auto-enabled on Render (RENDER env). Set to 1 behind another proxy. |
| COOKIE_SECURE | no | Cookie gets `Secure` in production (RENDER or NODE_ENV=production); set 1/0 to force. |

## Stripe setup
Webhook endpoint: `https://reviewloomai.com/api/stripe/webhook`
Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
Enable the Customer Portal in Stripe (Settings > Billing > Customer portal) so "Manage billing" works.
Users are matched by client_reference_id (user id), then subscription metadata.user_id, then stripe_customer_id, then email.
## Before launch
Domain is set to https://reviewloomai.com. Point DNS + HTTPS at the host.
