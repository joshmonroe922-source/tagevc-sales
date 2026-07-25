# Phase 73 — Net Worth + Credit Management

## Env / secrets checklist (future connectors)

| Variable | Purpose | Required now? |
|----------|---------|---------------|
| `PLAID_CLIENT_ID` / `PLAID_SECRET` | Brokerage/bank sync | No — fail-soft scaffold |
| `CRYPTO_EXCHANGE_API_KEY` or `COINBASE_API_KEY` | Crypto balances | No |
| `DNB_API_KEY` | Dun & Bradstreet business credit | No |
| `DNB_API_ENABLED=1` | Opt-in live D&B attempts | No |
| `XAI_API_KEY` / `GROK_API_KEY` | Grok Credit Advisor | For advisor replies |
| `CREDIT_PARSE_ENABLED` | Parse uploads (default on) | No |
| `CREDIT_STALE_DAYS` | Stale badge threshold (default 45) | No |
| `PERSONAL_CREDIT_GROK_ENABLED` | Grok panel (default on) | No |

No autonomous trading. No bureau auto-disputes. Manual + CSV in v1.
Personal credit dual-person (Josh/Lauren) + myFICO/Experian guided import: see **docs/OS_PERSONAL_CREDIT.md** and `phase74_personal_credit_dual.sql`.

## Apply SQL

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tagevc-os/supabase/phase73_net_worth_credit.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tagevc-os/supabase/phase74_personal_credit_dual.sql
```

Or paste into Supabase SQL Editor (project `opdqybaatfbwkokbzwli`).

## Surfaces

- Portfolio → **Net Worth** (Visionary-only; hidden during Live Look)
- Net Worth → **Credit Management** (personal Visionary-only Josh+Lauren; business for finance/SSC)
- Firm home + Dashboard AUM card: firm-visible only
- APIs: `/api/net-worth/private`, `/personal-credit`, `/firm-aum`

## Residual gaps

1. Live Plaid / exchange / D&B connectors (scaffold only)
2. RE portfolio auto-sync into firm_visible assets
3. Portfolio company valuation markers from finance feeds
4. SSC checklist auto-tasks for business credit cadence
5. Partner business-credit opt-in policy toggle
6. Signed PDF / statement attachments on assets
7. Multi-currency FX normalization
8. Stronger PDF text extraction (pdf.js) for dense myFICO layouts
