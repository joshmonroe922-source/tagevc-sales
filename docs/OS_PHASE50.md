# Phase 50 — Dual-Approve Promote, Cadence Trend Dashboards, Extended Dual-Approve, WoW SLO Trends, Cutover Paging + CI Enforcement

Phase 50 advances Phase 49 rails with gated dual-approved promotion from
marketing dry-run to actual promote for soaked-healthy auto-reject cohorts,
multi-quarter DocuSign cadence SLO trend dashboards plus second-approver
reminders for pending budget revisions, Intune dual-approve extended to
breaker tuning and waive promotions, week-over-week owner digest delivery
success SLO trends with an opt-in self-serve failure view, and
protected-branch cutover-blocked paging/alerting plus CI `--check`
enforcement evidence for cutover-adjacent PRs. `os_store_snapshots` is never
mentioned or mutated.

## Marketing

- Promotion proposals from dry-run: a human proposes promoting a
  soaked-healthy auto-reject cohort out of dry-run into an actual promote.
  Proposals are distinct rows from any live promote action.
- Dual approval: 2 distinct human approvers are required before
  `approve_marketing_dry_run_promote_phase50` calls into the existing
  promote-cohort RPC. Money is never auto-approved — the first approval only
  records intent; the promote RPC is only invoked on the second, distinct
  approval.
- Cohort readiness snapshots surface promotion-readiness / health visibility
  (soak duration, dry-run consistency) without changing autonomy.
- Ops alerts on critical proposal/readiness windows via the existing
  allowlisted ops webhook pattern.

Apply `supabase/phase50_marketing_revenue_ops.sql` after Phase 49 marketing.

## DocuSign

- Cadence SLO trend snapshots roll up Phase 49's per-quarter cadence SLOs
  into multi-quarter trend lines (improving / stable / declining) per
  entity, for dashboard visibility.
- Second-approver reminders: read-only scan for budget revision proposals
  that have exactly one approval and are awaiting a second, distinct
  approver; reminders are recorded as append-only receipts and delivered via
  the existing allowlisted ops webhook (not full push).
- Recurring quarterly process visibility snapshots extend Phase 46/47's
  recurring-process tracking with clearer historical rollups.
- Workers still never create/void/resend envelopes.

Apply `supabase/phase50_docusign_archive_ops.sql` after Phase 49 DocuSign.

## Intune

- Breaker tuning dual-approve: extends the Phase 49 "propose → 2 distinct
  approvers → apply" pattern to breaker tuning suggestions. Only after two
  distinct human approvals does the Phase 50 gate call the existing
  single-reviewer `review_it_intune_breaker_tuning` RPC (using the second
  approver's identity, satisfying its reviewer-is-not-proposer constraint).
- Waive promotion dual-approve: same pattern applied to waive promotion
  suggestions, gating `review_it_intune_promote_waive_phase46`.
- Apply-event visibility snapshots show suggested vs applied configuration
  for both breaker tuning and waive promotions, with entity identifiers
  sanitized out of aggregates.
- Existing single-reviewer UI paths continue to work unchanged; the Phase 50
  dual-approve gate is an additive, opt-in-per-proposal path. Observe-only
  layers stay observe-only unless routed through this dual-approve apply
  path.
- Never auto-closes or resets breakers; no entity ID leaks in aggregates.

Apply `supabase/phase50_intune_resilience_ops.sql` after Phase 49 Intune.

## Shared Services and observability

- Week-over-week trend snapshots compare each owner's latest Phase 49 digest
  delivery success SLO snapshot against the closest snapshot at least 7 days
  earlier, classifying the trend as improving / stable / declining.
- Opt-in self-serve failure view: an owner (or firm-wide actor) can opt an
  owner in to viewing their own recent digest delivery failures. The
  self-serve view is pull-only — the owner must explicitly opt in and then
  explicitly request the view; nothing is pushed.
- Governance report (`get_slo_phase50_owner_digest_report`) surfaces
  improving/stable/declining counts and opt-in adoption directly in the
  Shared Services hub via `SloPolicyAdmin`.
- Still not a full push notification system.

Apply `supabase/phase50_slo_governance_ops.sql` after Phase 49 SLO.

## Snapshot retirement

- Page/alert receipts record delivery outcomes (sent/failed/skipped) for
  Phase 49's `protected_branch_cutover_blocked` ops alerts via an
  allowlisted, best-effort webhook. Delivery is never silently dropped — the
  outcome is always recorded, and failed deliveries raise a Phase 50
  `page_delivery_failed` alert.
- CI `--check` enforcement evidence: `record_snapshot_phase50_ci_check_enforcement`
  records whether the CI offline_script dual-acceptance `--check` gate
  passed for a run, and whether any changed path was "cutover-adjacent"
  (classified by `snapshot_path_is_cutover_adjacent_phase50`, mirrored in
  `scripts/ci-snapshot-phase50-path-guard.mjs`). A cutover-adjacent PR whose
  check did not pass raises a critical
  `ci_check_missing_on_cutover_adjacent_pr` alert.
- Stage 4e soak status snapshots roll up the last 7 days of Phase 49
  enforcement events (allowed/blocked counts and rate) into an append-only
  health snapshot, continuing the soak observation; a high blocked rate
  raises a `soak_at_risk` alert.
- `scripts/ci-snapshot-phase50-path-guard.mjs --check` is a new companion CI
  script that classifies changed paths and, for cutover-adjacent PRs, runs
  (or accepts a pre-computed exit code from) `ci-snapshot-cutover-accept.mjs
  --check`, failing closed (exit 2) if that gate did not pass. Non-adjacent
  PRs pass through unaffected (exit 0).
- Continues Stage 4e soak; non-qualifying flags always false.
- Phase 50 contains no insert, update, delete, rename, alter, truncate, or
  drop against `os_store_snapshots`.

Apply `supabase/phase50_snapshot_cutover_ops.sql` after Phase 49 snapshot.

Optional env: `SNAPSHOT_PHASE50_PAGE_WEBHOOK_URL`,
`SNAPSHOT_PHASE50_PAGE_DESTINATION_KEY` (default `oncall`),
`SNAPSHOT_CI_CHECK_EXIT_CODE` (reuse a prior `--check` exit code in the same
CI job); reuse `SNAPSHOT_CI_PROTECTED_BRANCH_REQUIRED`,
`SNAPSHOT_CI_CUTOVER_ENABLED`, `SLO_OWNER_DIGEST_WEBHOOKS`,
`SLO_WEBHOOK_OPS_ALERTS`, `SLO_WEBHOOK_ALLOWED_HOSTS`.

## Deployment order

Apply after all Phase 49 migrations:

1. `phase50_marketing_revenue_ops.sql`
2. `phase50_docusign_archive_ops.sql`
3. `phase50_intune_resilience_ops.sql`
4. `phase50_slo_governance_ops.sql`
5. `phase50_snapshot_cutover_ops.sql`

Verify:

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

## Phase 51+ recommendations

1. Marketing: extend the dual-approve promote pattern with a scheduled
   "soak clock" that auto-*proposes* (never auto-approves) promotion once a
   cohort has stayed healthy for N consecutive audit-export windows, so
   humans only need to review and approve rather than notice and propose.
2. DocuSign: a firm-wide cadence trend rollup dashboard across all entities
   (currently per-entity), plus escalation to a third approver if a budget
   revision proposal's second-approver reminder goes unanswered for a
   configurable number of days.
3. Intune: a single unified dual-approve inbox spanning postmortem publish,
   breaker tuning, and waive promotions, so reviewers do not need to check
   three separate surfaces for pending second approvals.
4. Shared Services: extend the opt-in self-serve view with a per-owner
   trend chart (reusing the Phase 50 WoW snapshots) — still pull-only, still
   not a full push system.
5. Snapshot: extend the CI path-guard script to run automatically as a
   required GitHub Actions status check on every PR (not just invoked
   manually), and consider paging escalation (e.g. a second on-call
   destination) if a `protected_branch_cutover_blocked` page receipt itself
   fails. Continue Stage 4e soak; do not drop `os_store_snapshots`.
6. Still out of scope: full push notifications, user admin UI, major new
   modules.
