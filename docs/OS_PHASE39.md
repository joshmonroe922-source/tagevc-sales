# Phase 39 — Attribution, Recovery, and Governed Operations

Phase 39 extends Phase 38 reconciliation into revenue settlement, ambiguous
mapping resolution, provider-outage recovery, editable SLO policy governance,
and exportable snapshot evidence.

## Marketing

- Paid revenue is recorded in an append-only, revision-linked evidence ledger.
- Every record is bound to the current entity, provider account, campaign,
  external identifiers, attribution model/version/window, source record, and
  canonical source hash.
- Integer micro-units preserve exact arithmetic. Reports remain grouped by
  currency and never create mixed-currency totals.
- Settlement status, expected/actual settlement times, overdue counts, late
  settlement, revision counts, and attribution completeness are visible in the
  Marketing hub.
- Idempotent replays return the original record; conflicting evidence or broken
  revision lineage fails closed.

Apply `supabase/phase39_marketing_attribution_settlement.sql`.

## DocuSign

- Mapping review is now a dedicated workflow and cannot authorize or mutate a
  send intent.
- Provider identity conflicts use immutable proposals/events, optimistic row
  versions, independent reviewer evidence, and two-actor approval.
- Approved resolutions atomically repair the reconciliation projection while
  preserving sticky conflict history.
- Signed archives record content SHA-256, byte length, envelope/document/entity
  identity, provider status, request evidence, and retrieval time without
  storing PDF or certificate content in audit evidence.
- Repeated archive observations detect content drift and retain immutable
  manifest history.

Apply `supabase/phase39_docusign_mapping_archive.sql`.

## Intune

- A durable circuit breaker is scoped by entity, provider, and operation.
- Provider read/dispatch outcomes drive deterministic bounded samples and
  closed, open, or half-open state.
- Open breakers block new Graph POST authorization while preserving read-only
  verification and recovery.
- A different authorized reviewer must approve reset evidence. Half-open state
  permits one lease/token-fenced canary.
- Failed or stale canaries reopen the breaker; successful canaries close it
  only after the configured recovery threshold.
- Dispatch tombstones and Phase 38 ambiguity quarantine remain authoritative.

Apply `supabase/phase39_intune_provider_circuit_breaker.sql`.

## Shared Services and observability

- SLO policy changes use draft, validation, maker-checker publication, immutable
  audit events, and optimistic row versions.
- Named owners must be active and authorized for the policy entity scope.
- Thresholds, windows, recovery counts, adapters, and environment destination
  keys are validated before publication.
- Delivery-route tests use isolated TEST jobs. They do not open, close,
  acknowledge, or reassign incidents.
- Test attempts are idempotent, leased, redacted, auditable, and support both
  in-app and environment-key webhook routes.

Apply `supabase/phase39_slo_policy_editing_route_tests.sql`.

## Snapshot retirement

- Evidence export manifests bind cycle, drill, observation, epoch, rehearsal,
  lifecycle validity, hashes, and bounded metadata under one manifest SHA-256.
- Manifests are immutable, replay-safe, and contain no raw snapshot payloads or
  secrets.
- Replay and concurrency canaries use bounded definitions, leases, steps,
  expected outcomes, expiry, abort handling, and durable evidence.
- Canary evidence is explicitly ineligible for soak qualification or rollback
  attestation.
- Phase 39 does not insert, update, delete, rename, alter, truncate, or drop
  `os_store_snapshots`.

Apply `supabase/phase39_snapshot_retirement.sql`.

## Deployment order

Apply migrations after all Phase 38 migrations, in this order:

1. `phase39_marketing_attribution_settlement.sql`
2. `phase39_docusign_mapping_archive.sql`
3. `phase39_intune_provider_circuit_breaker.sql`
4. `phase39_slo_policy_editing_route_tests.sql`
5. `phase39_snapshot_retirement.sql`

Deploy the Phase 39 application immediately after the migrations. Pause the
affected worker while replacing existing Intune dispatch RPC contracts.

For SLO webhook delivery, configure each environment-key route as
`SLO_WEBHOOK_<DESTINATION_KEY>` and add its exact hostname to the comma-separated
`SLO_WEBHOOK_ALLOWED_HOSTS` allowlist. In-app delivery needs no additional
environment variable.

Verify before deployment:

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

## Phase 40+ recommendations

1. Connect authoritative revenue sources and automate canonical evidence
   ingestion, correction, and attribution-model comparison.
2. Backfill legacy signed archives and add scheduled archive-integrity scans.
3. Add Intune breaker tuning history, outage correlation, and read-only canary
   health alerts.
4. Add SLO draft comparison, policy simulation against historical evaluations,
   and expiring owner coverage.
5. Add signed snapshot export packages, external evidence retention checks, and
   multi-hour canary orchestration.
6. Continue Stage 4e soak and attestation governance. Do not drop
   `os_store_snapshots` without the separately approved retirement operation.
