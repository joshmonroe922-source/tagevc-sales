# Tage VC Operating System — Phase 36

Phase 36 hardens the Phase 35 operational paths: paid reporting now proves
coverage per account, DocuSign recovery is evidence-verified and replacement
sends are transactional, Intune work is lease/version fenced, and rollback
attestations have explicit expiry and supersession.

## Shipped

### Marketing reliability and reporting

- Scheduling and processing are separated: a daily scheduler identifies missing
  dates across the exact previous 90 complete days; a ten-minute worker handles
  one leased provider window at a time.
- Historical gaps are queued from durable coverage rows rather than a single
  data-through field.
- LinkedIn analytics follows bounded paging. Meta remains bounded by cursor and
  campaign batches.
- Re-selecting a different provider account atomically increments a connection
  revision, supersedes active old work, and clears stale reporting projections.
- Manual campaign sync now queues governed account windows and cannot overwrite
  leased metrics directly.
- Reporting exposes per-account coverage and currency-grouped totals. Overall
  completeness requires every eligible account to be complete.

### DocuSign reliability

- Finalized request replays return the existing envelope without another
  provider create call.
- Replacement sends use the same durable intent, transaction ID, hidden custom
  fields, timeout recovery, and atomic finalization path as document/template
  sends.
- Unknown replacement outcomes remain active and block duplicate replacements.
- Recovery verifies hidden intent, entity, operation, and document evidence
  before finalization. Multiple or mismatched results enter manual review.
- Stale never-dispatched intents are cancelled and exhausted recovery leases are
  materialized as manual review.
- Broad reconciliation gives send intents precedence, preserves canonical
  operation metadata, detects mapping conflicts, and records pagination
  truncation.

### Intune robustness

- Approval expiry runs independently of Graph configuration and writes a durable
  transition event.
- Workers claim one action at a time with worker identity, lease expiry, and
  optimistic row-version fencing.
- Graph calls use bounded timeouts and structured transient, ambiguous,
  permanent, and platform error classes.
- Retry-After is honored for throttling; ambiguous requests enter verification
  rather than blind redispatch.
- Retry creation is idempotent, links parent and child, and only permits bounded
  retryable failures or operator cancellation.
- Worker summaries and action transition timelines are visible in the IT hub.

### Stage 4e governance

- Rehearsal evidence uses a versioned manifest and one hash covering epoch,
  retired relation, configuration, manifest, artifact, and procedure.
- Pending review and accepted evidence are refreshed for expiry and epoch/config
  invalidation.
- A new accepted attestation atomically supersedes prior valid evidence; a
  rejected pending rehearsal leaves prior valid evidence intact.
- Reviewers see the full manifest, artifact link, bundle/procedure hashes,
  validity, actor separation, and lifecycle timeline.
- The application still contains no capability to drop `os_store_snapshots`.

## SQL deployment order

1. `phase36_marketing_paid_reliability.sql`
2. `phase36_docusign_send_hardening.sql`
3. `phase36_intune_worker_fencing.sql`
4. `phase36_snapshot_attestation_lifecycle.sql`

`phase36_operational_health_guide.sql` is read-only.

## Operational follow-up

- Monitor the paid queue while the worker fills 90-day account gaps.
- Treat DocuSign `provider_unknown` and `manual_review` as non-resend states.
- Investigate Intune platform-class failures centrally rather than retrying each
  device.
- Replace any pending Phase 35 rollback manifest with a Phase 36 versioned
  evidence bundle before its validity gate is needed.

## Phase 37 recommendations

1. Add provider contract fixtures and authoritative account-total reconciliation
   for paid media, including unmapped provider spend.
2. Add manual-review resolution controls for DocuSign with dual approval and
   signed archive content hashes.
3. Add Intune dispatch authorization as a separate final pre-provider RPC and
   centralized Graph outage circuit breaking.
4. Make snapshot drill and soak observation persistence fully transactional and
   add proactive evidence-expiry notifications.
5. Add shared-service SLO thresholds and external alert delivery for persistent
   backlog, lease conflict, and recovery exhaustion.
