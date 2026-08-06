# Gusto multi-entity model (Tage + subsidiary payrolls)

**Status (2026-08-06 browser probe):** Josh logged into **Recruit 619, LLC** Gusto · plan **Simple** (Next-Day Pay + Priority Support) · payroll setup **~58%** · App directory visible. Separate company from Tage’s Gusto (business fact). Partner spine remains **scaffold** (`GUSTO_LIVE=0`). Do **not** invent tax/bank/payroll completion here.

**Related:** `docs/PARTNER_SPINE.md` · `docs/HRIS_SPINE.md` · `docs/MS_GRAPH_HRIS.md` · Dialpad contrast: `docs/DIALPAD_MULTI_ENTITY.md` · DocuSign parallel: `docs/DOCUSIGN_ENTITY_AUTOMATION.md` · IES parallel: `docs/IES_MULTI_ENTITY.md`.

## Confirmed model (separate Gusto companies per legal employer)

| Layer | Choice | Why |
|-------|--------|-----|
| Payroll company | **One Gusto company per OS employer entity** that runs payroll | R619 signed its **own** Gusto; Tage keeps its own. Not Dialpad’s “one company / many offices.” |
| API auth | **Strict-access OAuth: one grant (access+refresh) per Gusto company UUID** | Gusto API (≥ `v2023-05-01`) rejects multi-company tokens ([strict access](https://docs.gusto.com/app-integrations/docs/strict-access)). |
| Spine bindings | `os_partner_entity_bindings` `partner_key='gusto'`: `external_account_id` = Gusto **company UUID** | Non-secret IDs only in `config` / binding; secrets never in `config`. |
| Token storage | Prefer **encrypted vault row per company** (IES / marketing OAuth pattern); env suffixes OK for bootstrap | Refresh every ~2h; env-only tokens rot and fight multi-entity. |
| HR routing | Shared Services HR hire → `os_hris_employees.entity_id` → resolve Gusto binding → create employee in **that** company only | Fail closed if binding/token missing for entity — **never** fall back to ENT-FIRM Gusto. |
| Live gate | `GUSTO_LIVE=0` until smoke hire + token refresh proven | Existing fail-closed stubs stay safe. |

### Contrast with Dialpad

Dialpad = single parent company, subsidiaries as **offices**. Gusto = **separate payroll companies** (like DocuSign account IDs and IES realms). Do not copy Dialpad’s `company_id` + `office_id` shape onto Gusto.

### AskQuestion fork (already decided vs still open)

| Decision | Status |
|----------|--------|
| Single shared Gusto vs **separate R619 account** | **Decided:** separate R619 Gusto |
| Token storage: per-entity env (`GUSTO_*_R619`) vs DB OAuth vault | **Open** — recommend vault (below); env OK for first smoke |
| When to stand up Signent / Instant NDA Gusto | **Open** — bind only when that entity has payroll employees |

---

## Mapping to existing code

| Piece | Path | Today |
|-------|------|--------|
| Catalog | `src/lib/partners/catalog.ts` (`gusto`) | Env: `GUSTO_API_TOKEN`, `GUSTO_COMPANY_UUID`, `GUSTO_WEBHOOK_SECRET`, `GUSTO_LIVE` — **single-company** |
| Bindings seed | `supabase/phase89_partner_spine.sql` | Scaffold rows for ENT-FIRM / R619 / SIGNENT / INDA |
| Joiner / leaver hooks | `provision.ts`, `lifecycle-hooks.ts`, `registry.ts` | Queue `provision_gusto_employee` / terminate stubs |
| Adapters | `src/lib/partners/adapters.ts` | Dry-run unless LIVE+token; live path **not implemented** |
| Commissions | `src/lib/partners/gusto-commissions.ts` | Stub queue → `os_gusto_commission_stubs`; fake `gusto_ref` when LIVE |
| Webhook | `POST /api/partners/gusto/webhook` | Records `os_partner_events` only; no company→entity map |
| `ensure_gusto_company_binding` | adapters `entityCreateAckStub` | Ack only — does not verify UUID/token |
| HRIS SoR | `src/lib/hris/*`, `docs/HRIS_SPINE.md` | Hire keyed by `entity_id`; onboarding templates (e.g. `r619-onboarding-v1`) |
| Graph / DocuSign assists | `step-assists.ts` | Live joiner paths exist; **no `gusto_provision` system_hook yet** |
| DocuSign pattern to copy | `src/lib/docusign/entity-accounts.ts` | `resolveDocuSignAccountId(entityId)` — build `resolveGustoCompany(entityId)` analog |
| OAuth vault pattern to copy | `os_ies_oauth_tokens` / `os_marketing_oauth_tokens` | Encrypt at rest; refresh worker |

**Critical risk if LIVE flipped today:** one global `GUSTO_API_TOKEN` + `GUSTO_COMPANY_UUID` would push every entity’s hire into a single company (almost certainly Tage’s). Multi-entity resolve must land **before** `GUSTO_LIVE=1`.

---

## Binding shape (non-secret)

```json
{
  "company_uuid": "<gusto-company-uuid>",
  "company_name": "Recruit 619, LLC",
  "plan": "Simple",
  "environment": "production",
  "role": "subsidiary_payroll"
}
```

- `external_account_id` → Gusto company UUID (string)
- `status` → `scaffolded` → `configured` (UUID known) → `live` (OAuth + smoke hire OK)

SQL example (apply when UUID known; no secrets):

```sql
update public.os_partner_entity_bindings
set
  external_account_id = '<R619_GUSTO_COMPANY_UUID>',
  status = 'configured',
  config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
    'company_uuid', '<R619_GUSTO_COMPANY_UUID>',
    'company_name', 'Recruit 619, LLC',
    'plan', 'Simple',
    'environment', 'production',
    'role', 'subsidiary_payroll'
  ),
  updated_at = now()
where partner_key = 'gusto' and entity_id = 'ENT-R619';
```

Repeat for `ENT-FIRM` (existing Tage Gusto) and later Signent / Instant NDA.

### Secrets / env pattern

**Target (recommended):**

| Store | Contents |
|-------|----------|
| Binding | company UUID + plan meta |
| Vault (new `os_gusto_oauth_tokens` or reuse partner vault) | access_token, refresh_token, expires_at, company_uuid, entity_id |
| Env | `GUSTO_CLIENT_ID`, `GUSTO_CLIENT_SECRET`, `GUSTO_TOKEN_SECRET` (encrypt), `GUSTO_WEBHOOK_SECRET`, `GUSTO_LIVE`, optional `GUSTO_API_VERSION` |
| Dev portal | Organization API token only for app management — **not** company employee creates |

**Bootstrap (acceptable short-term, DocuSign-style):**

```
GUSTO_COMPANY_UUID_FIRM=
GUSTO_COMPANY_UUID_R619=
GUSTO_ACCESS_TOKEN_FIRM=   # or refreshable pair in vault ASAP
GUSTO_ACCESS_TOKEN_R619=
GUSTO_LIVE=0
```

Deprecate bare `GUSTO_COMPANY_UUID` / `GUSTO_API_TOKEN` as **ENT-FIRM-only defaults**; never use them when `entity_id !== ENT-FIRM`.

---

## Shared Services HR → correct Gusto (flow)

```
HR creates hire (entity_id = ENT-R619)
        │
        ▼
os_hris_employees + auto onboarding run (r619-onboarding-v1)
        │
        ├── Graph / Entra (MS_GRAPH_*) — identity, entity-agnostic tenant
        ├── Dialpad — office_id from dialpad binding for ENT-R619
        └── Gusto joiner — resolveGustoCompany(ENT-R619)
                              │
                              ├─ missing binding/token → soft-stop (D07) + ticket
                              └─ POST create employee on R619 company UUID
                                        │
                                        ▼
                              store gusto_employee_uuid on hire / partner event
                                        │
                                        ▼
                              employee completes Gusto self-onboarding
                              (bank/tax/I-9 in Gusto UI — not OS invent)
```

Commissions (`queueCommissionFromPaidInvoice`): push to the **payee’s entity** Gusto, not consolidated firm.

Webhooks: map payload company UUID → `os_partner_entity_bindings.external_account_id` → `entity_id`; ignore unknown companies.

---

## What exists vs gaps

| Exists (scaffold / adjacent) | Gap to build |
|------------------------------|--------------|
| Partner catalog + bindings seed | `resolveGustoCompany(entityId)` fail-closed |
| Joiner checklist Gusto stubs | Live `POST` employees API + map fields from HRIS |
| Terminate stub | Live terminate / end-date |
| Commission stub table | Real payroll adjustment/earning push per entity |
| Generic webhook intake | Company UUID → entity + event handlers |
| HRIS onboarding + Graph/DocuSign assists | `system_hook: gusto_provision` on entity templates + step assist |
| Technology stack status card | Per-entity configured/live badges (like DocuSign) |
| R619 Gusto account (browser) | Complete payroll setup in Gusto UI; capture company UUID; OAuth app |

---

## Josh checklist (DO / NEED_HUMAN)

### DO (agent / eng safe)

1. Land this doc + implement `resolveGustoCompany` + fail-closed adapter (no LIVE).
2. Keep `GUSTO_LIVE=0` until R619 (and firm) bindings resolve correctly in tests.
3. Add HRIS template step / assist wired to `provision_gusto_employee`.
4. Extend webhook to resolve `entity_id` from company UUID.
5. Unit tests: R619 hire never calls firm company UUID; missing binding ≠ firm fallback.

### NEED_HUMAN (Josh in Gusto / Developer Portal)

1. Finish R619 **payroll setup** in Gusto UI (home shows ~58%) — bank, tax, federal/state as Gusto requires. **Do not invent values in OS.**
2. Confirm company legal name **Recruit 619, LLC** matches Articles / IES entity map.
3. [dev.gusto.com](https://dev.gusto.com) — create/use Tage (or R619) embed app; note sandbox vs production.
4. OAuth authorize **Recruit 619, LLC** alone (strict access); capture **company UUID**.
5. Separate OAuth authorize for **Tage** Gusto when live firm payroll sync is needed.
6. Register webhook → `https://app.tagevc.com/api/partners/gusto/webhook` + set `GUSTO_WEBHOOK_SECRET`.
7. First smoke: create a **test** employee in R619 Gusto via API (or UI), then terminate/archive per Gusto practice — prove routing before first real payroll hire.
8. Only then set `GUSTO_LIVE=1` in Vercel for the environments that have vault/tokens.

Out of scope for OS automations: choosing tax elections, linking bank accounts, running first payroll calculate/submit.

---

## Next implementation slice (smallest useful)

1. **`src/lib/partners/gusto-entity.ts`** — `resolveGustoCompany(entityId)` from binding + optional `GUSTO_COMPANY_UUID_*` env; no firm fallback for subsidiaries.
2. **Adapters** — `gustoProvisionEmployee` / terminate: if LIVE and resolved creds → real API; else dry-run; if LIVE and unresolved → **failed** (not firm).
3. **SQL** — bind ENT-R619 UUID when Josh provides it; scaffold `os_gusto_oauth_tokens` if choosing vault path.
4. **HRIS** — add `gusto_provision` assist beside Graph/DocuSign in `step-assists.ts`.
5. **Smoke** — dry-run ENT-R619 hire checklist shows R619 binding; LIVE only after NEED_HUMAN OAuth.

---

### Captured session facts (2026-08-06)

| Field | Value |
|-------|--------|
| Gusto company (UI) | Recruit 619, LLC |
| Plan | Simple · Next-Day Pay · Priority Support |
| Payroll setup | ~58% |
| Company UUID | **TBD** (NEED_HUMAN / API after OAuth) — candidate from browser session scripts not confirmed as company id |
| OS entity | `ENT-R619` |
| Partner key | `gusto` |
| Live flag | `GUSTO_LIVE=0` |
| Code slice | `src/lib/partners/gusto-entity.ts` + fail-closed adapters + `gusto_provision` HRIS assist + `phase96_gusto_multi_entity.sql` |
