# Phase 61 — Firm Ops Command Completeness

Phase 61 completes Firm Ops command surfaces on `/command-center`: critical
alerts across services, action queues for Visionary/COO/Service Leads,
stale-item and breach visibility, and quick navigation into every major
module. Reuses Phase 54–60 evidence (fail-soft). Entity-aware. Never drops
snapshot retirement tables. Never auto-approves money.

## Surface

- Command Center → `/command-center` (Phase 61 Firm Ops panel + module nav)
- Critical alerts rollup (Shared Services · Finance · Legal · HR/IT ·
  Marketing · Notifications · Portfolio)
- Action queues: Visionary / COO / Service Leads
- Stale / breach board by domain
- Module quick-nav (Deal Flow · Portfolio · SS · Finance · Legal · Marketing ·
  Firm · Documents · Entities · Recruit 619 · Activity · Messages · prefs)

## Data

Apply `tagevc-os/supabase/phase61_firm_ops_command.sql` after Phase 60.

- `os_firm_ops_alert_phase61_snapshots` — critical alerts board
- `os_firm_ops_queue_phase61_snapshots` — role action queues
- `os_firm_ops_stale_breach_phase61_snapshots` — stale/breach visibility
- `os_firm_ops_module_nav_phase61_links` — module quick-nav evidence
- `os_firm_ops_phase61_ops_alerts` — ops visibility alerts
- `refresh_firm_ops_command_phase61` — probes Phase 54–60 tables fail-soft
- `get_firm_ops_command_phase61_report` — entity-scoped report

Safe metadata denylist via `phase61_firm_ops_safe_detail`.
`os_sha256_hex` uses `search_path = public, extensions`.
Contract: `phase61-v1`. `money_auto_approve=false` enforced on detail checks.

## App

- `src/lib/firm-ops/firm-ops-command-phase61.ts` — contracts + stubs
- `src/lib/firm-ops/firm-ops-command-phase61-server.ts` — RPC helpers
- `src/components/firm-ops/firm-ops-command-phase61-client.tsx` — UI
- Command Center page + `refreshFirmOpsCommandPhase61Action`
  (RBAC via `write:shared_services`)

## Verify

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

## Phase 62 note

**Phase 62 = Audit, Evidence, and Admin Export Pack**. Do not start Phase 62
from this phase’s Firm Ops command workstream without an explicit go-ahead.

## Phase 62+ recommendations

1. Wire audit/evidence export pack (Phase 62).
2. Attach Firm Ops critical alerts into Phase 59 digest routing.
3. Continue Stage 4e soak; do not drop snapshot retirement tables.
4. Still out of scope here: autonomous money/capital actions, dropping
   `os_store_snapshots`, audit export pack (Phase 62).
