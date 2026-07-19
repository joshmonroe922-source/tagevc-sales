# Portfolio entity shell (Batch 2 sandbox)

Manage Portfolio entity pages for **every** portfolio company (Tage VC, Recruit 619, Signent HR, Instant NDA, + new subsidiaries):

| Tab | Path | Purpose |
|-----|------|---------|
| Overview | `/sales/ops/entities/:id` | Checklist, docs, linked deal |
| Leadership | `…/leadership` | Editable strategy + goals |
| Think Tank | `…/think-tank` | **Entity-scoped** journal + Grok coach (xAI API) |
| Financial | `…/financial` | Period views + Grok summary (sync stub) |
| KPIs | `…/kpis` | Entity-specific KPIs + values |
| Platform | `…/platform` | Operating platform links / SSO |

**Personal Think Tank** (every logged-in portal user) is global nav **Think Tank** → `/sales/think-tank`. Full setup (personal + Desk + oversight): **[SETUP_THINK_TANK.md](./SETUP_THINK_TANK.md)**.

**Recruiters / Managers** were removed from Manage Portfolio nav. They live in Recruiting Desk (`app.recruit619.com`), which has its own personal Think Tank. Legacy `/recruiters` and `/managers` routes redirect to **Platform**.

## Migration

```bash
# Apply locally / to staging when ready:
# supabase db push   OR run SQL in Dashboard
supabase/migrations/0042_portfolio_entity_shell.sql
supabase/migrations/0044_recruit619_kpi_hierarchy.sql  # Recruit 619 hierarchy dims + facts
supabase/migrations/0046_think_tank_personal.sql        # personal scope + RLS
```

Creates:

- `entity_leadership`
- `think_tank_conversations` / `think_tank_messages` (entity + personal scopes after `0046`)
- `entity_kpis` / `entity_kpi_values` / `entity_kpi_templates`
- `entity_financial_snapshots` (stub until reporting sync)
- Trigger `provision_portfolio_entity_shell` on `ops_entities` insert
- Seeds **Tage VC** (`tage-vc`) and normalizes Instant NDA name
- Backfills Leadership + default KPIs for existing entities

**0044 (Recruit 619):** `recruiting_regions`, `recruiting_locations`, `recruiting_org_members`, `recruiting_kpi_facts` + expanded KPI templates. See [docs/recruit619/KPI_HIERARCHY.md](docs/recruit619/KPI_HIERARCHY.md).

Existing finance/legal/HR/marketing/technology provision triggers still run on new entities.

## Edge function: Think Tank + Grok

Deploy when ready (Batch 2 deploy):

```bash
supabase functions deploy think-tank-chat
```

Supports `scope: "personal"` and `scope: "entity"` + `entity_id`. See **[SETUP_THINK_TANK.md](./SETUP_THINK_TANK.md)**.

### Secrets (Supabase → Edge Functions → Secrets)

| Secret | Required | Notes |
|--------|----------|-------|
| `XAI_API_KEY` | Yes for chat | xAI API key — **server-side only** — **Josh must set this** |
| `XAI_MODEL` | No | Default `grok-3-mini` |
| `OWNER_OVERSIGHT_EMAIL` | Recommended | Josh’s inbox for journal digests (personal + entity) |
| `OWNER_OVERSIGHT_ENABLED` | No | Default on; set `false` to disable |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | For oversight mail | Same as other portal email |
| `INTAKE_ALERT_EMAIL` | Fallback | Used if `OWNER_OVERSIGHT_EMAIL` unset |

**Owner oversight:** On each Think Tank assistant reply, the edge function may email Josh a summary + journal excerpt. This is **administrative oversight of company tools**. It is **not** shown in the Think Tank UI.

Grok is **API-backed chat in-app** (not an iframe of grok.x.ai). Raw embed of authenticated Grok threads is unreliable; the portal UI is the product surface.

## Frontend env (optional)

```bash
# .env.local / Vercel
VITE_INSTANT_NDA_SALES_URL=https://instantnda.us/sales/login
VITE_INSTANT_NDA_APP_URL=https://app.instantnda.us
VITE_SIGNENT_HR_URL=https://signenthr.com
VITE_TALENTDESK_ORIGIN=https://app.recruit619.com
VITE_SALES_PORTAL_URL=https://portal.tagevc.com
```

## Instant NDA platform URLs (found)

| Surface | URL |
|---------|-----|
| Sales portal login | `https://instantnda.us/sales/login` |
| Signing app | `https://app.instantnda.us` |
| Marketing | `https://instantnda.us` |

## Auto-provision on deal close

When `update-lead` sets stage → `closed_won`:

1. Finds existing `ops_entities` by `lead_id` or company name, or creates one
2. Clones default folders
3. DB triggers provision Finance / Legal / HR / Marketing / Technology controls **and** Leadership + default KPIs

## Local test (sandbox — do not deploy prod)

```bash
export PATH="/Users/joshmonroe/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/joshmonroe/Projects/tagevc-sales
npm run typecheck
npm run dev
# Open http://localhost:5173 → Think Tank (global) and Manage Portfolio → entity tabs
```

Apply migrations `0042` + `0046` before Leadership / Think Tank / KPIs persistence. Set `XAI_API_KEY` on the linked project’s edge secrets to chat with Grok.

## Stubbed vs wired

| Feature | Status |
|---------|--------|
| Entity tabs for all companies | Wired |
| Leadership save | Wired (DB) |
| Personal Think Tank (all users) | Wired (needs `0046` + `XAI_API_KEY`) — see SETUP_THINK_TANK.md |
| Entity Think Tank chat + history | Wired (needs `XAI_API_KEY`) |
| Owner oversight email | Wired (needs email secrets; silent in UI) |
| Financial period UI + Grok analysis | Wired UI; **numbers sync stubbed** |
| KPI defaults + edit/values | Wired |
| Platform links / R619 SSO | Wired |
| Instant NDA naming + sales link | Wired |
| closed_won → entity | Wired in `update-lead` |
| Company-Books live financial sync | **Backlog** |
| Signent dedicated ops portal URL | **Backlog** (website only today) |
| Periodic digest cron (vs on-save) | **Backlog** |

**Do not run `vercel --prod` / `npm run deploy` until Josh says “Deploy Batch 2”.**
