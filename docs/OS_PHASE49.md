# Phase 49 — Autopilot Dry-Run, Budget Proposals, Dual-Approve Publish, Owner SLOs, Protected-Branch Enforcement

Phase 49 advances Phase 48 rails with autopilot dry-run dashboards and cohort
promotion audit exports for Marketing, multi-quarter DocuSign cadence SLO
tracking with proposed (never silently activated) budget revisions, Intune
human-apply + dual-approve publish gating for postmortem template
suggestions, per-owner digest delivery success SLOs surfaced in the Shared
Services hub, and mandatory CI offline_script dual acceptance on every
snapshot cutover for protected branches. `os_store_snapshots` is never
mentioned or mutated.

## Marketing

- Autopilot dry-run snapshots simulate Phase 47 gate + Phase 48 autopilot
  decisions without ever calling the live promote/reject RPC (never
  auto-approves money).
- Cohort promotion audit exports: read + append-only receipts recording what
  was included in a promotion audit window.
- Ops alerts on critical dry-run/audit-export windows via the existing
  allowlisted ops webhook.

Apply `supabase/phase49_marketing_revenue_ops.sql` after Phase 48 marketing.

## DocuSign

- Multi-quarter cadence SLO snapshots track on-time recurring quarterly
  performance across several quarters (not just one).
- Budget revision *proposals* on cadence SLO breaches — proposals are
  distinct rows from activated budgets and require 2 distinct human
  approvers before `upsert_docusign_archive_drift_budget_phase45` is called.
  Never silently activated.
- Workers still never create/void/resend envelopes.

Apply `supabase/phase49_docusign_archive_ops.sql` after Phase 48 DocuSign.

## Intune

- Human-apply: a person can apply a Phase 48 template suggestion's notes
  fragment onto its draft postmortem (never auto-publish).
- Dual-approve publish gate: 2 distinct human approvers are required before
  the existing independent maker-checker `publish_it_intune_outage_postmortem`
  RPC is called. Suggested vs applied vs published stay visible.
- Never closes or resets breakers; no entity identifier leaks in aggregates.

Apply `supabase/phase49_intune_resilience_ops.sql` after Phase 48 Intune.

## Shared Services and observability

- Per-owner digest delivery success SLO snapshots (rolled up by `owner_id`,
  not just `destination_key`) scanned read-only from Phase 48 delivery
  evidence.
- Governance report (`get_slo_phase49_owner_digest_report`) surfaces
  owners-tracked / healthy / warning / critical counts and overall success
  rate directly in the Shared Services hub via `SloPolicyAdmin`.
- Still not a full push notification system.

Apply `supabase/phase49_slo_governance_ops.sql` after Phase 48 SLO.

## Snapshot retirement

- Protected-branch policies (grow-only allowlist, seeded with `main` and
  `production`) mark which branches always require CI offline_script dual
  acceptance before an ed25519 cutover completes.
- `complete_snapshot_ed25519_cutover_phase49` enforces this: protected
  branches route through the Phase 48 CI-required completion path; other
  branches keep the Phase 47 dual-acceptance path. Every attempt — allowed or
  blocked — is recorded as an append-only enforcement event for visibility.
- `scripts/ci-snapshot-cutover-accept.mjs` now fails closed (nonzero exit)
  on protected branches when `SNAPSHOT_CI_CUTOVER_ENABLED` is not set,
  instead of silently skipping.
- Continues Stage 4e soak; non-qualifying flags always false.
- Phase 49 contains no insert, update, delete, rename, alter, truncate, or
  drop against `os_store_snapshots`.

Apply `supabase/phase49_snapshot_cutover_ops.sql` after Phase 48 snapshot.

Optional env: `SNAPSHOT_CI_PROTECTED_BRANCH_REQUIRED` (comma-separated,
defaults to `main,production`); reuse `SLO_OWNER_DIGEST_WEBHOOKS`,
`SNAPSHOT_CI_CUTOVER_ENABLED`, `SLO_WEBHOOK_OPS_ALERTS`,
`SLO_WEBHOOK_ALLOWED_HOSTS`.

## Deployment order

Apply after all Phase 48 migrations:

1. `phase49_marketing_revenue_ops.sql`
2. `phase49_docusign_archive_ops.sql`
3. `phase49_intune_resilience_ops.sql`
4. `phase49_slo_governance_ops.sql`
5. `phase49_snapshot_cutover_ops.sql`

Verify:

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

## Phase 50+ recommendations

1. Marketing: promote from dry-run to a gated, dual-approved "would promote"
   → actual promote flow for cohorts that have soaked healthy across N audit
   exports (still never auto-approve money without an explicit human step).
2. DocuSign: a dashboard aggregating multi-quarter cadence SLO trend lines
   across entities, plus an expiry/reminder digest for pending budget
   revision proposals awaiting a second approver.
3. Intune: extend the dual-approve publish gate pattern to other
   maker-checker-gated resilience workflows (breaker tuning proposals,
   waive promotions) for a single consistent "propose → 2 distinct
   approvers → apply" UX.
4. Shared Services: owner digest success SLO trend history (week-over-week)
   and an opt-in per-owner "your digests are failing" self-serve view — still
   not a full push system.
5. Snapshot: extend protected-branch enforcement visibility with a paging
   hook on `protected_branch_cutover_blocked` alerts (currently visibility-
   only, no paging), and consider a CI job that runs `--check` on every PR
   touching cutover-adjacent code. Continue Stage 4e soak; do not drop
   `os_store_snapshots`.
6. Still out of scope: full push notifications, user admin UI, major new
   modules.
