# Identity + Device Lifecycle (Shared Services)

Architecture SoT: `Technology Onboarding Process - Provisioning.xlsx` (sheets 01–26).

## What shipped

Extends **Vendor Management + HRIS + SS§9 IT assets** only — no shadow people/device stores.

| Phase | Deliverable |
| --- | --- |
| P0 | `supabase/phase97_identity_device_lifecycle.sql` — schema, RLS, outbox, jobs, BYOD table, kits, FO§24 tasks |
| P1 | `entra-worker` + joiner MVP (`src/lib/identity/workers/entra.ts`) |
| P2 | Birthright materialize via `vm_role_products` → `vm_entitlements` |
| P3 | Company device reserve on `os_it_hardware_assets` + assignments |
| P3b | `byod_registrations` + wipe guard (`byod_wipe_blocked`) |
| P4/P4+ | Dual-path joiner/leaver orchestrator + notify templates |
| P5 | AI forbid-list + alert rules + break-glass forbid signals |
| P6 | FO§24 bootstrap seed RPC + `/api/identity/fo24` |
| P7 | Portal control center (entity-scoped) + rollout via per-entity seed |
| P8 | UX portal, attended Remote Help API, AI L1–L3 policy |
| P9 | Backlog only (contractors, chargeback automation) |

## New hire path (happy path)

1. HRIS commits hire with required `device_ownership` (`company_owned` | `personal_byod`).
2. `POST /api/identity/events` (or `/api/identity/hris/events`) publishes to `identity_hris_outbox`.
3. Orchestrator opens `vm_lifecycle_cases` (case_type=`joiner`), resolves device path, queues jobs.
4. Workers: Entra upsert → birthright entitlements → (company device reserve **or** BYOD MAM row) → welcome notify.
5. Pure MAM never creates hardware rows (`G-BYOD-ASSET`).
6. Offboard BYOD = selective wipe / Retire only; full wipe → `byod_wipe_blocked`.

## Apply SQL

```bash
cd tagevc-os
set -a && source .env.local && set +a
node scripts/apply-phase97-identity-device.mjs
```

## Cron / operators

- Drain outbox + workers: `POST /api/identity/workers/drain`
- Worker-only: `POST /api/identity/worker`
- FO§24 seed: `POST /api/identity/fo24` `{ "entity_id": "ENT-…" }`
- Portal: `/shared-services/it/identity`

Auth: `DIGEST_SECRET` / `CRON_SECRET` bearer **or** `write:it_assets` session.

## NEED_HUMAN leftovers

- Entra admin consent + Graph app certificate for live user create
- Apple ADE / ABM tokens
- Break-glass sealed dual-control vault
- Conditional Access / APP tenant policy apply (Security)
- M365 license pool confirmation
- Remote Help helper licenses
