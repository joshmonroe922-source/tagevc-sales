# Phase 58 — Marketing Production Hardening

Phase 58 hardens Marketing production: approval SLA reliability, publishing
controls, entity brand-voice enforcement, campaign/performance dashboards, and
a Recruit acquisition intelligence panel (Appcast/careers metrics intake) for
`ENT-R619`. Extends `/shared-services/marketing` and existing revenue phase
surfaces. No autonomous money-impacting actions — money gates stay
dual-approved; publish is never executed from the gate.

## Surface

- Marketing hub → `/shared-services/marketing` (extended; Phase 58 panel)
- Approval SLA reliability KPIs (in review / overdue / due soon)
- Publishing controls (schedule job + gated money proposals)
- Entity brand-voice enforcement coverage
- Campaign / performance dashboard (extends Phase 41–52 revenue observe)
- Recruit acquisition intelligence (`ENT-R619` Appcast/careers fail-soft)
- Money-impacting propose + dual-approve gate (operator executes after gate)

## Data

Apply `tagevc-os/supabase/phase58_marketing_hardening.sql` after Phase 57.

- `os_marketing_approval_sla_phase58_snapshots` — SLA reliability board
- `os_marketing_publishing_controls_phase58_events` — publishing controls
- `os_marketing_brand_voice_phase58_enforcement` — brand-voice coverage
- `os_marketing_campaign_perf_phase58_snapshots` — campaign/performance
- `os_marketing_recruit_acquisition_phase58_events` — Appcast/careers intake
- `os_marketing_publish_phase58_proposals` / `_approvals` — dual-approve gates
  (`money_auto_approved` / `publish_executed` always false)
- `os_marketing_phase58_ops_alerts` — ops visibility alerts
- `refresh_marketing_hardening_phase58` — probes content/schedule/voices/
  campaigns fail-soft; never mutates money or executes publish
- `get_marketing_hardening_phase58_report` — entity-scoped report
- `propose_marketing_publish_phase58` / `approve_marketing_publish_phase58`
- `record_recruit_acquisition_intake_phase58` — append-only Appcast/careers stub

Safe metadata denylist via `phase58_marketing_safe_detail`.
`os_sha256_hex` uses `search_path = public, extensions`.
Contract: `phase58-v1`.

## App

- `src/lib/shared-services/marketing-hardening-phase58.ts` — contracts + stubs
- `src/lib/shared-services/marketing-hardening-phase58-server.ts` — RPC helpers
- `src/components/shared-services/marketing-hardening-phase58-client.tsx` — UI
- Marketing page + actions extended for Phase 58 refresh / publish propose /
  dual-approve / Recruit intake stub
- Hub Marketing card marked **live**

## Verify

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

## Phase 59 note

**Phase 59 = practical notifications**. Do not start Phase 59 from this phase’s
Marketing workstream without an explicit go-ahead.

## Phase 59+ recommendations

1. Wire live Appcast/careers feeds so ENT-R619 moves from `missing` →
   `ok`/`partial`.
2. Attach SLA digest email when practical notifications land (Phase 59).
3. Continue revenue phase soak (Phases 41–52 rails remain).
4. Still out of scope here: autonomous paid publish, silent budget changes,
   money auto-approve, full push notifications (Phase 59).
