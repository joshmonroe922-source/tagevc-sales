# Phase 54 — Shared Services Inbox Unification

Phase 54 unifies Shared Services operations for production usability (service
leads first) on the existing `/shared-services` hub. Cross-service tickets
(Finance · Legal · HR · IT · Marketing) share one inbox with SLA boards,
ownership, escalation visibility, entity filters (including `ENT-R619`), and
links to related records/context. `os_store_snapshots` is never mentioned or
mutated. Money is never auto-approved. Dual-approve gates are untouched.

## Surface

- Shared Services hub → `/shared-services#inbox`
- Service / SLA / entity filters (quick filter: `ENT-R619`)
- Query params: `?service=Finance|Legal|HR|IT|Marketing&entity=ENT-R619`
- Finance / HR module cards are **planned stubs** (tickets still unify)

## Data

Apply `tagevc-os/supabase/phase54_shared_services_inbox_ops.sql` after Phase 53.

- `os_ss_inbox_phase54_snapshots` — append-only inbox board snapshots
  (open totals, by_service / by_sla / by_entity, feed_status)
- `os_ss_inbox_phase54_escalations` — append-only SLA / ownership escalation
  evidence (visibility only)
- `os_ss_inbox_phase54_ops_alerts` — feed_missing / feed_partial alerts
- `refresh_shared_services_inbox_phase54` — probes `os_tickets` (prefer) /
  `ss_tickets` (partial); fail-softs to empty board when absent
- `get_shared_services_inbox_phase54_report` — entity-/service-scoped report

Safe metadata denylist via `phase54_ss_inbox_safe_detail`.
`os_sha256_hex` uses `search_path = public, extensions`.

## App

- `src/lib/shared-services/shared-services-inbox-phase54.ts` — report + refresh
  helpers, SLA classification, unified inbox row builder
- `src/components/shared-services/ss-unified-inbox.tsx` — filters + board UI
- Wired through `/shared-services` with `listScopedTickets` + Phase 54 report
- `refreshSharedServicesInboxPhase54Action` (RBAC via `write:shared_services`)
- `getSsHubCardModules` includes Finance/HR planned stubs (TODO until 55/57)

## Verify

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

## Phase 55+ recommendations

1. **Finance control plane next** — IES orchestration: KPI panels, month-end /
   year-end close checklists, anomaly alerts, human approval for write-backs,
   Recruit-first subsidiary financial visibility. IES remains system of record.
2. Continue Stage 4e soak; do not drop `os_store_snapshots`.
3. Wire live SLA digests into optional email when Phase 59 notifications land.
4. Still out of scope here: dedicated Finance/HR pages (stubs OK), full push
   notifications, user admin UI.
