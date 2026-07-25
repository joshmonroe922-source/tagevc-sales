# Intuit Enterprise Suite (IES) setup — Tage OS

IES is the financial system of record. Tage is the orchestration/control plane (visibility, close cadence, exceptions, dual-approve proposals). Tage never auto-writes to IES.

## Architecture

- One IES login environment covers Tage Venture Capital, Recruit 619, Instant NDA (Signent later).
- Each company maps to an Intuit `realmId` via `os_ies_entity_map`.
- Books API path: Intuit OAuth 2.0 + QuickBooks Online Accounting API (`com.intuit.quickbooks.accounting`).
- Sync writes only to Tage tables: `os_ies_finance_feed`, `os_ies_coa_snapshots`, `os_ies_invoice_signals`, `os_ies_sync_runs`.

## Vercel secrets (app.tagevc.com)

| Secret | Required | Purpose |
|--------|----------|---------|
| `IES_CLIENT_ID` | yes | Intuit Developer app Client ID |
| `IES_CLIENT_SECRET` | yes | Intuit Developer app Client Secret |
| `IES_TOKEN_SECRET` | yes | ≥16 chars; AES-256-GCM vault for OAuth tokens |
| `IES_ENVIRONMENT` | no | `sandbox` (default) or `production` |
| `IES_REDIRECT_URI` | no | Defaults to `{NEXT_PUBLIC_APP_URL}/api/finance/ies/oauth/callback` |
| `NEXT_PUBLIC_APP_URL` | recommended | `https://app.tagevc.com` |

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

Apply `tagevc-os/supabase/phase70_ies_connection.sql` (idempotent).

## Subsidiary portals

- Recruit 619 / Instant NDA show lightweight finance visibility + handoff links into Tage Finance.
- They are not a second ledger. Placement/subscription signals may inform requests; books remain in IES.

## Residual gaps

- Intercompany eliminations not applied in consolidated totals.
- Signent HR company mapping deferred until Signent OS.
- Report row label matching for cash/AR/AP is best-effort across COA variants.
- Production Intuit app review / Partner Program may be required for live traffic.
