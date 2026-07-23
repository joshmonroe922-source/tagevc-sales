# Phase 60 — Portfolio Operating Cadence

Phase 60 ships weekly Visionary/COO portfolio operating cadence tools on
`/portfolio`: company health board, risk/milestone tracking, operating review
packets, handoff completeness indicators, and subsidiary linkage
(`ENT-R619` first; `ENT-INDA` when present). Extends Portfolio Active; does not
drop snapshot retirement tables.

## Surface

- Portfolio Active → `/portfolio` (extended; Phase 60 cadence panel)
- Health board KPIs (On Track / Watch / At Risk / Critical + attention)
- Risk / milestone tracking (append-only events)
- Operating review packets (weekly ops / monthly board / deep-dive)
- Handoff completeness indicators (from `os_handoffs`)
- Subsidiary links: Recruit `ENT-R619` first; Instant NDA `ENT-INDA` when present

## Data

Apply `tagevc-os/supabase/phase60_portfolio_operating_cadence.sql` after Phase 59.

- `os_portfolio_health_phase60_snapshots` — company health board
- `os_portfolio_risk_milestone_phase60_events` — risk/milestone tracking
- `os_portfolio_review_packet_phase60_events` — operating review packets
- `os_portfolio_handoff_phase60_snapshots` — handoff completeness
- `os_portfolio_subsidiary_phase60_links` — subsidiary linkage evidence
- `os_portfolio_phase60_ops_alerts` — ops visibility alerts
- `refresh_portfolio_operating_cadence_phase60` — probes portfolio_companies /
  os_handoffs / entities fail-soft
- `get_portfolio_operating_cadence_phase60_report` — entity-scoped report
- `record_portfolio_risk_milestone_phase60` / `record_portfolio_review_packet_phase60`

Safe metadata denylist via `phase60_portfolio_safe_detail`.
`os_sha256_hex` uses `search_path = public, extensions`.
Contract: `phase60-v1`.

## App

- `src/lib/portfolio/operating-cadence-phase60.ts` — contracts + stubs
- `src/lib/portfolio/operating-cadence-phase60-server.ts` — RPC helpers
- `src/components/portfolio/operating-cadence-phase60-client.tsx` — UI
- Portfolio page + actions extended for Phase 60 refresh / risk-milestone /
  review packet recording

## Verify

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

## Phase 61 note

**Phase 61 = Firm Ops command completeness**. Do not start Phase 61 from this
phase’s portfolio cadence workstream without an explicit go-ahead.

## Phase 61+ recommendations

1. Wire Firm Ops command completeness (Phase 61).
2. Attach critical portfolio attention alerts into Phase 59 routing.
3. Continue Stage 4e soak; do not drop snapshot retirement tables.
4. Still out of scope here: autonomous portfolio mutations, dropping
   `os_store_snapshots`, Firm Ops command completeness (Phase 61).
