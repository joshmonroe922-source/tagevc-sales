# Identity + Device Lifecycle

Spreadsheet SoT: `Technology Onboarding Process - Provisioning.xlsx` (sheets 01–26).

Extends Vendor Management + HRIS (SS§12) + IT assets (SS§9) + UDL FO§23. No shadow people/asset stores.

## New hire identity path

1. HR finalizes hire in HRIS with required `device_ownership` (`company_owned` | `personal_byod`).
2. HRIS publishes `hris.employee.hired` → `identity_hris_outbox` (Integration Layer).
3. Orchestrator opens `vm_lifecycle_cases` (`case_type=joiner`), resolves device path, writes `kit_snapshot`.
4. Workers (idempotent jobs in `identity_worker_jobs`):
   - **entra-worker** — upsert Entra user + BYOD group attrs
   - **entitlement** — materialize birthright from `vm_role_products`
   - **intune** — company: reserve `os_it_hardware_assets`; BYOD: `byod_registrations` (never hardware)
   - **notify** — company vs BYOD welcome (privacy notice on BYOD)
5. Day-1: Autopilot/ADE (company) or APP-protected apps (BYOD).

## Leaver

- Disable Entra + revoke sessions ASAP at `effective_at`.
- Zero entitlements.
- **Company:** wipe/recover allowed.
- **BYOD:** selective wipe / Retire only — `intune.device.wipe` returns `byod_wipe_blocked`.

## Apply SQL

```bash
set -a && source .env.local && set +a
node scripts/apply-phase97-identity-device.mjs
```

## APIs

| Route | Purpose |
| --- | --- |
| `POST /api/identity/hris/events` | Publish HRIS event (+ optional process/drain) |
| `POST /api/identity/workers/drain` | Process outbox + worker jobs |
| `GET /api/identity/lifecycle` | Control center |
| `POST /api/identity/entity-bootstrap` | FO §24 identity bootstrap |
| `POST /api/identity/wipe-guard` | Preflight wipe / AI forbid-list |

## Portal

`/shared-services/it/identity`

## NEED_HUMAN leftovers

- Entra admin consent / Graph app certificate rotation
- Apple ADE / ABM tokens
- Break-glass sealed credentials dual-control
- Conditional Access policy enforce flip (report-only → on)
- Live SCIM connector credentials per SaaS app
- Remote Help license assignment for helpers

## AI CTO

L1–L3 only. Forbid-list includes full wipe, account disable, break-glass, unattended Remote Help. See `src/lib/identity/ai-policy.ts`.

## Phases

| Phase | Status |
| --- | --- |
| P0 Foundation schema + events | Shipped (phase97) |
| P1 Entra worker + joiner MVP | Shipped (dry-run without Graph) |
| P2 Entitlements + SCIM pilot stub | Shipped |
| P3 Company devices | Shipped (stock reserve) |
| P3b BYOD MAM + wipe guard | Shipped |
| P4/P4+ Full joiner/leaver dual path | Shipped |
| P5 Security (AI forbid + wipe guards) | Partial (CA/PIM IaC NEED_HUMAN) |
| P6 FO §24 hooks | Shipped (AU/ADE NEED_HUMAN) |
| P7 Rollout checklists | Docs + bootstrap tasks |
| P8 UX + RH attended + AI bands | Portal + RH table + AI policy |
| P9 Backlog | Contractors, chargeback automation |
