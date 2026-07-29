# Tage VC A&F — platform spine

In-portal **Accounting & Finance** system shared across Tage VC and every
subsidiary / future operating system. Spreadsheet SSOT:
`FY26 - Financial Model - Tage VC and Subsidiaries Consolidated and AF Complete System Architecture.xlsx`
(sheet **Cursor Handoff Package**).

## Standard sections

Siblings under Shared Services / A&F (or `{Entity Name} A&F` on subsidiaries):

1. **Accounting** — `/shared-services/af/accounting`
2. **Finance** — `/shared-services/af/finance`
3. **Audit** — `/shared-services/af/audit`
4. **Controls, Security & Governance** — `/shared-services/af/controls`

Hub: `/shared-services/af` · Go-Live: `/shared-services/af/setup`

## Mandatory product rules (handoff)

- Banks: Operating GL **1000** per entity; subs Savings **1040**; TVC Investments **1010** — no per-revenue banks
- `invoice.paid`: deposit 1000 → commission **2250** → Revenue Split Waterfall `allocation_ledger` → OS callback
- AP portal pay: Dr AP / Cr Cash, bill Paid; feed matches Payment only (no double AP)
- Invoice send: PDF + entity Wire + I-9 (+ customer/extras)
- Net Worth: company entity + consolidated (IC elim, exclude PERS); personal full stack − liability total (no card UI)
- Personal ▼ → **Personal Finance** + **Credit Management** (`/personal/*`) — **Visionary / Josh only** (not Think Tank / Lauren)
- Go-Live Setup wizard gates production until ORG+ENT required steps Done
- Health enums only: On Track | Watch | At Risk | Critical

## Domain code

`src/lib/af/` — masters (MD/CoA JSON from SSOT), engines (waterfall, AP match, attachments, JE, go-live, NW), demo store.

## Surfaces

| Portal | Nav label | Notes |
| --- | --- | --- |
| Tage VC | **Tage VC A&F** | Nested under Shared Services (replaces legacy Finance nav) |
| Recruit 619 | **Recruit 619 A&F** | Spine section via `buildAfNav*` |
| Instant NDA | **Instant NDA A&F** | Flat MAIN_NAV |
| Signent HR | **Signent HR A&F** | Flat MAIN_NAV |
| Future clones | **`{Entity Name} A&F`** | `src/lib/platform/af/` |

Legacy `/shared-services/finance` redirects to `/shared-services/af/finance`.

## Personal (Visionary only)

`/personal/finance` — isolated `books_id=PERS`. `/personal/credit` — Credit Management. Entire Personal ▼ is Josh / Visionary exclusive (nav `visionaryExclusive` + `requirePersonalVisionary`).

## API / event bus

- OpenAPI 3: `GET /api/af/openapi`
- Events: `GET|POST /api/af/events` (Idempotency-Key)
- Inbound OS webhooks: `POST /api/af/webhooks/inbound`
- REST sketch: `GET /api/af/{entities|invoices|bills|kpis}`

## Bank feeds (ENT-03)

Live Plaid OAuth when `PLAID_CLIENT_ID` + `PLAID_SECRET` are set (`PLAID_ENV` optional, default `sandbox`).
**Connect** opens Plaid Link → for OAuth banks (KeyBank) Link redirects to the bank then back via `redirect_uri` → exchange `public_token` → **match last4 / Plaid accounts to MD `bank_account_id` rows** → Save mappings.

Register this exact URI in Plaid Dashboard → Team → API → Allowed redirect URIs:
`https://app.tagevc.com/shared-services/af/setup/banks/connect`
(Optional override: `PLAID_REDIRECT_URI`.)

Otherwise clean stub mode with **Test import** so go-live can proceed.
