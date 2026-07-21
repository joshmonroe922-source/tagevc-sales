# Phase 37 — Reliability Boundaries and Shared Services SLOs

Phase 37 strengthens provider contracts, human resolution boundaries, external
side-effect fencing, snapshot evidence transactions, and operational health
visibility across Shared Services.

## Marketing

- Added strict, versioned runtime contracts for Meta and LinkedIn daily
  campaign metrics.
- Rejects malformed numerics, unknown campaigns, dates outside the leased
  window, duplicate campaign/date rows, and stalled pagination.
- Persists contract version, validation status, structured error class, retry
  disposition, request evidence, and a database-canonical evidence hash.
- Separates automatic transient retries from governed retries after OAuth or
  configuration correction. Scheduled enqueue no longer revives terminal
  Phase 37 failures.
- Added provider-contract tests for valid data, malformed numerics, pagination,
  stable evidence hashing, Retry-After parsing, and error classification.

Apply:

- `supabase/phase37_marketing_paid_contracts.sql`

## DocuSign

- Added a two-actor, 30-minute manual-review proposal and approval workflow.
- Both actors use freshly fetched transaction and envelope custom-field
  evidence. Candidate sets are bound to a canonical database hash.
- Approval can atomically bind one verified candidate or close the local
  intent without authorizing a resend. Rejection leaves the intent quarantined.
- Dispatched ambiguous document sends remain resend tombstones.
- Added immutable manual-review lifecycle events and repaired replacement
  lineage during approved resolution.
- New template sends include provider transaction and document custom fields,
  improving timeout recovery evidence.

Apply:

- `supabase/phase37_docusign_manual_review.sql`

## Intune

- Split worker claim from final provider dispatch authorization.
- Approved actions enter `preflighting`; a fresh provider identity check is
  atomically rebound to the current approval, local asset, lease, and row
  version immediately before Graph POST.
- A unique dispatch-attempt row and authorization token permit at most one
  provider dispatch per action.
- Any crash after authorization recovers into verification only. Ambiguous
  outcomes cannot automatically redispatch and eventually enter manual review.
- Cancellation remains available until authorization commits, never after it.
- Worker and UI timelines expose preflight, authorization, ambiguity, and
  verification evidence without exposing lease or authorization tokens.

Apply:

- `supabase/phase37_intune_dispatch_boundary.sql`

Deploy the migration and Phase 37 worker code together. Do not run the Phase 36
and Phase 37 Intune claim workers concurrently.

## Snapshot retirement

- Added one transactional persistence RPC for a drill header, all drill checks,
  epoch lifecycle change, and linked soak observation.
- Exact cron replays return the already committed cycle; conflicting or
  incomplete replays fail closed.
- Added transaction-scoped locking and one-effective-epoch enforcement.
- Preserves the first qualification timestamp.
- No Phase 37 migration drops, renames, alters, or writes
  `os_store_snapshots`. Snapshot drills remain read-only against the configured
  relation.

Apply:

- `supabase/phase37_snapshot_evidence_transaction.sql`

## Shared Services SLOs

- Added entity-scoped hourly evaluations for paid-sync backlog/failures,
  DocuSign recovery/manual review, Intune due work/platform failures, and
  firm-wide snapshot evidence/attestation freshness.
- Critical breaches open immediately; warning alerts require consecutive
  breaches; resolution requires two healthy evaluations.
- Added durable, deduplicated open/resolved alerts and generic worker invocation
  history.
- Instrumented paid metrics, DocuSign recovery, Intune actions, snapshot soak,
  and the SLO evaluator itself.
- Added a compact operational-health panel to the Shared Services landing page.

Apply:

- `supabase/phase37_shared_service_slos.sql`

The `/api/ops/slo-evaluate` cron runs hourly at minute 10.
Use `supabase/phase37_operational_health_guide.sql` for read-only post-deploy
inspection.

## Verification

Run:

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

Apply migrations in this order:

1. `phase37_marketing_paid_contracts.sql`
2. `phase37_docusign_manual_review.sql`
3. `phase37_intune_dispatch_boundary.sql`
4. `phase37_snapshot_evidence_transaction.sql`
5. `phase37_shared_service_slos.sql`

For the snapshot migration, pause `/api/admin/soak-health`, wait for any active
invocation to finish, apply the migration and application deployment, then
resume the cron. Phase 36 and Phase 37 snapshot evidence writers must not run
concurrently.

## Phase 38+ recommendations

1. Add provider account-total reconciliation for paid metrics so coverage
   distinguishes true zero activity from unmapped campaigns.
2. Move DocuSign broad reconciliation to leased, idempotent transactional page
   commits with immutable per-page evidence.
3. Add an explicit two-actor Intune manual-review outcome process; keep
   redispatch limited to a newly matched and approved child action.
4. Add canary and concurrency tests for Intune authorize/cancel races and
   snapshot evidence replay conflicts.
5. Add configurable SLO policies, acknowledgement ownership, and external
   delivery adapters while keeping push notifications out of the core worker.
6. Continue Stage 4e soak and attestation evidence. Do not drop
   `os_store_snapshots` until the separately governed retirement decision.
