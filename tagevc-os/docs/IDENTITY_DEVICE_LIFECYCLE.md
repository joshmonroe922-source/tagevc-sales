# Identity + Device Lifecycle (Shared Services)

Architecture SoT: `Technology Onboarding Process - Provisioning.xlsx` (sheets 01–26).

## Phase scoreboard

| Phase | Status | Notes |
| --- | --- | --- |
| **P0** Foundation schema + events | **done** | `supabase/phase97_identity_device_lifecycle.sql` — UDL, RLS, outbox, jobs, BYOD, kits, FO§24 |
| **P1** Entra worker + joiner MVP | **LIVE-ready** (gated) | Admin consent **Granted** for `User.ReadWrite.All`; client secret in Vercel Production+Preview; token smoke OK; keep `MS_GRAPH_CREATE_USERS=0` until synth smoke then set `IDENTITY_ENTITY_CUTOVER` + CREATE_USERS=1 |
| **P2** Entitlements + birthright | **done** (pilot) | `vm_role_products` → `vm_entitlements`; SCIM worker gated off |
| **P3** Device SS§9 + Intune | **done** (dry-run) | company reserve/assign + wipe; ADE live = NEED_HUMAN (Apple login) |
| **P3b** BYOD MAM | **done** | `byod_registrations` + wipe guard (`byod_wipe_blocked`) |
| **P4 / P4+** Full joiner + leaver dual-path | **done** | dual-path orchestrator + notify templates |
| **P4 catalog** mover / update / cancel / rehire | **done** | outbox handlers for full sheet-04 catalog |
| **P5** Security hardening | **partial** | AI forbid-list + alert rules in UDL; CA/APP checklist in this runbook; tenant apply = NEED_HUMAN |
| **P6 / P6+** FO §24 automation | **done** (seed) | bootstrap RPC + API; AU/APP/CA evidence = NEED_HUMAN |
| **P7** Subsidiary rollout | **partial** | `IDENTITY_ENTITY_CUTOVER` progressive delivery (sheet 23) |
| **P8** UX + RH + AI bands | **done** | portal `/shared-services/it/identity`, Remote Help API, L1–L3 |
| **P9** Optimize & extend | **backlog** | contractors, chargeback automation |

### LIVE-ready vs blocked (joiner/leaver dual-path)

| Capability | Status |
| --- | --- |
| Code path company MDM + BYOD MAM | **LIVE-ready** (orchestrator + workers) |
| Entra user create/disable/enable | **LIVE-ready gated** — Graph token OK + `User.ReadWrite.All`; enable with `MS_GRAPH_CREATE_USERS=1` + `IDENTITY_ENTITY_CUTOVER=ENT-FIRM,ENT-R619` after synth smoke |
| Birthright entitlements | **LIVE-ready** (DB) |
| ADE / ABM zero-touch | **Blocked NEED_HUMAN** — App Store Connect / ABM login |
| CA / APP tenant policies | **Doc-ready** — apply in Entra/Intune = NEED_HUMAN |
| Entity cutover ENT-FIRM / ENT-R619 | **Code-ready** — set `IDENTITY_ENTITY_CUTOVER=ENT-FIRM,ENT-R619` after smoke |
| SCIM | **Off** until pilot product + licenses |

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

### Feature flags (sheet 23)

| Env | Default | Meaning |
| --- | --- | --- |
| `IDENTITY_JOINER_ENABLED` | on | `identity.joiner.enabled` |
| `IDENTITY_LEAVER_ENABLED` | on | `identity.leaver.enabled` |
| `IDENTITY_MOVER_ENABLED` | on | mover / role_changed |
| `IDENTITY_SCIM_ENABLED` | **off** | SCIM pilot |
| `IDENTITY_BYOD_ENABLED` | on | personal_byod path |
| `IDENTITY_REMOTE_HELP_ENABLED` | on | Remote Help API |
| `IDENTITY_CA_COMPLIANT_REQUIRED` | off | when on, operators treat CA-compliant as hard require |
| `IDENTITY_ENTITY_CUTOVER` | empty | `identity.entity.{code}.cutover` — CSV `ENT-FIRM,ENT-R619` or `*` |
| `MS_GRAPH_CREATE_USERS` | empty/off | must be `1` **and** entity cutover for live Graph mutate |
| `MS_GRAPH_TENANT_ID` / `CLIENT_ID` / `CLIENT_SECRET` | — | Tage VC OS app credentials |

Live Graph gate: `isGraphUserLiveEnabled(entityId)` = `MS_GRAPH_CREATE_USERS=1` ∧ entity in cutover allowlist. Missing credentials always dry-run.

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
- Synthetic smoke: `node scripts/identity-synth-hire-smoke.mjs` (dry-run by default)

Auth: `DIGEST_SECRET` / `CRON_SECRET` bearer **or** `write:it_assets` session.

## Entra / Graph live cutover runbook

**App:** Tage VC OS · client id `905649ff-1aee-4683-87e0-5d6d2005aea5` · tenant `aecc0efa-a429-4b4f-8c77-c2957b8263ab`

1. **API permissions (Application):** `User.ReadWrite.All` (required for joiner/leaver). Recommended: `Directory.Read.All`, `GroupMember.ReadWrite.All`, `Organization.Read.All`, Intune device R/W as needed.
2. **Grant admin consent** for Tage Venture Capital — status must show **Granted** (not Not granted).
3. **Certificates & secrets** — create client secret (or cert); paste into Vercel **Production + Preview**:
   - `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`
   - Mirror `AZURE_*` if used by mail helpers
   - Never commit values; never echo in chat/logs
4. Smoke with dry-run (cutover unset): synthetic hire → audit `mode: dry_run`.
5. Enable pilot: `MS_GRAPH_CREATE_USERS=1` + `IDENTITY_ENTITY_CUTOVER=ENT-FIRM` (or ENT-R619) on Preview first.
6. Run smoke create → disable → delete/cleanup synthetic UPN.
7. Keep `IDENTITY_JOINER_ENABLED=1` (default). Prefer leaving create-users off until smoke passes; then cutover firm + Recruit 619.

## CA / APP security checklist (P5 — sheet 14)

Document / apply in Entra Conditional Access + Intune (IaC applied only where Graph app already has Policy.* — default = human portal):

| ID | Control | Target |
| --- | --- | --- |
| CA-001 | Require MFA for all cloud apps | All users; break-glass exclude |
| CA-002 | Block legacy auth | All |
| CA-003 | Require compliant **or** Hybrid Azure AD join for company devices | Company / Autopilot/ADE cohort |
| CA-004 | Require approved client app + App Protection for BYOD | `grp-*-byod` / personal_byod |
| APP-01 | iOS/Android App Protection — encrypt work data, selective wipe | BYOD |
| APP-02 | Windows / macOS info protection where licensed | Pilot |
| BG-01 | Break-glass accounts sealed dual-control vault | 2× emergency |

Sheet 22: identity cutover before enforcing CA-003 hard require.

## ADE / ABM (P3 — NEED_HUMAN)

- Apple Business Manager under parent; Intune MDM server assignment; ADE default profile.
- Blocked until ABM/App Store Connect session (portal currently login wall).
- Tokens / ADE profiles stay NEED_HUMAN; workers remain dry-run for Autopilot/ADE assign.

## NEED_HUMAN (remaining blockers)

1. ~~**Entra admin consent**~~ — **DONE** (`User.ReadWrite.All` + Directory/GroupMember/Org/Intune device R/W Granted). PrivilegedOperations GUID still Not granted (optional wipe later)
2. ~~**Graph client secret in Vercel**~~ — **DONE** (Production + Preview; local `.env.local` for smoke). Token client-credentials HTTP 200 with `User.ReadWrite.All`
3. **Flip live create after synth smoke** — set `MS_GRAPH_CREATE_USERS=1` + `IDENTITY_ENTITY_CUTOVER=ENT-FIRM,ENT-R619` (redeploy)
4. **Apple ADE / ABM tokens** — company zero-touch Mac/iOS (P3); App Store Connect login wall
5. **Conditional Access / APP BYOD tenant apply** — checklist in this runbook; Security sign-off (P5 / P3b)
6. **Break-glass sealed dual-control vault** — P5
7. **M365 license pool confirmation** — P2 GBL
8. **Remote Help helper licenses** — P8 ops
9. **SCIM pilot app endpoint** — set `IDENTITY_SCIM_ENABLED=1` after product row ready
