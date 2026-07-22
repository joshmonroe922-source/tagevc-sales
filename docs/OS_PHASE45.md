# Phase 45 — Automation Maturity and Gate Discipline

Phase 45 advances Phase 44 rails with tuned auto-reject rules and webhook
delivery SLOs, DocuSign gate-clearing and drift budgets, Intune postmortem
quality gates before tuning promote, nightly SLO scenario replay and quarterly
handoff digests, and dual-key ed25519 snapshot rotation with consecutive-failure
paging. `os_store_snapshots` is never mutated.

## Marketing

- Append-only auto-reject rule versions with maker-checker activate; validation
  reads the latest active thresholds (Phase 44 defaults when none). Money
  corrections are still never auto-approved.
- Webhook delivery SLO snapshots over Phase 43/44 ops alert delivery outcomes
  (success rate → healthy / warn / critical).
- Correction workflow monitoring snapshots (pending age, pass/fail/auto-reject
  rates) with stale-queue and elevated fail-rate alerts.
- Worker runs Phase 45 after Phase 44; hub badges for webhook delivery,
  workflow health, and active rule version.

Apply `supabase/phase45_marketing_revenue_ops.sql` after Phase 44 marketing.

## DocuSign

- Structured gate-clearing evidence checklist through
  `remaining_unhashed_cleared` → `recurring_quarterly_armed`.
- Drift budgets with health thresholds compared to Phase 44 drift snapshots.
- Integrity cadence snapshots (sample/full overdue, next quarterly due).
- Ops alerts: drift budget breach, gate clearing stalled, recurring quarterly
  unarmed, integrity cadence overdue.
- Workers still never create/void/resend envelopes.

Apply `supabase/phase45_docusign_archive_ops.sql` after Phase 44 DocuSign.

## Intune

- Postmortem quality reviews fed by multi-cycle soak evidence and Phase 44
  performance trends (aggregate-only checklists).
- Tuning promote gates (`blocked` / `ready` / `waived`) require healthy
  multi-cycle trends before Accept creates a tuning proposal.
- Accept path wraps Phase 41 accept only when the gate is ready or waived.
- Never closes or resets breakers; no entity identifier leaks.

Apply `supabase/phase45_intune_resilience_ops.sql` after Phase 44 Intune.

## Shared Services and observability

- Nightly counterfactual scenario replay runs (never mutates production
  `os_slo_alerts` / delivery).
- Quarterly owner handoff digests summarizing suggestions, expiries, and
  acceptances.
- Governance report surfaces upcoming ownership changes and policy health.
- Ops alerts for nightly replay failure and overdue handoff digests.

Apply `supabase/phase45_slo_governance_ops.sql` after Phase 44 SLO.

## Snapshot retirement

- Dual-key ed25519 rotation ledger (`announced` → `dual_active` →
  `cutover_complete` / `aborted`); public key metadata only — never private
  keys in the database.
- Consecutive cold HEAD / integrity failure paging (default threshold 3)
  via allowlisted ops webhooks.
- Continues Stage 4e soak and attestation governance with
  `qualification_eligible`, `attestation_eligible`, and
  `production_relation_mutated` always false.
- Phase 45 contains no insert, update, delete, rename, alter, truncate, or
  drop against `os_store_snapshots`.

Apply `supabase/phase45_snapshot_key_rotation_ops.sql` after Phase 44 snapshot.

Optional env: `SNAPSHOT_CONSECUTIVE_FAILURE_THRESHOLD` (default 3); reuse
`SLO_WEBHOOK_OPS_ALERTS` + `SLO_WEBHOOK_ALLOWED_HOSTS`.

## Deployment order

Apply after all Phase 44 migrations:

1. `phase45_marketing_revenue_ops.sql`
2. `phase45_docusign_archive_ops.sql`
3. `phase45_intune_resilience_ops.sql`
4. `phase45_slo_governance_ops.sql`
5. `phase45_snapshot_key_rotation_ops.sql`

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

## Phase 46+ recommendations

1. Close remaining attribution conflicts; promote auto-reject rules only after
   webhook delivery SLOs stay healthy across cooldown windows.
2. Complete first DocuSign quarterly from gate-clearing evidence, arm recurring
   quarterlies, and tighten drift budgets from production baselines.
3. Require waived promote exceptions to carry dual-approver audit; expand
   postmortem quality scoring with correlation-timeline coverage gaps.
4. Schedule firm-wide nightly scenario replay for all material-risk drafts and
   publish quarterly handoff digests to owners automatically.
5. Finish dual-key cutovers with offline verify-script dual acceptance; page
   onboarding for consecutive failure alerts into on-call rotations.
6. Continue Stage 4e soak and attestation governance. Do not drop
   `os_store_snapshots` without the separately approved retirement operation.
7. Still out of scope until explicitly approved: full push notifications, user
   admin UI, major new modules.
