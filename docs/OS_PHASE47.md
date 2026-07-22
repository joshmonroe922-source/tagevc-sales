# Phase 47 — Cohort Promotion, Recurring Cadence, and Ack SLOs

Phase 47 advances Phase 46 rails with multi-entity auto-reject promotion
cohorts and attribution conflict closures, the first armed DocuSign recurring
quarterly under tightened drift budgets, dual-approver Intune waive expiry with
scorecard↔MTTR correlation, owner notify on published handoff digests, and
offline-script-required snapshot cutovers with on-call acknowledgment SLOs.
`os_store_snapshots` is never mutated.

## Marketing

- Multi-entity / firm-wide promotion cohorts; gate requires healthy webhook
  delivery SLOs across all cohort entities before promote.
- Maker-checker attribution conflict closure workflow with aging visibility.
- Ops alerts for blocked cohort promotions, aging conflicts, and pending
  closures.
- Worker runs Phase 47 after Phase 46; hub badges for cohort gate, conflict
  aging, and closures.

Apply `supabase/phase47_marketing_revenue_ops.sql` after Phase 46 marketing.

## DocuSign

- First armed recurring quarterly run under activated tightened drift budgets
  (blocked / completed / drift_budget_breach evidence; never creates envelopes).
- Recurring quarterly reports for hub visibility into run status and drift
  performance.
- Ops alerts: recurring run blocked, drift breach during quarterly, first
  recurring completed, cadence report ready.
- Bootstraps Phase 46 arm/completion tables when missing for re-runnability.

Apply `supabase/phase47_docusign_archive_ops.sql` after Phase 46 DocuSign.

## Intune

- Dual-approver waive expiry actions (`extend` / `expire`); Accept blocks
  expired waives unless TTL was dual-approved-extended.
- Scorecard ↔ soak-cycle MTTR correlation (`cycle_elapsed_minutes`) with
  mismatch alerts.
- Never closes or resets breakers; no entity identifier leaks.

Apply `supabase/phase47_intune_resilience_ops.sql` after Phase 46 Intune.

## Shared Services and observability

- Notify owners when quarterly handoff digests publish via append-only
  notification ledger (destination_key + owner_id + delivery_status — not a
  full push notification system).
- Richer ownership-change visibility with upcoming handoff windows and alerts.
- Governance report surfaces notify outcomes and ownership visibility.

Apply `supabase/phase47_slo_governance_ops.sql` after Phase 46 SLO.

## Snapshot retirement

- Cutover default path requires `offline_script` as one of the dual
  acceptances (plus one other verifier kind); wraps Phase 46 complete.
- On-call acknowledgment SLO snapshots and `consecutive_ack_overdue` alerts.
- Continues Stage 4e soak and attestation governance with
  `qualification_eligible`, `attestation_eligible`, and
  `production_relation_mutated` always false.
- Phase 47 contains no insert, update, delete, rename, alter, truncate, or
  drop against `os_store_snapshots`.

Apply `supabase/phase47_snapshot_cutover_ops.sql` after Phase 46 snapshot.

Optional env: `SNAPSHOT_ONCALL_ACK_SLO_MINUTES` (default 60).

## Deployment order

Apply after all Phase 46 migrations:

1. `phase47_marketing_revenue_ops.sql`
2. `phase47_docusign_archive_ops.sql`
3. `phase47_intune_resilience_ops.sql`
4. `phase47_slo_governance_ops.sql`
5. `phase47_snapshot_cutover_ops.sql`

In the Supabase SQL editor, choose **Run without RLS** when the dialog warns
about RLS (migrations already enable RLS). Deploy the application immediately
after the migrations.

Verify:

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

## Phase 48+ recommendations

1. Autopilot cohort promotion for healthy multi-entity windows; archive closed
   conflict cohorts with audit export.
2. Schedule subsequent DocuSign recurring quarterlies from Phase 47 run
   evidence; tighten budgets when drift_budget_breach rates stay elevated.
3. Feed MTTR↔scorecard correlations into postmortem templates; page on
   waive_expired without extend.
4. Expand digest notify destinations with allowlisted owner webhooks; track
   notification delivery SLOs (still not full push).
5. Enforce offline_script dual acceptance in CI verify-script; on-call ack
   SLO dashboards tied to paging rotations.
6. Continue Stage 4e soak and attestation governance. Do not drop
   `os_store_snapshots` without the separately approved retirement operation.
7. Still out of scope until explicitly approved: full push notifications, user
   admin UI, major new modules.
