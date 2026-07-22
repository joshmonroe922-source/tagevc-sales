# Phase 48 — Autopilot Cohorts, Recurring Cadence, and CI Cutover

Phase 48 advances Phase 47 rails with gated cohort autopilot and conflict-cohort
archives, subsequent DocuSign recurring quarterlies with breach-driven budget
tighten, Intune postmortem template suggestions and waive-expired paging,
allowlisted owner digest webhooks with delivery SLOs, and CI offline_script
dual acceptance with on-call ack dashboards. `os_store_snapshots` is never
mutated.

## Marketing

- Autopilot promotion for healthy auto-reject cohorts after N consecutive
  healthy Phase 47 gates (never auto-approves money).
- Append-only archives for closed attribution conflict cohorts with soft-hide
  from default lists.
- Cohort performance snapshots and conflict-resolution visibility/alerts.

Apply `supabase/phase48_marketing_revenue_ops.sql` after Phase 47 marketing.

## DocuSign

- Schedule and run subsequent recurring quarterly archive processes beyond the
  first armed run.
- Tighten drift budgets when breach rates elevate; alert on drift breaches.
- Improved recurring quarterly execution/performance reporting.
- Workers still never create/void/resend envelopes.

Apply `supabase/phase48_docusign_archive_ops.sql` after Phase 47 DocuSign.

## Intune

- Append-only postmortem template suggestions from MTTR↔scorecard correlations
  (`auto_publish=false`; never auto-publishes).
- Paging/alerts on expired waive exceptions via allowlisted ops webhooks.
- Waive lifecycle visibility snapshots.
- Never closes or resets breakers; no entity identifier leaks.

Apply `supabase/phase48_intune_resilience_ops.sql` after Phase 47 Intune.

## Shared Services and observability

- Allowlisted owner digest webhook destinations (not a full push system).
- Handoff digest notification delivery SLO snapshots and visibility.
- Governance report surfaces delivery health.

Apply `supabase/phase48_slo_governance_ops.sql` after Phase 47 SLO.

## Snapshot retirement

- CI-integrated offline_script dual acceptance path for ed25519 cutovers.
- On-call acknowledgment SLO dashboards aggregating Phase 47 ack evidence.
- Continues Stage 4e soak and attestation governance with non-qualifying flags
  always false.
- Phase 48 contains no insert, update, delete, rename, alter, truncate, or
  drop against `os_store_snapshots`.

Apply `supabase/phase48_snapshot_cutover_ops.sql` after Phase 47 snapshot.
If Phase 47 snapshot was skipped, apply `phase47_snapshot_cutover_ops.sql`
first (or rely on Phase 48 bootstrap where present).

Optional env: `SLO_OWNER_DIGEST_WEBHOOKS`, `SNAPSHOT_CI_CUTOVER_ENABLED`,
reuse `SLO_WEBHOOK_OPS_ALERTS` / `SLO_WEBHOOK_ALLOWED_HOSTS`.

## Deployment order

Apply after all Phase 47 migrations:

1. `phase48_marketing_revenue_ops.sql`
2. `phase48_docusign_archive_ops.sql`
3. `phase48_intune_resilience_ops.sql`
4. `phase48_slo_governance_ops.sql`
5. `phase48_snapshot_cutover_ops.sql`

Verify:

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

## Phase 49+ recommendations

1. Autopilot dry-run dashboards and cohort promotion audit exports.
2. Multi-quarter DocuSign cadence SLOs with automatic budget revision proposals.
3. Human-apply postmortem template suggestions with dual-approve publish.
4. Owner digest webhook delivery success SLOs into Shared Services hub.
5. Require CI offline_script acceptance on every cutover in protected branches.
6. Continue Stage 4e soak; do not drop `os_store_snapshots`.
7. Still out of scope: full push notifications, user admin UI, major new modules.
