# Personal Credit — Josh & Lauren (Phase 74)

Visionary-only under Portfolio → Net Worth → Credit Management.
`hideDuringLiveLook` enforced in nav + page + APIs.

## Subjects
- **Josh Monroe** (`josh_monroe`, self)
- **Lauren Monroe** (`lauren_monroe`, spouse) — consent note shown: household personal financial management

## Preferred import sources
1. **myFICO** (Advanced / Premier) — exact FICO 8, FICO 10, Auto, Bankcard across bureaus
2. **Experian** paid (IdentityWorks Premium or equivalent) — 3-bureau monitoring + alerts
3. Fallback: annualcreditreport.com / Equifax / other PDFs

**No headless credential scraping.** Guided flow: open provider → download PDF → upload (+ optional text paste).

### How to export
- myFICO: Score / reports → download 3-bureau or score summary PDF
- Experian: Credit reports → download PDF; paste score summary if needed
- annualcreditreport.com: download PDF, choose “Other” source

## Score fields (scores jsonb)
- `fico_8`, `fico_10`, `fico_9`
- `fico_auto_8`, `fico_auto_10`
- `fico_bankcard_8`, `fico_bankcard_10`
- Per-bureau: `equifax_fico_8/10`, `experian_fico_8/10`, `transunion_fico_8/10`

## Grok Credit Advisor
- Biased to **FICO 8** (primary today) and **FICO 10** (forward)
- Starter: “Review all personal and business credit with focus on FICO 8 and FICO 10…”
- Educational only — no disputes / applications

## Apply SQL
`tagevc-os/supabase/phase74_personal_credit_dual.sql`

## Env flags
| Variable | Purpose |
|----------|---------|
| `CREDIT_PARSE_ENABLED` | Default on; set `0` to store raw only |
| `CREDIT_STALE_DAYS` | Default `45` |
| `PERSONAL_CREDIT_GROK_ENABLED` | Default on; set `0` to disable advisor |
| `XAI_API_KEY` / `GROK_API_KEY` | Required for Grok replies |

Bucket: `credit-private` (created by migration). Business bureau reports
(Phase 75) share the bucket under `business/…` — see `OS_BUSINESS_CREDIT.md`.
