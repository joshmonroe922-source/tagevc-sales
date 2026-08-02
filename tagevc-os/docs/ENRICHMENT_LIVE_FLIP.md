# Enrichment LIVE flip checklist

Providers stay **fail-closed** until both a real API key and a `*_LIVE=1` flag are set. Never commit keys.

## Env (Vercel Production + worker)

| Variable | Purpose |
|----------|---------|
| `ENRICHMENT_KILL_SWITCH` | `1` blocks all paid calls globally |
| `APOLLO_API_KEY` + `APOLLO_LIVE=1` | Company enrich + people expand |
| `PDL_API_KEY` + `PDL_LIVE=1` | Person waterfall |
| `HUNTER_API_KEY` + `HUNTER_LIVE=1` | Email finder |
| `ZEROBOUNCE_API_KEY` + `ZEROBOUNCE_LIVE=1` | Email verify gate before merge |
| Org `monthly_enrichment_budget_usd` | Cap in `organizations` (phase94) |

## Flip order (approved default)

1. Confirm contract + key in provider console.
2. Set API key on Vercel (and worker host).
3. Set `*_LIVE=1` for that provider only.
4. Leave kill switch **off**.
5. Open **Admin → Enrichment** — provider row should show **READY**.
6. Create/refresh one account in CRM; watch `enrichment_jobs` + `credit_ledger`.
7. If spend spikes: set `ENRICHMENT_KILL_SWITCH=1` immediately.

## UX

- Admin → Enrichment shows configured / LIVE / ready status and org budgets.
- Worker uses mock providers when LIVE is off (safe demos).
- Merge engine still requires verified email for primary_email writes (R3).

## Code

- Health: `getEnrichmentProviderHealth()` in `src/lib/spine/enrichment/providers.ts`
- Waterfall ranks: `src/lib/spine/enrichment/waterfall.ts`
