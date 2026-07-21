# Tage VC Operating System — Phase 35

Phase 35 adds bounded paid-metrics backfills, transactional DocuSign send
recovery, governed Intune retry controls, and dual-actor offline rollback
evidence. It adds no major module and no application path that mutates the
snapshot relation.

## Shipped

### Marketing

- Six-hour worker schedules seven-day provider windows for the previous 28
  complete days and fills missing 90-day bootstrap coverage.
- Database leases, deterministic window keys, bounded retries, response hashes,
  and atomic full-window replacement prevent partial or stale analytics writes.
- Meta account-level reporting follows cursors and uses each campaign's
  configured conversion action. LinkedIn uses bounded campaign batches and its
  explicit external conversion definition.
- Daily coverage is stored independently of activity rows, so a zero-result day
  can still be proven complete.
- The hub shows coverage, account health, operation state, attempts, windows,
  rows, and errors with entity-scoped visibility.

### DocuSign

- Document and template sends persist an intent before contacting DocuSign.
- Every live request includes a stable DocuSign transaction ID and hidden
  intent/entity/document fields.
- Provider success, document state, envelope projection, and audit event are
  finalized in one PostgreSQL transaction.
- Unknown network/provider outcomes are never blindly resent. A five-minute
  recovery worker searches exact transaction IDs and finalizes one exact match.
- The hub exposes prepared, dispatching, unknown, recovering, finalized, failed,
  and manual-review intent states.

### IT

- Intune retirement requires an exact normalized serial match to one eligible
  local asset before approval.
- Approval is bound to the asset-match hash, expires after one hour, and uses
  the dedicated break-glass-protected `action:intune_retire` permission.
- Requested/approved actions can be cancelled. Failed/cancelled actions create
  bounded fresh child retries; terminal rows are never reopened.
- Every retry requires a new asset match and fresh approval.
- Worker dispatch performs a live provider identity preflight and accepts
  provider absence as verification only after persisted successful submission.

### Snapshot retirement

- Operators record a hashed offline rehearsal manifest and external artifact.
- A distinct reviewer must attest the exact same manifest hash before evidence
  is accepted; actor reuse, hash drift, expiry, and stale versions fail closed.
- Accepted evidence is valid for 90 days and is correlated to the active epoch,
  retired relation, and configuration fingerprint.
- The Stage 4e checklist requires current two-actor evidence.
- Evidence capture accepts no SQL or executable relation operation.

## SQL deployment order

1. `phase35_marketing_paid_backfill.sql`
2. `phase35_docusign_transactional_send.sql`
3. `phase35_intune_rollback_attestations.sql`

`phase35_stage4e_attestation_guide.sql` is read-only evidence guidance.

## Operational follow-up

- Let the paid worker establish coverage gradually; each invocation processes
  at most two leased windows.
- Monitor DocuSign unknown/recovery intents before treating an action as failed.
- Correct duplicate asset serials before Intune matching.
- The operator and reviewer must use separate authenticated accounts.

## Phase 36 recommendations

1. Add provider contract fixtures, per-currency paid rollups, and explicit
   complete-window alerting.
2. Extend transactional DocuSign intents to replacement sends and webhook-first
   recovery; make signed archives hash-idempotent.
3. Add dedicated Intune transition timelines, asset-match correction workflow,
   and policy-based retry eligibility.
4. Move drill/epoch persistence into fully atomic evidence RPCs and add
   rehearsal supersession/expiry automation.
5. Continue entity-scope, performance, and operational alerting hardening.
