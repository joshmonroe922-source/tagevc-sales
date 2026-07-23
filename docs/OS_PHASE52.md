# Phase 52 — Pending-Proposals Digest, Escalation Chain, Category Backlog Trends, Firm-Wide Admin Summary, Branch-Protection Verify + Soak Continuation

Phase 52 advances Phase 51 rails with a firm-wide pending-proposals digest for
marketing approvers, a configurable DocuSign third→fourth approver escalation
chain, Intune per-category backlog trend charts on the unified inbox,
firm-wide SLO digest admin summary trends, and Snapshot scheduled read-only
GitHub branch-protection verification plus continued Stage 4e soak rollups.
`os_store_snapshots` is never mentioned or mutated.

## Marketing

- `record_marketing_pending_proposals_digest_phase52` scans Phase 51
  auto-proposed cohorts awaiting first vs second dual approval and records an
  append-only firm-wide digest snapshot
  (`os_marketing_revenue_phase52_pending_digest_snapshots`). Visibility only —
  never calls `approve_marketing_dry_run_promote_phase50` or any money-correction
  approve RPC.
- `os_marketing_revenue_phase52_ops_alerts` +
  `list_marketing_revenue_phase52_critical_windows` surface backlog/digest
  conditions when pending counts exceed
  `MARKETING_PHASE52_PENDING_DIGEST_BACKLOG_THRESHOLD` (default 5).
- `get_marketing_revenue_phase52_ops_report` — pending-proposals digest status
  for the Marketing hub UI.

Apply `supabase/phase52_marketing_revenue_ops.sql` after Phase 51 marketing.

## DocuSign

- `os_docusign_archive_phase52_escalation_chain_config` stores configurable
  third→fourth escalation thresholds
  (`DOCUSIGN_PHASE52_FOURTH_ESCALATION_THRESHOLD_DAYS`, default 3; falls back
  to Phase 51 threshold).
- `escalate_docusign_approval_chain_phase52` raises a fourth-approver
  escalation receipt when a third-approver reminder has gone unanswered beyond
  the configured threshold. Escalations are notification/visibility-only —
  they never activate a budget and never create, void, or resend an envelope.
- `list_docusign_archive_phase52_critical_windows` +
  `os_docusign_archive_phase52_ops_alerts` surface pending fourth-approver
  escalations.
- `get_docusign_archive_phase52_ops_report` — escalation chain state +
  pending escalation visibility for the DocuSign hub UI.

Apply `supabase/phase52_docusign_archive_ops.sql` after Phase 51 DocuSign.

## Intune

- `record_it_intune_inbox_category_trends_phase52` derives per-category
  (postmortem/breaker/waive/total) backlog trend snapshots from Phase 51 unified
  inbox snapshots (`os_it_intune_phase52_category_trend_snapshots`). Purely
  observational — never closes, resets, applies, or approves anything.
- `it_intune_phase52_sanitize_aggregate` strips entity identifiers from
  aggregate evidence.
- `list_it_intune_phase52_critical_windows` +
  `os_it_intune_phase52_ops_alerts` flag category backlog/aging conditions.
- `get_it_intune_phase52_ops_report` — per-category trend metrics for the IT
  assets page.

Apply `supabase/phase52_intune_resilience_ops.sql` after Phase 51 Intune.

## Shared Services and observability

- `record_slo_firm_digest_admin_summary_trend_phase52` aggregates Phase 50
  week-over-week owner digest delivery snapshots into a firm-wide admin summary
  trend series (`os_slo_firm_digest_admin_summary_trend_snapshots`).
- `get_slo_phase52_firm_digest_admin_report` — governance visibility surfaced
  via `SloPolicyAdmin`.
- Still pull-only: admins must explicitly request the view; nothing is pushed.
  Not a full push notification system.

Apply `supabase/phase52_slo_governance_ops.sql` after Phase 51 SLO.

## Snapshot retirement

- `record_snapshot_phase52_branch_protection_verification` (service-role only)
  records read-only evidence from scheduled/scripted GitHub branch-protection
  GET checks — branch name, check-context name, required boolean, and optional
  contexts count only, never a token. Raises a critical
  `branch_protection_check_missing` alert when `required=false`.
- `scripts/ci-snapshot-phase52-branch-protection-verify.mjs` performs the
  read-only GitHub GET for context `ci-snapshot-phase50-path-guard` on branch
  `main` (override with `SNAPSHOT_PHASE52_PROTECTED_BRANCH`). Supports
  `--check` mode (exit 0/1 based on `required=true`). Optionally records
  evidence via Supabase RPC when `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` are set. **Making the check actually required
  is a one-time human repo-admin action** — Settings → Branches → Branch
  protection rules → Require status checks to pass → add
  `ci-snapshot-phase50-path-guard`. This script never PATCH/PUT/DELETEs branch
  protection.
- `record_snapshot_phase52_soak_trend` continues Stage 4e soak observation by
  rolling up Phase 51 soak trend snapshots; a `declining` trend raises a
  warning `soak_trend_declining` alert.
- `get_snapshot_phase52_ops_report` surfaces all of the above (plus the Phase
  51 dashboard) for the Snapshot retirement admin panel.
- Phase 52 contains no insert, update, delete, rename, alter, truncate, or
  drop against `os_store_snapshots`.

Apply `supabase/phase52_snapshot_cutover_ops.sql` after Phase 51 snapshot.

Optional env: `MARKETING_PHASE52_PENDING_DIGEST_BACKLOG_THRESHOLD` (default 5),
`DOCUSIGN_PHASE52_FOURTH_ESCALATION_THRESHOLD_DAYS` (default 3),
`SNAPSHOT_PHASE52_PROTECTED_BRANCH` (default main),
`SNAPSHOT_PHASE52_CHECK_CONTEXT` (default `ci-snapshot-phase50-path-guard`);
reuse `GITHUB_TOKEN` / `GH_TOKEN`, `GITHUB_REPOSITORY`,
`SNAPSHOT_PHASE50_PAGE_WEBHOOK_URL`, `SNAPSHOT_PHASE50_PAGE_DESTINATION_KEY`,
`SNAPSHOT_CI_CHECK_EXIT_CODE`, `SNAPSHOT_CI_PROTECTED_BRANCH_REQUIRED`,
`SNAPSHOT_CI_CUTOVER_ENABLED`, `SLO_OWNER_DIGEST_WEBHOOKS`,
`SLO_WEBHOOK_OPS_ALERTS`, `SLO_WEBHOOK_ALLOWED_HOSTS`.

## Deployment order

Apply after all Phase 51 migrations:

1. `phase52_marketing_revenue_ops.sql`
2. `phase52_docusign_archive_ops.sql`
3. `phase52_intune_resilience_ops.sql`
4. `phase52_slo_governance_ops.sql`
5. `phase52_snapshot_cutover_ops.sql`

Also schedule `scripts/ci-snapshot-phase52-branch-protection-verify.mjs` (cron
or GitHub Actions workflow_dispatch) once branch protection is configured, and
confirm `ci-snapshot-phase50-path-guard` is marked required in branch
protection settings.

Verify:

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

## Phase 53+ recommendations

Listed in reverse priority order (Snapshot first, Marketing last):

1. Snapshot: once branch-protection verification has run stably and soak
   trends remain stable/improving for a full observation window, consider a
   consolidated Stage 4e readiness dashboard that rolls Phase 50–52 soak,
   page-delivery, and branch-protection evidence into a single admin summary
   (still non-qualifying; do not drop `os_store_snapshots`).
2. Shared Services: extend the firm-wide admin summary trend with configurable
   alert thresholds per delivery channel — still pull-only for admins, still
   not a full push system.
3. Intune: add stale-item aging histograms per category on top of Phase 52
   backlog trend charts, reusing the same week-over-week pattern without
   exposing entity identifiers.
4. DocuSign: surface fourth-approver escalation aging in the DocuSign hub with
   a manual "refresh escalation chain state" action; still never
   auto-activating budgets.
5. Marketing: once the pending-proposals digest has run stably, consider a
   weekly approver-facing summary export (CSV/JSON) of cohorts awaiting
   first/second approval — still never auto-approving money.
6. Still out of scope: full push notifications, user admin UI, major new
   modules.
