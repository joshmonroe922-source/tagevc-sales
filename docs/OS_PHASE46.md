# Phase 46 — Controlled Promotion and Production Cadence

Phase 46 advances Phase 45 rails with gated auto-reject promotion on healthy
webhook delivery SLOs, first DocuSign quarterly completion and recurring arms,
dual-approver Intune promote waives with deeper postmortem scorecards,
firm-wide nightly SLO scenario replay and published handoff digests, and
dual-acceptance ed25519 cutovers with on-call page routing.
`os_store_snapshots` is never mutated.

## Marketing

- Auto-reject rule promotion is gated on consecutive healthy Phase 45 webhook
  delivery SLO windows before Phase 45 activate may succeed.
- Append-only promotion evidence (`blocked` / `promoted` / `rejected`) plus
  auto-reject performance and webhook reliability snapshots.
- Ops alerts for blocked promotions, degraded webhook reliability, and rule
  performance anomalies.
- Worker runs Phase 46 after Phase 45; hub badges for promotion gate,
  webhook reliability, and rule performance.

Apply `supabase/phase46_marketing_revenue_ops.sql` after Phase 45 marketing.

## DocuSign

- First quarterly archive review completion evidence from Phase 43 runbook +
  Phase 45 gate-clearing steps (blocked with reason when incomplete).
- Recurring quarterly arms require first-quarterly completion evidence.
- Drift budget tighten/activate revisions from production baselines.
- Enhanced integrity cadence ops visibility and alerts
  (`first_quarterly_incomplete`, `recurring_unarmed`,
  `drift_budget_tighten_due`, `cadence_unhealthy`).
- Workers still never create/void/resend envelopes.

Apply `supabase/phase46_docusign_archive_ops.sql` after Phase 45 DocuSign.

## Intune

- Dual-approver promote waive proposals (`proposed_by` ≠ `decided_by`).
- Deeper postmortem quality scorecards: cycle trend, correlation coverage,
  root cause, notes quality → composite readiness.
- Accept path requires `ready` **or** a non-expired dual-approved waive;
  Phase 45 accept is wrapped, never bypassed without audit.
- Never closes or resets breakers; no entity identifier leaks.

Apply `supabase/phase46_intune_resilience_ops.sql` after Phase 45 Intune.

## Shared Services and observability

- Firm-wide nightly counterfactual scenario replay for material-risk /
  firm-wide scenarios (never mutates production alerts/delivery).
- Publish quarterly owner handoff digests (destination_key + recipient counts
  only — no PII emails stored).
- Ownership-change alerts for upcoming expiries without accepted handoff.
- Governance report surfaces firm-wide replay health, publications, and
  ownership alerts.

Apply `supabase/phase46_slo_governance_ops.sql` after Phase 45 SLO.

## Snapshot retirement

- Dual-acceptance ed25519 cutovers: offline_script / admin / worker
  acceptances; cutover completes only when two distinct verifier kinds accept.
- On-call page routing for consecutive cold HEAD / integrity failures via
  allowlisted `SNAPSHOT_ONCALL_WEBHOOK` (falls back to `SLO_WEBHOOK_OPS_ALERTS`).
- Continues Stage 4e soak and attestation governance with
  `qualification_eligible`, `attestation_eligible`, and
  `production_relation_mutated` always false.
- Phase 46 contains no insert, update, delete, rename, alter, truncate, or
  drop against `os_store_snapshots`.

Apply `supabase/phase46_snapshot_cutover_ops.sql` after Phase 45 snapshot when
available. The Phase 46 file bootstraps `os_snapshot_ed25519_key_rotations` and
`complete_snapshot_ed25519_cutover_phase45` if Phase 45 snapshot SQL was
skipped, so it remains re-runnable.

Optional env: `SNAPSHOT_ONCALL_WEBHOOK`; reuse `SLO_WEBHOOK_ALLOWED_HOSTS`.

## Deployment order

Apply after all Phase 45 migrations:

1. `phase46_marketing_revenue_ops.sql`
2. `phase46_docusign_archive_ops.sql`
3. `phase46_intune_resilience_ops.sql`
4. `phase46_slo_governance_ops.sql`
5. `phase46_snapshot_cutover_ops.sql`

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

## Phase 47+ recommendations

1. Expand auto-reject promotion gates to multi-entity cohorts; close remaining
   attribution conflicts under promoted rules.
2. Execute the first armed DocuSign recurring quarterly under tightened drift
   budgets; page on cadence unhealthy windows.
3. Add dual-approve waive expiry SLOs; correlate deeper scorecards with outage
   MTTR from soak cycle evidence.
4. Auto-notify owners when handoff digests publish (digest email/webhook only —
   still not a full push notification system).
5. Make offline verify-script dual acceptance the default cutover path; track
   on-call acknowledgment SLOs for consecutive-failure pages.
6. Continue Stage 4e soak and attestation governance. Do not drop
   `os_store_snapshots` without the separately approved retirement operation.
7. Still out of scope until explicitly approved: full push notifications, user
   admin UI, major new modules.
