# Account credit / payment-worthiness check

**Phase 78** · Tage UDL spine (`os_account_credit_checks`)  
**Policy:** Always start commercial negotiations at **Due Upon Receipt (DUR)**. Run a credit check when the account pushes for NET 15/30/45 / open terms, or when a manager finds the account questionable. Check results inform negotiation only — they do **not** auto-write terms onto contracts, jobs, or IES.

Persistent copy:

> Default remains Due Upon Receipt until a manager/finance explicitly changes terms.

## Who can run (manager+)

| Surface | Roles |
|---------|--------|
| Firm finance / Visionary | `visionary`, `admin`, `service_lead`, `counsel_ops`, `coo` |
| Recruit ENT-R619 | above + `partner`, `sub_lead` |
| Instant NDA | Schema supports `instantnda_customer` — **no product UI** this pass |
| Signent | Schema supports `signent_client` — **no portal** until Signent OS |

SQL helper: `can_run_account_credit_check(entity_id)`. Deny by default across entity boundaries.

## Recruit — LIVE

- Account detail shows **Due Upon Receipt** posture chip by default (`payment_terms_posture`).
- Manager+ button: **Check payment worthiness** → Account Credit Check panel (`account_ref_type = recruit_account`).
- Soft prompt when activity suggests a NET request.
- **No auto-run on account create.**
- Non-manager: no run button.

## Instant NDA — SCAFFOLD ONLY

- Ref type `instantnda_customer` allowed in spine.
- Feature flag: `INDA_ACCOUNT_CREDIT_CHECK_ENABLED` (default **off** / unset).
- Do **not** enable routine bureau pulls. Default INDA path remains Stripe/card or DUR-style.
- Enable later only for enterprise / custom-terms accounts.

## Signent — SCAFFOLD ONLY

- Ref type `signent_client` supported.
- Future hook: manager+ button on client workspace when Signent OS ships.

## Bureaus (paid reality)

Reports on **other companies** are typically paid (pay-per-report or subscription). Guided import only:

1. Export from D&B / Experian Business / Equifax Business
2. Upload PDF/export (or paste text)
3. Parse → scores, risk_band, suggested_terms
4. Manual fields if parse partial

No headless login. No stored bureau passwords. Raw files under `credit-private/account-credit/{entity_id}/…`.

Self-entity monitoring (Josh/Lauren personal + portfolio business credit Phases 73–75) is **unchanged** and separate.

## Rules (DRAFT guidance only)

| Risk | Suggested negotiation ceiling | Starting posture |
|------|-------------------------------|------------------|
| low | may allow `net_30` | always DUR |
| medium | `net_15` or stay DUR | DUR |
| high / unknown / thin_file | `due_upon_receipt` or `prepaid` | DUR |

Thresholds live in `src/lib/account-credit/rules.ts` (`ACCOUNT_CREDIT_THRESHOLDS`) — tunable in code.

## API future (fail-closed)

Stubs: `dnb_api` | `experian_business_api` | `equifax_business_api`  
Env flags off by default (`ACCOUNT_CREDIT_*_API_ENABLED`). Live path this pass = guided upload only.

## Automation posture

**Now:** Manual manager+ only. No Instant NDA UI. No auto-apply terms.  
**Later (must not block):** optional AUTO/DRAFT when NET requested or exposure > threshold; INDA enterprise flag; live bureau APIs.

## Audit

Request / upload / complete / waive update the check row (who, when, reason). Terms changes remain human + never AUTO.

## SQL

```bash
set -a && source .env.local && set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/phase78_account_credit_checks.sql
```

Recruit convenience columns: `recruit619-portal/supabase/phase48_r619_account_credit.sql`.

## Click-test

1. Recruit → Client account → see **Due Upon Receipt**
2. Manager → **Check payment worthiness** → upload sample bureau PDF
3. Verify `risk_band` + `suggested_terms` + DUR reminder copy
4. Non-manager → no run button
5. Instant NDA portal → no credit-check UI
6. Personal / self business credit pages unchanged
