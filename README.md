# ReviewLoom AI (MVP), by Bold Forge, LLC
https://reviewloomai.com
AI Google review-reply generator. Node 20 + Express, static frontend.
## Run
    npm install && npm start          # http://127.0.0.1:3456  (PORT env to change)
    XAI_API_KEY=... npm start         # uses xAI (grok-3-mini, override with LLM_MODEL)
    OPENAI_API_KEY=... npm start      # uses OpenAI (gpt-4o-mini; OPENAI_BASE_URL for any compatible API)
No key means the built-in template generator is used (lib/templates.js). If the LLM call fails, the app falls back to templates.
## API
POST /api/generate {review, rating?, businessName?, businessType?, tone, length} -> {source, replies[3]}
POST /api/subscribe {email} -> saved to data/subscribers.json
GET /healthz
## Newsletter
Set BUTTONDOWN_API_KEY to send signups to Buttondown (tag "reviewloom"). Without it, or if Buttondown fails, signups go to data/subscribers.json.
## Rate limit
Server enforces 5 /api/generate calls per IP per UTC day (in-memory; resets on restart). FREE_DAILY_LIMIT env overrides. Behind a proxy, set TRUST_PROXY=1.
## Before launch
Domain is set to https://reviewloomai.com. Point DNS + HTTPS at the host.
