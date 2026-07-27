# Intuit Enterprise Suite (IES) setup — Tage OS

IES is the financial system of record. Tage is the orchestration/control plane (visibility, close cadence, exceptions, dual-approve proposals). Tage never auto-writes to IES.

## Architecture

- One IES login environment covers Tage Venture Capital, Recruit 619, Signent HR, Instant NDA.
- Each company maps to an Intuit `realmId` via `os_ies_entity_map` / view `os_ies_company_map`.
- Authoritative company IDs (seeded in `phase81_ies_multi_entity.sql`):
  - Tage Venture Capital → `9341457251412290` (parent)
  - Recruit 619 → `9341457251406251`
  - Signent HR → `9341457251424506`
  - Instant NDA → `9341457533727282`
- Books API path: Intuit OAuth 2.0 + QuickBooks Online Accounting API (`com.intuit.quickbooks.accounting`).
- Sync writes only to Tage tables: `os_ies_finance_feed`, `os_ies_coa_snapshots`, `os_ies_invoice_signals`, `os_ies_financial_snapshots`, `os_ies_sync_runs`.
- Full multi-entity contract: `docs/IES_MULTI_ENTITY.md`.

## Vercel secrets (app.tagevc.com)

| Secret | Required | Purpose |
|--------|----------|---------|
| `IES_CLIENT_ID` | yes | Intuit Developer app Client ID |
| `IES_CLIENT_SECRET` | yes | Intuit Developer app Client Secret |
| `IES_TOKEN_SECRET` | yes | ≥16 chars; AES-256-GCM vault for OAuth tokens |
| `IES_ENVIRONMENT` | no | `sandbox` (default) or `production` |
| `IES_REDIRECT_URI` | no | Defaults to `{NEXT_PUBLIC_APP_URL}/api/finance/ies/oauth/callback` |
| `NEXT_PUBLIC_APP_URL` | recommended | `https://app.tagevc.com` |
| `IES_SYNC_ENABLED` | no | Exact `1` enables read sync; default off |
| `IES_WRITE_ENABLED` | no | Exact `1` for future dual-approved draft submit; default **0** fail-closed |

Also ensure cron auth uses existing `CRON_SECRET` or `DIGEST_SECRET` for `/api/finance/ies/sync`.

## Intuit Developer Portal

1. Create an app with Accounting scope.
2. Add redirect URI: `https://app.tagevc.com/api/finance/ies/oauth/callback`
3. Copy Client ID / Secret into Vercel.
4. Generate a long random `IES_TOKEN_SECRET` (≥16 chars).

## Operator flow

1. Open `/shared-services/finance`.
2. Optionally select company, then **Connect IES company**.
3. Complete Intuit consent (returns `realmId`).
4. If entity was not in the OAuth start URL, use **Map realm** (`ENT-*` → realmId).
5. **Pull latest** (or wait for daily cron `0 6 * * *`).
6. Use month-end close + SSC finance checklists for cadence — completing items does **not** post to IES.
7. Write-back proposals still require dual human approval; operator executes in IES.

## SQL

Apply (idempotent):

1. `tagevc-os/supabase/phase70_ies_connection.sql`
2. `tagevc-os/supabase/phase81_ies_multi_entity.sql` (locks company IDs + snapshots + write proposals)

## Subsidiary portals

- Recruit 619 / Instant NDA show lightweight finance visibility + handoff links into Tage Finance.
- They are not a second ledger. Placement/subscription signals may inform requests; books remain in IES.
- Signent HR: marketing site only — strip scaffold doc, no portal UI.

## Residual gaps

- Intercompany eliminations not applied in consolidated totals (management consol labeled).
- Report row label matching for cash/AR/AP is best-effort across COA variants.
- Production Intuit app review / Partner Program may be required for live traffic.
- OAuth tokens still required per company before sync returns live numbers.
