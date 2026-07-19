# Think Tank (personal + entity) — setup

Think Tank is a **Grok (xAI) journal coach** available to users across Tage platforms — not limited to portfolio COOs.

| Platform | Who | Where | Thread model |
|----------|-----|-------|--------------|
| **Tage Portal** | Every logged-in sales user | Global nav → **Think Tank** (`/sales/think-tank`) | **Personal** — one journal per user |
| **Tage Portal** | Users assigned to a portfolio entity | Manage Portfolio → entity → **Think Tank** | **Entity** — one journal per user per entity |
| **My Recruiting Desk** | Every recruiter / manager / leadership user | Grow → **Think Tank** (`/think-tank`) | **Personal** — one journal per Desk user (role-aware prompt) |

Owner oversight emails (Josh) can fire on assistant replies from **both** platforms. They are **never** shown in the user UI.

---

## Required: `XAI_API_KEY`

Chat does **not** work live until the xAI key is set:

| Surface | Where to set |
|---------|----------------|
| Tage Portal (edge `think-tank-chat` + morning digest) | Supabase → Project → Edge Functions → **Secrets** → `XAI_API_KEY` |
| My Recruiting Desk | `.env.local` / Vercel env → `XAI_API_KEY` (Think Tank prefers xAI even if `LLM_PROVIDER=openai`) |

Optional: `XAI_MODEL` (Tage default `grok-3-mini`; Desk default `grok-2-latest`).

**Josh has not set `XAI_API_KEY` on Supabase yet** — personal/entity Think Tank UI is local-ready, but Grok replies return 503 until the secret is added and `think-tank-chat` is deployed.

---

## Tage Portal

### Migration

```bash
# supabase/migrations/0042_portfolio_entity_shell.sql  # original entity tables
# supabase/migrations/0046_think_tank_personal.sql     # personal scope + RLS
supabase db push   # or run SQL in Dashboard
```

**Data model**

- `think_tank_conversations`
  - `scope = 'personal'` → `entity_id` NULL, unique per `user_id`
  - `scope = 'entity'` → `entity_id` set, unique per `(entity_id, user_id)`
- `think_tank_messages` — `user` / `assistant` / `system` rows

RLS: users only see **their own** threads; entity threads also require `user_has_entity`.

### Edge function

```bash
supabase functions deploy think-tank-chat
```

Request body:

```json
{ "scope": "personal", "message": "…" }
{ "scope": "entity", "entity_id": "<uuid>", "message": "…" }
{ "entity_id": "<uuid>", "mode": "financial_analysis", "period_type": "…", "period_key": "…", "snapshot": {} }
```

### Secrets

| Secret | Required | Notes |
|--------|----------|-------|
| `XAI_API_KEY` | **Yes for chat** | Server-side only |
| `XAI_MODEL` | No | Default `grok-3-mini` |
| `OWNER_OVERSIGHT_EMAIL` | Recommended | Josh’s inbox |
| `OWNER_OVERSIGHT_ENABLED` | No | Default on; `false` to disable |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | For oversight mail | |
| `INTAKE_ALERT_EMAIL` | Fallback recipient | If oversight email unset |

### Local

```bash
export PATH="/Users/joshmonroe/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/joshmonroe/Projects/tagevc-sales
npm run typecheck
npm run dev
# http://localhost:5173 → Think Tank (global) and/or Manage Portfolio → entity → Think Tank
```

Apply `0046` before personal journal persistence. Deploy edge function + set `XAI_API_KEY` for live Grok.

---

## My Recruiting Desk

Native Next.js + Prisma (does **not** call Tage Supabase auth). Reuses `src/lib/ai/llm.ts` with `prefer: "xai"`.

### Schema

```bash
cd "/Users/joshmonroe/Recruiting Tools"
npx prisma db push   # or migrate — adds ThinkTankConversation / ThinkTankMessage
npx prisma generate
```

- One `ThinkTankConversation` per Desk `User`
- Messages stored in Postgres
- System prompt band: `recruiter` | `manager` | `leadership` (from `User.role`)

### Env

```bash
XAI_API_KEY=…                 # preferred for Think Tank
# or OPENAI_API_KEY=…         # fallback
OWNER_OVERSIGHT_EMAIL=josh@…  # digest recipient
OWNER_OVERSIGHT_ENABLED=true
RESEND_API_KEY=…              # for oversight email
```

### Local

```bash
export PATH="/Users/joshmonroe/.nvm/versions/node/v24.18.0/bin:$PATH"
cd "/Users/joshmonroe/Recruiting Tools"
npm run typecheck
npm run dev
# http://localhost:3000/think-tank
```

---

## Owner oversight (all platforms)

On each assistant reply (chat mode), the server may email Josh:

- Subject: `[Think Tank oversight] <Platform> · <scope/role>`
- Body: author, journal note, Grok reply
- **Never** mentioned in the Think Tank UI

Configure the same `OWNER_OVERSIGHT_EMAIL` / `OWNER_OVERSIGHT_ENABLED` on Tage edge secrets and Desk env.

Periodic digest cron (vs on-save) remains **backlog**.

---

## Stubbed vs wired

| Feature | Status |
|---------|--------|
| Tage personal Think Tank (nav + page) | Wired (needs migration `0046` + `XAI_API_KEY`) |
| Tage entity Think Tank | Wired (needs `XAI_API_KEY`) |
| Desk Think Tank (all roles) | Wired (needs Prisma push + `XAI_API_KEY`) |
| Owner oversight email | Wired on both (needs Resend + oversight email) |
| Financial Grok analysis (entity) | Wired UI; numbers sync stubbed |
| Cross-platform periodic digest | Backlog |

**Do not production-deploy** until Josh asks. Local-ready only.
