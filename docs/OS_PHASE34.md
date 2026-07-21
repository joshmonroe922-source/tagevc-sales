# Tage VC Operating System — Phase 34

Phase 34 adds provider-backed paid-media reporting, controlled DocuSign
reconciliation, explicitly approved Intune retirement, and stronger Stage 4e
evidence. It adds no major module and no application path that mutates the
snapshot relation.

## Shipped

### Marketing

- Meta and LinkedIn paid OAuth grants now lead to provider account discovery,
  explicit selection, and a live reporting-scope probe.
- Connection health stores selected provider metadata, currency, timezone,
  role, scope status, and verification timestamps.
- Paid sync writes typed daily impressions, clicks, spend, and conversions with
  an idempotent account/campaign/date key.
- The hub exposes entity-scoped 7/30/90-day metrics, daily trend cards,
  data-through dates, and conversion metric configuration.
- Database validation rejects paid campaign bindings whose account provider,
  status, or entity does not match.

### DocuSign

- A durable envelope projection matches exact provider envelope IDs to local
  documents, events, and replacement lineage.
- Manual and scheduled reconciliation are observe-only and bounded. Ambiguous
  or conflicting mappings become review issues and are never guessed.
- The hub displays reconciliation counts, status drift, issue codes, and recent
  run outcomes.
- Event fallback identity is payload-derived and duplicate delivery is treated
  as a successful replay.
- Subsidiary views hide unmapped account-wide envelopes and filter event/file
  evidence to the active entity.

### IT

- Intune inventory creates requested retirement intents; it no longer performs
  inline automatic retirement.
- Explicit operator confirmation and reason are required before approval.
- A leased five-minute worker submits approved Graph actions, stores request
  correlation, polls provider state, and distinguishes accepted, verifying,
  verified, rejected, and timed-out outcomes.
- The IT hub displays request/device evidence, attempts, polls, provider state,
  Graph request ID, verification code, and errors.

### Snapshot retirement

- Structured drill runs persist each check with deployment revision,
  configuration fingerprint, and SHA-256 evidence hash.
- Only distinct six-hour cron buckets can qualify a soak epoch; manual runs are
  durable but non-qualifying.
- Duplicate cron delivery is idempotent, and rename verification is required
  before an epoch can begin.
- Configuration changes, unhealthy results, excessive gaps, and rollback
  evidence break continuity.
- `phase34_stage4e_drill_governance.sql` contains read-only evidence queries.

## SQL deployment order

1. `phase34_marketing_analytics.sql`
2. `phase34_docusign_reconciliation.sql`
3. `phase34_intune_drill_governance.sql`

`phase34_stage4e_drill_governance.sql` is an operations evidence guide, not an
application migration.

## Operational follow-up

- Reconnect existing paid-ad grants where needed, then use
  **Discover / select** and run each paid campaign sync to populate daily rows.
- Confirm the DocuSign reconciliation cron and run one manual observe-only pass.
- Review every requested Intune retirement before approval; keep Graph device
  permissions and `CRON_SECRET` configured.
- Let scheduled soak checks establish fresh Phase 34 evidence. Manual checks do
  not advance qualification.

## Phase 35 recommendations

1. Add scheduled account-level paid backfill, rolling attribution refresh,
   provider parser fixtures, and complete-window sync leases.
2. Move DocuSign send/replacement finalization into transactional projection
   operations and make signed archives content-hash idempotent.
3. Add Intune cancel/retry controls, fresh reapproval, and explicit
   operator-selected local asset correlation.
4. Add two-actor offline rollback rehearsal attestations and artifact review
   while preserving the strict non-execution boundary.
5. Continue performance and entity-scope hardening across Shared Services.
