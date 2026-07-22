# Phase 40 — Authoritative Integrity and Long-Running Governance

Phase 40 connects authoritative revenue sources, governs archive integrity,
observes Intune outages, simulates SLO policy changes, and signs long-running
snapshot evidence packages without touching `os_store_snapshots`.

## Marketing

- Authoritative HTTPS connectors pull bounded revenue pages with HMAC or
  request-id authenticity checks.
- Canonical evidence, immutable receipts, and leased pull checkpoints keep
  ingestion replay-safe.
- Corrections require maker-checker approval before they supersede current
  revisions.
- Attribution-model comparison is restricted to aligned cohorts, windows, and
  currencies and never implies causality.
- Completeness, late, and corrected statuses are visible in the Marketing hub.

Apply `supabase/phase40_marketing_authoritative_revenue.sql`.

Cron: `/api/marketing/revenue-ingestion-worker` every 15 minutes.

## DocuSign

- Legacy completed envelopes without content hashes enter leased backfill runs.
- Scheduled sample and full integrity scans rehash stored bytes, distinguish
  provider/storage unavailability from content drift, and quarantine drift.
- Evidence stores metadata and digests only; no PDF or certificate content.
- Backfill and scan workers never create, void, or resend envelopes.

Apply `supabase/phase40_docusign_archive_governance.sql`.

Cron:
- Backfill: `/api/docusign/archive-governance-worker?kind=backfill` every 10 minutes
- Sample scan: `/api/docusign/archive-governance-worker?mode=sample` daily

## Intune

- Threshold changes are versioned, bounded, and maker-checked. Tuning never
  closes or resets an open breaker.
- Aggregate outage episodes correlate durable observations without leaking
  entity-level detail.
- A read-only Graph health canary is fenced separately from half-open dispatch
  canaries and never authorizes POST.
- Operator dashboards expose breaker health, episode age, and canary outcomes.

Apply `supabase/phase40_intune_resilience_observability.sql`.

Existing Intune worker cron remains the delivery path.

## Shared Services and observability

- Draft vs published policies produce normalized field diffs with material-risk
  classification.
- Historical simulations are leased, counterfactual, and never mutate real
  alerts, incidents, or delivery jobs.
- Owner assignments carry effective and expiry windows. Expiring coverage and
  eligible successors surface as governance alerts.
- Existing `/api/ops/slo-evaluate` processes simulation and owner-expiry scans.

Apply `supabase/phase40_slo_governance.sql`.

## Snapshot retirement

- Signed export packages bind Phase 39 manifests, current validity, hashes, and
  artifact metadata under an HMAC keyring.
- External retention checks use allowlisted destination keys and HTTPS HEAD
  metadata only.
- Multi-hour canary orchestration is durable, leased, resumable, and explicitly
  non-qualifying for soak or attestation.
- Phase 40 contains no insert, update, delete, rename, alter, truncate, or drop
  against `os_store_snapshots`.

Apply `supabase/phase40_snapshot_retirement.sql`.

Cron: `/api/admin/snapshot-retirement-worker` every 15 minutes.

Required environment:
- `SNAPSHOT_EXPORT_HMAC_KEY_ID`
- `SNAPSHOT_EXPORT_HMAC_KEYS`
- `SNAPSHOT_RETENTION_ALLOWED_HOSTS`
- `SNAPSHOT_RETENTION_DESTINATIONS`
- Existing `CRON_SECRET`

## Deployment order

Apply after all Phase 39 migrations:

1. `phase40_marketing_authoritative_revenue.sql`
2. `phase40_docusign_archive_governance.sql`
3. `phase40_intune_resilience_observability.sql`
4. `phase40_slo_governance.sql`
5. `phase40_snapshot_retirement.sql`

Deploy the Phase 40 application immediately after the migrations.

Verify:

```bash
npm --prefix tagevc-os test
npm --prefix tagevc-os run lint
npm --prefix tagevc-os run build
git diff --check
```

## Phase 41+ recommendations

1. Wire production revenue ledgers and expand connector authenticity modes.
2. Complete legacy archive backfill and promote full integrity scans to a
   governed quarterly schedule.
3. Add Intune outage postmortems and automatic threshold recommendation drafts.
4. Add SLO simulation result exports and coverage calendar views.
5. Add externally verifiable signed export receipts and colder retention tiers.
6. Continue Stage 4e soak and attestation governance. Do not drop
   `os_store_snapshots` without the separately approved retirement operation.
