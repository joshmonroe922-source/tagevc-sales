# Phase 57 — HR + IT Production Hardening

Phase 57 hardens HR + IT production flows: onboarding/offboarding run
completeness, asset/license assignment visibility, access revocation evidence,
Intune dual-approve inbox usability, and exception aging + escalations.
High-risk actions remain dual-approved. Breakers are never auto-closed without
dual-approve. Reuses multi-sub identity lifecycle (P5) and the Phase 51 Intune
dual-approve inbox where present.

## Surface

- HR operations → `/shared-services/hr` (new live hub card + page)
- IT assets → `/shared-services/it/assets` (extended; Phase 57 panel)
- Run completeness KPIs (onboarding / offboarding / identity lifecycle)
- Assignment visibility (hardware + license seats)
- Access revocation evidence (observe-only; execute gated)
- Intune dual-approve inbox aging (stale >24h / critical >72h)
- Exception aging + escalation panels
- High-risk propose + dual-approve gate (operator executes after gate)
- Subsidiary visibility (`ENT-R619` first; `ENT-INDA` when evidence exists)

## Data

Apply `tagevc-os/supabase/phase57_hr_it_hardening.sql` after Phase 56.

- `os_hr_it_run_completeness_phase57_snapshots` — run completeness board
- `os_hr_it_assignment_visibility_phase57_events` — asset/license visibility
- `os_hr_it_access_revocation_phase57_evidence` — revocation observe evidence
  (`access_revoke_executed` always false)
- `os_hr_it_exception_aging_phase57_alerts` / `_escalation_phase57_events`
- `os_hr_it_high_risk_phase57_proposals` / `_approvals` — dual-approve gates
  (`breaker_auto_closed` always false)
- `os_hr_it_dual_approve_inbox_phase57_snapshots` — inbox usability evidence
- `os_hr_it_subsidiary_phase57_events` — R619 / INDA visibility
- `os_hr_it_phase57_ops_alerts` — ops visibility alerts
- `refresh_hr_it_hardening_phase57` — probes IT run/asset tables + P5
  identity lifecycle + Phase 51 inbox fail-soft
- `get_hr_it_hardening_phase57_report` — entity-scoped report
- `list_hr_it_dual_approve_inbox_phase57` — aging wrapper over Phase 51
- `propose_hr_it_high_risk_phase57` / `approve_hr_it_high_risk_phase57`
- `record_hr_it_escalation_phase57` — append-only escalations

Safe metadata denylist via `phase57_hr_it_safe_detail`.
`os_sha256_hex` uses `search_path = public, extensions`.
Contract: `phase57-v1`.

## App

- `src/lib/shared-services/hr-it-hardening-phase57.ts` — contracts + stubs
- `src/lib/shared-services/hr-it-hardening-phase57-server.ts` — RPC helpers
- `src/app/(app)/shared-services/hr/` — page + server actions
- `src/components/shared-services/hr-it-hardening-phase57-client.tsx` — UI
- IT assets page + dual-approve inbox aging labels
- Hub HR card marked **live**; IT card description updated

## Verify

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

## Phase 58 note

**Phase 58 = Marketing hardening**. Do not start Phase 58 from this phase’s
HR/IT workstream without an explicit go-ahead.

## Phase 58+ recommendations

1. Wire live Recruit/INDA HR run feeds so subsidiaries move from `missing`
   → `ok`/`partial`.
2. Attach per-run revocation checklist evidence beyond observe stubs.
3. Continue Intune dual-approve soak (Phases 49–52 rails remain).
4. Still out of scope here: auto-close breakers, silent access revoke,
   Marketing hardening (Phase 58).
