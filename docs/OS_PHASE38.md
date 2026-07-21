# Phase 38 — Reconciliation, Governance, and Delivery

Phase 38 makes provider totals, reconciliation checkpoints, ambiguity outcomes,
SLO ownership, and snapshot evidence lifecycle durable and auditable.

## Marketing

- Meta and LinkedIn account-level daily totals are fetched independently from
  mapped campaign allocation.
- Provider identity, daily ranges, numeric contracts, and account access are
  validated before zero dates or coverage can be accepted.
- PostgreSQL recomputes mapped totals and commits campaign rows, authoritative
  account totals, coverage, and evidence atomically.
- Mapping gaps remain visible without understating provider totals. Provider
  inconsistencies retry without replacing accepted data.
- Campaign-binding hashes supersede stale runs and permit a fresh exact-window
  reconciliation.
- Mixed currencies remain grouped; the UI does not create a false combined
  spend, ROI, or ROAS headline.

Apply `supabase/phase38_marketing_paid_reconciliation.sql`.

## DocuSign

- Broad reconciliation now uses one frozen provider window and immutable,
  PII-free page evidence.
- A lease fences each invocation. Up to three 100-envelope pages are committed
  per invocation, with a hard run limit of 100 pages or 10,000 envelopes.
- Provider pagination uses DocuSign's inclusive `endPosition` contract.
- Cursor drift, total drift, duplicate envelopes, and changed page replays fail
  closed while previously committed checkpoints remain durable.
- PostgreSQL resolves all local identity claims and commits each page and its
  projection changes in one transaction.
- Conflicting non-null identity remains sticky manual review; older provider
  status observations cannot regress the projection.

Apply `supabase/phase38_docusign_reconciliation_batches.sql`.

## Intune

- `manual_review` is a non-polling quarantine and cannot be reclaimed by the
  worker.
- A two-actor, 30-minute proposal/review process supports confirmed retirement,
  unresolved closure, or a governed retry child.
- Both actors independently collect read-only Graph and audit evidence bound to
  the dispatch attempt, approval, asset, provider preflight, device, and serial.
- Retry children require at least 24 hours of quarantine, exact non-retired
  provider identity, and fresh matching and approval before dispatch.
- A dispatched action remains a tombstone; new root actions cannot bypass the
  governed child lineage.

Apply `supabase/phase38_intune_ambiguity_governance.sql`.

## Shared Services and observability

- Versioned SLO policies now own thresholds, windows, breach counts, recovery
  counts, and delivery configuration.
- Owners can acknowledge or reassign incidents with optimistic row-version
  checks and immutable lifecycle events.
- Policy revisions preserve one continuous open incident.
- Alert transitions enqueue durable in-app or environment-resolved webhook
  delivery jobs. Every attempt is leased and recorded.
- The Shared Services dashboard shows ownership, delivery state, and sanitized
  worker cadence/freshness across Marketing, DocuSign, Intune, Snapshot, and
  SLO workers.

Apply `supabase/phase38_slo_ownership_delivery.sql`.

The `/api/ops/slo-deliver` cron runs every five minutes.

## Snapshot retirement

- A canonical Phase 38 evidence cycle binds exact time, actor, normalized
  configuration, contract version, code revision, full drill report, and soak
  observation.
- Exact replays return committed evidence. Conflicting replays are retained as
  durable conflict events and fail closed.
- Broken or rolled-back epochs transactionally invalidate linked observations,
  drill evidence, cycles, and rollback rehearsals.
- Snapshot SLO integrity evaluates the latest cycle, including failures and
  conflicts, rather than falling back to older qualifying evidence.
- No Phase 38 migration drops, renames, inserts, updates, or deletes
  `os_store_snapshots`.

Apply `supabase/phase38_snapshot_cycle_lifecycle.sql`.

## Deployment and verification

Apply migrations in this order:

1. `phase38_marketing_paid_reconciliation.sql`
2. `phase38_docusign_reconciliation_batches.sql`
3. `phase38_intune_ambiguity_governance.sql`
4. `phase38_slo_ownership_delivery.sql`
5. `phase38_snapshot_cycle_lifecycle.sql`

Deploy each migration with its Phase 38 application code. Pause the affected
worker while replacing its RPC contract. For snapshot evidence, pause
`/api/admin/soak-health`, wait for any active invocation, apply migrations four
and five, deploy, then resume the cron.

Run:

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

After applying SQL, run the service-role invariant checks:

```sql
select public.assert_phase38_slo_invariants();
select public.assert_phase38_snapshot_invariants();
```

## Phase 39+ recommendations

1. Add paid-attribution revenue reconciliation and settlement-lag monitoring.
2. Add DocuSign mapping-review resolution distinct from send-intent resolution,
   plus signed-archive content hashes.
3. Add an Intune provider-outage dispatch circuit breaker and canary reset.
4. Add SLO policy editing with named owner selection and delivery-route tests.
5. Add snapshot evidence export manifests and longer-running replay/concurrency
   canaries.
6. Continue Stage 4e soak and attestation governance. Do not drop
   `os_store_snapshots` without the separately approved retirement operation.
