# Identity + Device Lifecycle (Shared Services)

Architecture SoT: `Technology Onboarding Process - Provisioning.xlsx` (sheets 01–26).

## Phase scoreboard

| Phase | Status | Notes |
| --- | --- | --- |
| **P0** Foundation schema + events | **done** | `supabase/phase97_identity_device_lifecycle.sql` — UDL, RLS, outbox, jobs, BYOD, kits, FO§24 |
| **P1** Entra worker + joiner MVP | **done** (dry-run) | `entra-worker`; live Graph needs NEED_HUMAN consent/cert |
| **P2** Entitlements + birthright | **done** (pilot) | `vm_role_products` → `vm_entitlements`; SCIM worker gated off |
| **P3** Device SS§9 + Intune | **done** (dry-run) | company reserve/assign + wipe; ADE live = NEED_HUMAN |
| **P3b** BYOD MAM | **done** | `byod_registrations` + wipe guard (`byod_wipe_blocked`) |
| **P4 / P4+** Full joiner + leaver dual-path | **done** | dual-path orchestrator + notify templates |
| **P4 catalog** mover / update / cancel / rehire | **done** | outbox handlers for full sheet-04 catalog |
| **P5** Security hardening | **partial** | AI forbid-list + alert rules in UDL; CA/PIM/break-glass = NEED_HUMAN |
| **P6 / P6+** FO §24 automation | **done** (seed) | bootstrap RPC + API; AU/APP/CA evidence = NEED_HUMAN |
| **P7** Subsidiary rollout | **partial** | per-entity seed tasks; cutover evidence pending ops |
| **P8** UX + RH + AI bands | **done** | portal `/shared-services/it/identity`, Remote Help API, L1–L3 |
| **P9** Optimize & extend | **backlog** | contractors, chargeback automation |

## What shipped

Extends **Vendor Management + HRIS + SS§9 IT assets** only — no shadow people/device stores.

## New hire path (happy path)

1. HRIS commits hire with required `device_ownership` (`company_owned` | `personal_byod`).
2. `POST /api/identity/events` (or `/api/identity/hris/events`) publishes to `identity_hris_outbox`.
3. Orchestrator opens `vm_lifecycle_cases` (case_type=`joiner`), resolves device path, queues jobs.
4. Workers: Entra upsert → birthright entitlements → (company device reserve **or** BYOD MAM row) → welcome notify.
5. Pure MAM never creates hardware rows (`G-BYOD-ASSET`).
6. Offboard BYOD = selective wipe / Retire only; full wipe → `byod_wipe_blocked`.

## Full event catalog (sheet 04)

| Event | Handler |
| --- | --- |
| `hris.employee.hired` | `openJoinerCase` |
| `hris.employee.terminated` | `openLeaverCase` |
| `hris.employee.role_changed` | `openMoverCase` (entitlement delta) |
| `hris.employee.updated` | Entra attr patch; transfer if `prior_entity_id` |
| `hris.employee.cancelled_hire` | compensate disable + revoke + BYOD retire |
| `hris.employee.rehire` | joiner + `entra.user.enable` |

Feature flags (sheet 23): `IDENTITY_JOINER_ENABLED`, `IDENTITY_LEAVER_ENABLED`, `IDENTITY_MOVER_ENABLED`, `IDENTITY_SCIM_ENABLED` (default off), `IDENTITY_BYOD_ENABLED`.

## Apply SQL

```bash
cd tagevc-os
set -a && source .env.local && set +a
node scripts/apply-phase97-identity-device.mjs
```

## Cron / operators

- Drain outbox + workers: `POST /api/identity/workers/drain` (Vercel cron `*/5`)
- Worker-only: `POST /api/identity/worker`
- FO§24 seed: `POST /api/identity/fo24` `{ "entity_id": "ENT-…" }`
- Portal: `/shared-services/it/identity`

Auth: `DIGEST_SECRET` / `CRON_SECRET` bearer **or** `write:it_assets` session.

## NEED_HUMAN (next blockers)

1. **Entra admin consent + Graph app certificate** — unblocks live user create/disable (P1 exit)
2. **Apple ADE / ABM tokens** — company zero-touch Mac/iOS (P3)
3. **Conditional Access / APP BYOD tenant apply** — Security sign-off (P5 / P3b)
4. **Break-glass sealed dual-control vault** — P5
5. **M365 license pool confirmation** — P2 GBL
6. **Remote Help helper licenses** — P8 ops
7. **SCIM pilot app endpoint** — set `IDENTITY_SCIM_ENABLED=1` after product row ready
