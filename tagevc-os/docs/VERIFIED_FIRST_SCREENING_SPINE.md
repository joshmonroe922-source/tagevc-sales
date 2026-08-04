# Verified First screening spine

**Phases:** Tage OS `phase80` · Recruit `phase50`  
**Spine:** `app.tagevc.com` (`os_screening_packages`, `os_screening_orders`)  
**Consumers:** HRIS internal hires · Recruit 619 client placements · Signent (scaffold)

## Business model

Verified First is the firm screening vendor for:

1. **Internal hires** (Tage VC + subsidiary employees) via HRIS onboarding steps
2. **Recruit client placements** when the client account / job requires BG and/or drug screen
3. **Signent** later — same order APIs, `subject_type = signent_client_employee` (no portal UI this pass)

## Non-negotiables

- Human confirm before every live order — **no silent sends**
- `VERIFIED_FIRST_LIVE=0` (default) **fail-closed** — vendor API not called; no fabricated clear
- SSC UI stays Tage-only; `os_store_snapshots` untouched
- Do not mix Phase 78 account credit-check into this flow

## Spine tables

| Table | Purpose |
|-------|---------|
| `os_screening_packages` | Vendor package catalog (`bg` / `drug` / `combo`) |
| `os_screening_entity_defaults` | Optional internal-hire defaults per entity |
| `os_screening_orders` | System of record for all consumers |

Order statuses: `pending` → `ordered` → `in_progress` → `clear` | `review` | `failed` | `cancelled` | `waived`

`consumer_ref` jsonb holds `{ application_id, placement_id, job_id, account_id, hris_run_id, hris_step_id, … }`.

### RLS

- `can_manage_screening(entity_id)` — Visionary / HR / recruiting manager+
- `can_view_screening(entity_id)` — managers + Recruit desk for `ENT-R619`
- No cross-entity leakage; reports under `screening-private/{entity_id}/…`

## Flow A — Recruit client placement

```
Account defaults (requires_bg / requires_drug / packages)
    ↓ inherit on job create (overridable; UI flags diffs)
Job requirements confirmed with client
    ↓ offer accepted / stage → placement
Pending os_screening_orders (subject_type=placement)
    ↓ human Confirm & order
Vendor (only if VERIFIED_FIRST_LIVE=1) or local ordered (LIVE=0)
    ↓ webhook clear
Placement screening_*_status + application.bg_screen_status updated
```

**Gates**

| Gate | Rule |
|------|------|
| Extending Offer (`bg_screen_*`) | Existing recruiter workflow gate — kept |
| Placement start | When `job.screening_gate_start` and required screen is pending/ordered/in_progress/review → block `started` |
| Bill-on-placement / IES | **Unchanged** — screening does not rewrite invoice rules |

Source of truth for **client-required** screens = job/account flags + `os_screening_orders` on placement. Application `bg_screen_status` syncs from spine for BG/combo orders.

## Flow B — HRIS internal hire

```
Onboarding template step (system_hook = verified_first)
    ↓ Create pending screen order (employee subject)
Human Confirm & order
    ↓ webhook clear | waive
Step evidence → done/waived; vault link on run/employee
```

Graph / DocuSign paths unchanged. Step complete when status `clear` | `waived` | mark N/A if not required.

## Flow C — Signent (scaffold)

- `subject_type = signent_client_employee` allowed on spine
- No Signent portal UI this pass
- Later: client-scoped orders from Signent OS using the same confirm → webhook path

## Vendor integration

| Env | Purpose |
|-----|---------|
| `VERIFIED_FIRST_LIVE` | `1` to call vendor; default/unset = fail-closed |
| `VERIFIED_FIRST_API_USERNAME` | Basic Auth username from VF Integrations |
| `VERIFIED_FIRST_API_PASSWORD` | Basic Auth password from VF Integrations |
| `VERIFIED_FIRST_API_KEY` | Optional legacy only: `username:password` |
| `VERIFIED_FIRST_WEBHOOK_SECRET` | Shared secret / HMAC for webhook POST-back |
| `VERIFIED_FIRST_API_BASE` | Default `https://api1.verifiedfirst.com/external/verified-first` (staging: `api2`) |
| `VERIFIED_FIRST_SEARCH_TYPE` | Optional; default `app_invitation` |

**Auth model:** HTTP **Basic Authentication** (username + password) — **not** Bearer API key and **not** OAuth for the REST API. Public docs: [docs.api.verifiedfirst.com](https://docs.api.verifiedfirst.com/#) · Client Resource Center formats article (Production `api1`, Test `api2`). Credentialing is **not self-serve**: email `integrations@verifiedfirst.com`, Staging + Production portal users, IP/domain whitelist.

Live order call: `POST {API_BASE}/order` with `Authorization: Basic …` and body `{ "order": { "search_type", "package_id", "first_name", "last_name", … } }`.

Webhook: `POST https://app.tagevc.com/api/screening/verified-first/webhook`  
Headers: `x-tagevc-webhook-secret` or `x-verified-first-signature` (HMAC-SHA256 of body).

Accepted bodies:
- Spine/test: `{ "spine_order_id"|"external_order_id", "status" }`
- VF POST-back: `{ "type": "background status", "status_update": { "order_id", "status", "adjudication?", "url?" } }`

Idempotent by `external_order_id` / spine `order_id`. Status map in `src/lib/screening/types.ts` (`mapVendorStatusToSpine`).

## Connect (Josh) — unblocked by CRM / SF

**Verdict:** Connect at Tage partner spine **now**. Do **not** wait on R619 CRM rebuild or Salesforce migration — screening tables, HR admin UI, entity bindings, and fail-closed vendor client are already live on the spine. Those other tracks do not own these secrets or tables.

Asking VF for an “API key” alone is the wrong ask — they issue **Basic Auth username/password** (and activate formats after Staging review). That public-docs process is expected.

### Already done (prod UDL)

- `phase80` tables + seed packages (`vf-basic-bg`, `vf-standard-bg`, `vf-drug-5`, `vf-drug-10`, `vf-combo-bg-drug`)
- `phase89` bindings for `verified_first` on ENT-FIRM · ENT-R619 · ENT-SIGNENT · ENT-INDA (`status=scaffolded`)
- Admin: Shared Services → HR → Screening · Technology stack contracts UI
- Webhook route + human-gated confirm path
- Vendor client aligned to Basic Auth + `api1`/`api2` + `POST …/order` (keep `LIVE=0`)

### You must provide

1. **Basic Auth username + password** from VF Integrations (staging first).
2. Optional but recommended: **VF `account_id`(s)** → store on `os_partner_entity_bindings.external_account_id` per entity.
3. **Package `package_id` UUIDs** from VF portal / `GET …/account/packages` → `os_screening_packages.vendor_package_id`.
4. Approve webhook URL + outbound IP whitelist with VF.
5. Approve flipping **`VERIFIED_FIRST_LIVE=1`** only after a **staging** smoke order (keep `0` until then).

### Wire steps (after credentials arrive)

```bash
# Prefer staging base until smoke passes
printf '%s' "$VERIFIED_FIRST_API_USERNAME" | vercel env add VERIFIED_FIRST_API_USERNAME production
printf '%s' "$VERIFIED_FIRST_API_PASSWORD" | vercel env add VERIFIED_FIRST_API_PASSWORD production
printf '%s' 'https://api2.verifiedfirst.com/external/verified-first' | vercel env add VERIFIED_FIRST_API_BASE production
# Generate once; give the same value to VF for POST-back auth
openssl rand -hex 32 | tee /tmp/vf_webhook.secret
vercel env add VERIFIED_FIRST_WEBHOOK_SECRET production < /tmp/vf_webhook.secret
# Leave LIVE=0 until staging smoke passes
printf '0' | vercel env add VERIFIED_FIRST_LIVE production
rm -f /tmp/vf_webhook.secret
```

Point VF POST-back to `https://app.tagevc.com/api/screening/verified-first/webhook` with header `x-tagevc-webhook-secret: <secret>` (or HMAC signature).

Recruit 619 portal reads the same UDL spine; set matching `VERIFIED_FIRST_*` on the Recruit Vercel project only if that app places orders itself (otherwise Tage OS is enough).

## UX surfaces

**Tage OS**

- `/shared-services/hr/screening` — packages + order queue
- HRIS employee detail — screening step order/confirm/waive
- Nav: Shared Services → Screening

**Recruit 619**

- Account → Client screening requirements
- Job → Client screening requirements (inherit / override)
- Candidate application → Verified First screening panel (placement orders)

## SQL apply

```bash
# Tage UDL (shared with Recruit)
set -a && source tagevc-os/.env.local && set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tagevc-os/supabase/phase80_verified_first_screening.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f recruit619-portal/supabase/phase50_r619_verified_first_screening.sql
```

## Click-tests

**A — Recruit**

1. Account: enable BG + drug, pick packages, save
2. New job on that account → inherits flags/packages
3. Override job package → “Differs from account default”
4. Advance application to Placement → pending orders created
5. Confirm with checkbox → LIVE=0 shows local ordered
6. POST webhook `{ "spine_order_id": "…", "status": "clear" }` → placement + app show clear

**B — HRIS**

1. Open onboarding employee with Verified First step
2. Create pending order → Confirm → webhook clear → step evidence complete

**C — LIVE=0**

1. Confirm order with `VERIFIED_FIRST_LIVE` unset → vendor not called; status `ordered` / `live_disabled_local_ordered`; never auto-clear

## Residuals

- Adverse-action letter automation (legal; later)
- Auto-order without human confirm (never)
- Full Signent portal screening UI
- Live Verified First package account IDs + `vendor_package_id` mapping (blocked on VF credentials)
- Confirm optional order body fields (`partner_metadata`, etc.) with VF Integrations if rejected at staging
- Instant (`search_type=instant`) path once SSN/DOB collection is wired end-to-end
