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
| `VERIFIED_FIRST_API_KEY` | Vendor API bearer token |
| `VERIFIED_FIRST_WEBHOOK_SECRET` | HMAC / shared secret for webhook |
| `VERIFIED_FIRST_API_BASE` | Optional API base (default Verified First v1) |

Webhook: `POST /api/screening/verified-first/webhook`  
Headers: `x-tagevc-webhook-secret` or `x-verified-first-signature` (HMAC-SHA256 of body).

Idempotent by `external_order_id` / spine `order_id`. Status map in `src/lib/screening/types.ts` (`mapVendorStatusToSpine`).

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
- Live Verified First package account IDs until vendor credentials provisioned
