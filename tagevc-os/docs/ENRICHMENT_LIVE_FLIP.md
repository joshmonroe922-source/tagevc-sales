# Enrichment LIVE flip checklist

Providers stay **fail-closed** until both a real API key and a `*_LIVE=1` flag are set. Never commit keys.

The worker always runs. Without LIVE flags it uses **mock** firmographics + people expand (safe demos). With LIVE it calls real providers and writes `credit_ledger`.

## Env (Vercel Production + worker host)

| Variable | Purpose |
|----------|---------|
| `ENRICHMENT_KILL_SWITCH` | `1` blocks all paid calls globally |
| `APOLLO_API_KEY` + `APOLLO_LIVE=1` | Company enrich + people search |
| `PDL_API_KEY` + `PDL_LIVE=1` | Person waterfall (adapter ready; wire when key lands) |
| `HUNTER_API_KEY` + `HUNTER_LIVE=1` | Email finder during expand |
| `ZEROBOUNCE_API_KEY` + `ZEROBOUNCE_LIVE=1` | Email verify gate before primary_email write |
| Org `monthly_enrichment_budget_usd` | Cap in `organizations` (phase94) |
| `WORKER_POLL_MS` | Worker drain interval (default 5000) |
| `SPINE_STALE_DAYS` | Stale cron cutoff (default 90) |

## Flip order (approved default)

1. Confirm contract + key in provider console.
2. Set API key on Vercel **and** the worker host.
3. Set `*_LIVE=1` for that provider only (start with Apollo).
4. Leave kill switch **off**.
5. Open **Admin → Enrichment** — provider row should show **READY**.
6. Create/refresh one account in CRM; watch `enrichment_jobs` + `credit_ledger`.
7. If spend spikes: set `ENRICHMENT_KILL_SWITCH=1` immediately.

## Budget-first enrichment order (Josh 2026-08-03)

Paid Apollo is **last**. Free / scaffold stages run first whether LIVE or not:

1. **Email signatures** — scaffold/backlog (`email_signature`); traces as skipped until mailbox AI mining ships.
2. **Company + external websites** — free public `website_meta` fetch (title/meta).
3. **Paid providers** — Hunter / ZeroBounce / PDL as needed; **Apollo.ai last** when `APOLLO_LIVE=1`.

Ranks live in `COMPANY_WATERFALL` / `PERSON_WATERFALL` (`src/lib/spine/enrichment/waterfall.ts`). Bootstrap + person enrich follow that order in `bootstrap.ts`.

## What the worker does now (code ready)

1. Company: signature scaffold → website meta → Apollo enrich when LIVE (else mock firmographics).
2. People expand: **Apollo people search** when LIVE + `apollo_org_id` (after free company stages); else mock people.
3. Person waterfall: signature → website → Hunter → ZeroBounce → PDL → Apollo last (each fail-closed / scaffold).
4. Contact writes go through **merge engine** (locked/user fields → `suggested_updates`).
5. Every paid call writes `credit_ledger`; budget exceed → `budget_blocked`.
6. CRM CTAs: Account + Contact detail **Contact Info Refresh** enqueue `account.bootstrap` / `contact.enrich`.

## What Josh still needs to supply (blocked without these)

- **Apollo API key** (+ optional PDL / Hunter / ZeroBounce keys) — ping when ready; until then mock path stays on.
- Confirm worker process is running somewhere (Railway/Fly/local) with the same Supabase service role + provider env as Vercel.
- Supabase Dashboard: enable **Realtime** on `enrichment_jobs` (job toaster already subscribes; poll is fallback).
- Supabase Auth Hook for JWT `org_ids[]` (see `docs/ENTRA_SPINE_CLAIMS.md`) so RLS can replace app-level org filtering.

## UX

- Admin → Enrichment shows configured / LIVE / ready status and org budgets.
- Top bar **Org** switcher scopes CRM lists/search/jobs to the active subsidiary.
- Job toaster shows progress (Realtime + poll).
- Account detail + Contact detail: **Contact Info Refresh** buttons enqueue bootstrap/enrich.
- Worker uses mock providers when LIVE is off (safe demos); free website_meta still attempted.
- Merge engine still requires verified email for primary_email writes (R3).

## Code

- Health: `getEnrichmentProviderHealth()` in `src/lib/spine/enrichment/providers.ts`
- Waterfall ranks: `src/lib/spine/enrichment/waterfall.ts`
- Bootstrap orchestrator: `src/lib/spine/enrichment/bootstrap.ts`
- Ledger: `src/lib/spine/enrichment/ledger.ts`
- Worker: `apps/worker/src/index.ts`
