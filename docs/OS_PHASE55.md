# Phase 55 — Finance Control Plane (IES orchestration)

Phase 55 adds the Shared Services **Finance control plane** at
`/shared-services/finance`. Tage orchestrates and observes only — **Intuit
Enterprise Suite (IES) remains the system of record**. KPI panels, month-end /
year-end close checklist orchestration, anomaly alerts, and dual-approve gates
for write-back-style proposals ship with fail-soft stubs when the IES feed is
absent. Money is never auto-approved. Tage never silently writes to IES.
`os_store_snapshots` is never mentioned or mutated.

## Surface

- Shared Services hub Finance card → `/shared-services/finance` (live)
- KPI panels (cash / AR / AP / burn / close % / anomalies)
- Month-end close checklist (append-only events)
- Anomaly alerts + subsidiary visibility (`ENT-R619` first; `ENT-INDA` when
  evidence exists)
- Dual-approve write-back proposals (propose → 2 distinct human approvers →
  operator executes in IES)

## Data

Apply `tagevc-os/supabase/phase55_finance_control_plane.sql` after Phase 54.

- `os_finance_kpi_phase55_snapshots` — append-only KPI board snapshots
- `os_finance_close_checklist_phase55_events` — append-only close checklist
- `os_finance_anomaly_phase55_alerts` — anomaly evidence
- `os_finance_writeback_phase55_proposals` / `_approvals` — dual-approve gates
  (propose only; `ies_write_executed` always false)
- `os_finance_phase55_ops_alerts` — feed / write-back visibility alerts
- `refresh_finance_control_plane_phase55` — probes optional
  `os_ies_finance_feed` / `ies_kpi_facts`; fail-softs to `feed_status=missing`
- `get_finance_control_plane_phase55_report` — entity-scoped report
- `propose_finance_writeback_phase55` / `approve_finance_writeback_phase55` —
  human gates only

Safe metadata denylist via `phase55_finance_safe_detail`.
`os_sha256_hex` uses `search_path = public, extensions`.
Contract: `phase55-v1`.

## App

- `src/lib/shared-services/finance-control-plane-phase55.ts` — contracts + stubs
- `src/lib/shared-services/finance-control-plane-phase55-server.ts` — RPC helpers
- `src/app/(app)/shared-services/finance/` — page + server actions
- `src/components/shared-services/finance-control-plane-client.tsx` — operator UI
- Hub card in `modules.ts` marked **live**

## Verify

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

## Phase 56 note

**Phase 56 = Legal / DocuSign hardening** — shipped separately; see
`docs/OS_PHASE56.md`. Do not start Phase 57 from Finance without an explicit
go-ahead.

## Phase 56+ recommendations

1. **Done in Phase 56** — Legal / DocuSign production hardening on the
   DocuSign hub.
2. Wire live IES feed (`os_ies_finance_feed`) so KPI panels move from
   `missing` → `ok`/`partial`.
3. Optional year-end close pack templates beyond month-end stubs.
4. Continue Stage 4e soak; do not drop snapshot retirement tables.
5. Still out of scope here: silent IES writes, money auto-approve, HR+IT
   hardening (Phase 57).
