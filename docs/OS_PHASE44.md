# Phase 44 — Ops Maturity and Evidence Depth

Phase 44 deepens production ops on Phase 43 rails: automated revenue correction
validation and attribution conflict resolution, DocuSign drift/backfill health
with integrity alerts, Intune breaker performance trends and resilience
correlation, SLO historical scenarios with handoff suggestions and policy
revision ledgers, and snapshot package integrity plus retention/canary
monitoring. `os_store_snapshots` is never mutated.

## Marketing

- Fail-closed correction validation evidence (pass / fail / auto-reject).
  Contract-invalid pending corrections may be auto-rejected; money changes are
  never auto-approved.
- Attribution model conflict ledger with maker-checker resolution
  (`event_set_mismatch`, `amount_delta_threshold`, `model_count_gap`).
- Reconciliation completeness snapshots and proactive ops alerts for queue,
  validation, conflict, and recon gap windows.
- Worker runs Phase 44 tick after Phase 43; hub badges for validation,
  conflicts, and recon health.

Apply `supabase/phase44_marketing_revenue_ops.sql` after Phase 43 marketing.

Optional env: reuse `MARKETING_SLO_ALERT_COOLDOWN_HOURS`,
`SLO_WEBHOOK_OPS_ALERTS`, `SLO_WEBHOOK_ALLOWED_HOSTS`.

## DocuSign

- Historical drift snapshots from governance receipt outcomes.
- Backfill completeness snapshots (remaining unhashed, quarantine aging,
  burn rate, completeness %).
- Integrity ops alerts: drift burst, quarantine aging/backlog, backfill stall,
  full-scan overdue, first-quarterly still gated, storage unavailable elevated.
- Hub badges for drift, backfill, and alert delivery. Workers still never
  create/void/resend envelopes.

Apply `supabase/phase44_docusign_archive_ops.sql` after Phase 43 DocuSign.

Optional env: `DOCUSIGN_ARCHIVE_ALERT_COOLDOWN_HOURS` (falls back to marketing
cooldown).

## Intune

- Breaker config performance trend snapshots (failure rate, time-in-state,
  blocked actions, completed soak cycles) — observe only.
- Smarter canary/outage ops alerts with idempotent `window_key` delivery.
- Resilience correlation timeline joining outages, tuning, soak cycles, and
  health incidents (no entity identifier leaks).
- Worker order after Phase 43 cycle tick: performance → correlate → alerts.
- Never closes or resets breakers.

Apply `supabase/phase44_intune_resilience_ops.sql` after Phase 43 Intune.

Optional env: `INTUNE_OPS_ALERT_COOLDOWN_HOURS`.

## Shared Services and observability

- Historical simulation scenario library (register + counterfactual replay;
  production alerts/delivery never mutated).
- Suggest-only owner coverage handoffs via `phase40_replacement_eligible`;
  live succession still requires Phase 42 maker-checker.
- Append-only policy revision ledger for draft/publish comparison digests.
- Ops alerts for archival overdue, succession drill overdue, and uncovered
  expiry without handoff suggestion.

Apply `supabase/phase44_slo_governance_ops.sql` after Phase 43 SLO.

## Snapshot retirement

- Signed package integrity verification evidence (digest / signature /
  metadata checks) with non-qualifying flags always false.
- External retention ops alerts for cold HEAD failures, hash mismatch,
  missing destinations, expired unverified packages, and canary failures.
- Recurring multi-hour canary schedules with due-list orchestration and
  result monitoring.
- Continues Stage 4e soak and attestation governance without qualification
  eligibility.
- Phase 44 contains no insert, update, delete, rename, alter, truncate, or
  drop against `os_store_snapshots`.

Apply `supabase/phase44_snapshot_retention_ops.sql` after Phase 43 snapshot.

Env: reuse retention allowlists and ed25519 keys; optional
`SNAPSHOT_PHASE44_CANARY_CADENCE_HOURS` (default 6),
`SNAPSHOT_RETENTION_ALERT_COOLDOWN_HOURS`.

## Deployment order

Apply after all Phase 43 migrations:

1. `phase44_marketing_revenue_ops.sql`
2. `phase44_docusign_archive_ops.sql`
3. `phase44_intune_resilience_ops.sql`
4. `phase44_slo_governance_ops.sql`
5. `phase44_snapshot_retention_ops.sql`

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

## Phase 45+ recommendations

1. Close open attribution conflicts and tune auto-reject rules from production
   correction-validation evidence; alert on delivery success rates for Phase 43
   and Phase 44 webhooks.
2. Drive DocuSign remaining-unhashed and quarantine gates to complete the first
   governed quarterly, then schedule recurring quarterlies with drift-budget
   SLOs.
3. Use Intune correlation timelines in postmortem quality reviews; promote
   accepted tuning only after multi-cycle performance trends stay healthy.
4. Automate nightly SLO scenario replay for material-risk drafts and quarterly
   handoff suggestion digests with audit export.
5. Rotate firm-wide ed25519 verify keys with dual-key cutover windows; page on
   consecutive cold HEAD / integrity failures.
6. Continue Stage 4e soak and attestation governance. Do not drop
   `os_store_snapshots` without the separately approved retirement operation.
7. Still out of scope until explicitly approved: full push notifications, user
   admin UI, major new modules.
