# Phase 51 — Auto-Propose Promotions, Firm-Wide Cadence Trends + Third-Approver Escalation, Unified Dual-Approve Inbox, Per-Owner SLO Trends, Required-Check Evidence + Page-Failure Escalation

Phase 51 advances Phase 50 rails with a scheduled soak-clock that
auto-*proposes* (never auto-approves) marketing promotions for soaked-healthy
auto-reject cohorts, firm-wide DocuSign cadence trend rollups plus
third-approver escalation for unanswered second-approver reminders, a
unified Intune dual-approve inbox spanning postmortem/breaker/waive
approvals, per-owner SLO trend charts on the opt-in self-serve digest failure
view, and Snapshot required-check evidence recording plus escalation when a
page receipt itself fails delivery. `os_store_snapshots` is never mentioned
or mutated.

## Marketing

- `auto_propose_marketing_dry_run_promote_phase51` scans cohorts that have
  had `MARKETING_PHASE51_AUTO_PROPOSE_WINDOWS` (default 3) consecutive
  healthy Phase 50 audit-export/readiness windows and inserts a **pending**
  promotion proposal row. It never calls the Phase 50 approve/promote RPC —
  it only proposes; two distinct human approvers must still act via the
  existing Phase 50 dual-approve path before any money moves.
- `os_marketing_revenue_phase51_auto_propose_runs` is an append-only record
  of every auto-propose run (cohort scanned, proposed/skipped/errored) for
  audit visibility.
- `os_marketing_revenue_phase51_ops_alerts` + `list_marketing_revenue_phase51_critical_windows`
  surface critical proposal/readiness windows.
- `get_marketing_revenue_phase51_ops_report` — cohort readiness + auto-propose
  status visibility for the Marketing hub UI.
- Money is never auto-approved: `approve_marketing_dry_run_promote_phase50`
  is never called by Phase 51 code.

Apply `supabase/phase51_marketing_revenue_ops.sql` after Phase 50 marketing.

## DocuSign

- `record_docusign_cadence_rollup_phase51` rolls up Phase 50's per-entity
  cadence SLO trends into a **firm-wide** multi-quarter trend snapshot
  (`os_docusign_archive_phase51_cadence_rollups`).
- `record_docusign_third_approver_escalation_phase51` raises a third-approver
  escalation receipt (`os_docusign_archive_third_approver_escalations`) when
  a pending budget-revision second-approver reminder has gone unanswered for
  more than `DOCUSIGN_PHASE51_ESCALATION_THRESHOLD_DAYS` (default 3) days.
  Escalations are notification/visibility-only — they never activate a
  budget and never create, void, or resend an envelope.
- `list_docusign_archive_phase51_critical_windows` + `os_docusign_archive_phase51_ops_alerts`
  surface pending escalations.
- `get_docusign_archive_phase51_ops_report` — firm-wide cadence trend +
  pending escalation visibility for the DocuSign hub UI
  (`DocuSignHubActions`).

Apply `supabase/phase51_docusign_archive_ops.sql` after Phase 50 DocuSign.

## Intune

- `list_it_intune_dual_approve_inbox_phase51` unifies pending first/second
  approvals across postmortem suggestions, breaker tuning, and waive
  promotions into a single inbox view — purely additive visibility; it never
  applies, approves, or auto-closes/resets anything itself. Existing
  single-reviewer and Phase 50 dual-approve paths are unchanged.
- `it_intune_phase51_sanitize_aggregate` strips entity identifiers from
  aggregate counts to prevent entity ID leaks.
- `record_it_intune_phase51_inbox_snapshot` + `os_it_intune_phase51_inbox_snapshots`
  record append-only point-in-time inbox size snapshots (total pending,
  postmortem/breaker/waive breakdown) for backlog trend visibility.
- `list_it_intune_phase51_critical_windows` + `os_it_intune_phase51_ops_alerts`
  flag backlog/stale-item conditions.
- `get_it_intune_phase51_ops_report` — unified inbox metrics for the IT
  assets page (`ItAssetsClient`), with a manual "Refresh unified dual-approve
  inbox" action.

Apply `supabase/phase51_intune_resilience_ops.sql` after Phase 50 Intune.

## Shared Services and observability

- `list_slo_owner_digest_self_serve_trend_phase51` builds a per-owner trend
  *series* (not just a single WoW comparison) from the existing Phase 50
  week-over-week digest delivery success snapshots, for opted-in owners on
  the self-serve failure view.
- `get_slo_phase51_owner_digest_report` — governance visibility surfaced via
  `SloPolicyAdmin`.
- Still pull-only: the owner must opt in and explicitly request the view;
  nothing is pushed. Not a full push notification system.

Apply `supabase/phase51_slo_governance_ops.sql` after Phase 50 SLO.

## Snapshot retirement

- `escalate_snapshot_phase51_page_delivery_failures` scans Phase 50
  `protected_branch_cutover_blocked` page receipts whose own delivery
  `status='failed'` (with no later `sent` receipt for the same alert) and
  raises an append-only escalation
  (`os_snapshot_phase51_page_failure_escalations`) plus a critical
  `page_delivery_escalated` ops alert. Never retries delivery itself (that
  remains the TS worker's job) and never mutates the Phase 49/50 rows.
- `record_snapshot_phase51_required_check_verification` (service-role only)
  records read-only evidence of whether the CI path-guard is configured as a
  **required** GitHub status check on the protected branch — branch name,
  check-context name, and a boolean only, never a token. Raises a critical
  `required_check_missing` alert when `required=false`.
- `.github/workflows/snapshot-path-guard.yml` runs
  `node scripts/ci-snapshot-phase50-path-guard.mjs --check` as a PR check
  named `ci-snapshot-phase50-path-guard` on every PR against `main`. Making
  it *actually* required is a one-time repo-admin action: Settings →
  Branches → Branch protection rules → Require status checks to pass → add
  `ci-snapshot-phase50-path-guard`. Phase 51's verification RPC only records
  evidence of that state — it never mutates branch protection itself.
- `record_snapshot_phase51_soak_trend` continues Stage 4e soak observation by
  rolling up the last few Phase 50 soak-status snapshots into a trend
  direction (`improving`/`stable`/`declining`/`unknown`); a `declining` trend
  raises a warning `soak_trend_declining` alert.
- `get_snapshot_phase51_ops_report` surfaces all of the above (plus the
  Phase 50 dashboard) for the Snapshot retirement admin panel.
- Phase 51 contains no insert, update, delete, rename, alter, truncate, or
  drop against `os_store_snapshots`.

Apply `supabase/phase51_snapshot_cutover_ops.sql` after Phase 50 snapshot.

Optional env: `MARKETING_PHASE51_AUTO_PROPOSE_WINDOWS` (default 3),
`DOCUSIGN_PHASE51_ESCALATION_THRESHOLD_DAYS` (default 3); reuse
`SNAPSHOT_PHASE50_PAGE_WEBHOOK_URL`, `SNAPSHOT_PHASE50_PAGE_DESTINATION_KEY`,
`SNAPSHOT_CI_CHECK_EXIT_CODE`, `SNAPSHOT_CI_PROTECTED_BRANCH_REQUIRED`,
`SNAPSHOT_CI_CUTOVER_ENABLED`, `SLO_OWNER_DIGEST_WEBHOOKS`,
`SLO_WEBHOOK_OPS_ALERTS`, `SLO_WEBHOOK_ALLOWED_HOSTS`.

## Deployment order

Apply after all Phase 50 migrations:

1. `phase51_marketing_revenue_ops.sql`
2. `phase51_docusign_archive_ops.sql`
3. `phase51_intune_resilience_ops.sql`
4. `phase51_slo_governance_ops.sql`
5. `phase51_snapshot_cutover_ops.sql`

Also merge `.github/workflows/snapshot-path-guard.yml` and then mark
`ci-snapshot-phase50-path-guard` as a required status check in branch
protection settings (see Snapshot retirement section above).

Verify:

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

## Phase 52+ recommendations

1. Marketing: once auto-propose has run stably for a soak period, consider
   surfacing a firm-wide "pending proposals awaiting first/second approval"
   digest so approvers do not need to visit the Marketing hub to notice new
   auto-proposals.
2. DocuSign: extend third-approver escalation with a configurable escalation
   *chain* (third → fourth approver) for budgets that remain stuck after the
   third approver also does not respond, still never auto-activating.
3. Intune: add per-category (postmortem/breaker/waive) backlog trend charts
   on top of the Phase 51 unified inbox snapshots, reusing the same
   week-over-week trend pattern as Shared Services.
4. Shared Services: consider a firm-wide (not just self-serve, opt-in)
   *summary* trend view for admins — still pull-only, still not push, but
   removing the need to check each owner individually.
5. Snapshot: once the path-guard is confirmed required on `main` in
   production GitHub settings, extend `record_snapshot_phase51_required_check_verification`
   invocation into a small scheduled script (cron) that calls the GitHub
   branch-protection API read-only and records evidence automatically,
   rather than requiring a manual admin-panel click. Continue Stage 4e soak;
   do not drop `os_store_snapshots`.
6. Still out of scope: full push notifications, user admin UI, major new
   modules.
