# Business Credit — Multi-bureau (Phase 75)

Portfolio → Net Worth → Credit Management → Business Credit.
Roles: Visionary + `service_lead` / `counsel_ops` / `coo` / `admin` (same as Phase 73).
Personal credit (Josh/Lauren, Phase 74) untouched — still Visionary-only + hidden in Live Look.

## Three bureaus per company
| Bureau | Identifier | Primary score |
|--------|-----------|----------------|
| Dun & Bradstreet | D-U-N-S | PAYDEX (1–100) |
| Experian Business | File / BIN # | Intelliscore Plus (1–100) |
| Equifax Business | Equifax ID | Business Credit Risk (101–992) |

Secondary scores also parsed/enterable: D&B failure score, Experian financial
stability risk, Equifax business failure score, payment index.

## Guided import (human-gated — no scraping, no stored passwords)
1. Open the bureau’s business portal from the side panel link and sign in yourself.
2. Download the latest business credit report / PDF / export for the company.
3. Return and upload (optional text paste helps parsing).
4. Raw file → `credit-private/business/…` · parse → snapshot (identifiers/scores/summary).
5. Manual entry fallback records key values with a `manual_entry` source flag.

No fake scores — only parsed or manually entered values are stored.

## Monitoring
- Stale per company × bureau: `BUSINESS_CREDIT_STALE_DAYS` (default 60).
- Light delta on re-import (primary score change, new public records) → audit event.
- Grok Credit Advisor context now includes multi-bureau business snapshots.

## Apply SQL
`tagevc-os/supabase/phase75_business_credit_bureaus.sql` (additive; re-runnable).

## Env flags
| Variable | Purpose |
|----------|---------|
| `BUSINESS_CREDIT_PARSE_ENABLED` | Default on; set `0` to store raw only |
| `BUSINESS_CREDIT_STALE_DAYS` | Default `60` |
