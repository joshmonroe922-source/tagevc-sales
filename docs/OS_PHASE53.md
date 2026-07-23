# Phase 53 — Subsidiary Rollup Hub (Recruit first)

Phase 53 adds a Subsidiary Rollup Hub for Recruit 619 (`ENT-R619`) on the
existing Entity Operating System surface (`/entities` +
`/entities/ENT-R619`), not a new top-level module. Metrics cover open reqs,
pipeline volume, submissions, interviews, offers, placements, source mix, and
time-to-fill/place where available, with explicit data-freshness indicators.
`os_store_snapshots` is never mentioned or mutated. Money is never
auto-approved.

## Surface

- Entities index callout → `/entities/ENT-R619#rollup`
- Entity OS panel section **Rollup** (Phase 53 badge + freshness/feed status)
- Sidebar nav (Visionary / COO via `portfolio` module): **Recruit 619 Rollup**
- Drill-downs to `https://portal.recruit619.com` (jobs / pipeline / placements)

## Data

Apply `tagevc-os/supabase/phase53_subsidiary_rollup_ops.sql` after Phase 52.

- `os_subsidiary_rollup_phase53_snapshots` — append-only ENT-R619 rollup
  evidence (metrics + freshness + feed_status + safe detail)
- `os_subsidiary_rollup_phase53_ops_alerts` — feed_missing / feed_partial
  visibility alerts
- `refresh_subsidiary_rollup_phase53` — probes optional feed tables
  (`os_recruit_feed_metrics`, `recruiting_kpi_facts`); fail-softs to empty
  metrics with `freshness=unknown` when absent
- `get_subsidiary_rollup_phase53_report` — entity-scoped report for Entity OS

Safe metadata denylist via `phase53_subsidiary_rollup_safe_detail`.
`os_sha256_hex` uses `search_path = public, extensions`.

## App

- `src/lib/data/subsidiary-rollup-phase53.ts` — report + refresh helpers with
  empty stubs (`TODO` until live Recruit feed)
- Wired through `getEntityOperatingView` → `EntityOperatingViewPanel`
- `refreshSubsidiaryRollupPhase53Action` on Entities (RBAC via
  `canAccessEntityId`)

## Verify

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

## Phase 54+ recommendations

1. **Shared Services inbox next** — firm-wide Shared Services inbox for
   pending dual-approvals / digests across Legal · IT · Marketing, still
   pull-only and never auto-approving money.
2. Wire live Recruit portal feed (`os_recruit_feed_metrics`) so Phase 53
   freshness moves from `unknown` → `fresh`/`partial` with real source mix
   and time-to-fill/place.
3. Extend Subsidiary Rollup Hub to the next operating subsidiary after Recruit
   soak (same Entity OS section pattern).
4. Continue Stage 4e soak; do not drop `os_store_snapshots`.
5. Still out of scope: full push notifications, user admin UI, Finance/HR
   pages (do not block on them).
