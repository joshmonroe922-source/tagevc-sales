# Tage VC Operating System — Phase 33

Phase 33 strengthens Marketing connection boundaries, DocuSign list and
replacement workflows, IT automation integrity, and Stage 4e evidence. It adds
no major module and provides no application path to rename or drop
`os_store_snapshots`.

## Shipped

### Marketing

- One-time, expiring OAuth state persisted as a SHA-256 hash and bound to the
  initiating actor, account, platform, purpose, and entity.
- Publisher and paid-ad account types; paid campaigns require a connected,
  provider-compatible same-entity account.
- Live Meta/LinkedIn reporting uses the bound OAuth token and strict provider
  routing. Meta tokens are sent in authorization headers.
- Resumable TikTok `FILE_UPLOAD`: creator preflight, explicit privacy,
  sequential chunks, durable progress, and queued publish-status polling.
- Scheduler revalidates content state and entity/platform/account compatibility
  immediately before provider execution. Stub OAuth/publishing is opt-in.

### DocuSign

- Typed envelope and template pagination with result totals and independent hub
  page parameters.
- Bounded continuation-page template synchronization and database-side cached
  template search.
- Multi-role replacement form based on cached template roles.
- Durable idempotent replacement lineage records intent before remote send,
  enforces capital permission, captures actor/context/roles, and records
  explicit failures.

### IT

- Warranty CSV preview creates an immutable batch without changing assets.
- Commit locks and revalidates all rows, then updates assets, writes lifecycle
  evidence, and commits the batch atomically. Any stale or invalid row prevents
  all updates.
- Intune retire now creates per-device idempotent action and transition records.
  Graph acceptance is `submitted`, not `verified`; reruns poll state before any
  repeat POST.

### Snapshot retirement

- Durable soak epochs track healthy streak start, count, last observation,
  required duration, maximum gap, reset reason, and qualification.
- Unhealthy observations, gaps over eight hours, and durable rollback evidence
  break continuity.
- Admin normalization health shows epoch state and the retirement-event
  timeline.
- `phase33_stage4e_soft_rename.sql` is guidance only and contains no rename or
  destructive statement.

## SQL deployment order

1. `phase33_marketing_connections.sql`
2. `phase33_docusign_lineage.sql`
3. `phase33_it_warranty_intune_soak.sql`

`phase33_stage4e_soft_rename.sql` is an offline operations guide, not an
application migration.

## Environment

- Set `LINKEDIN_API_VERSION=202607` and `META_API_VERSION=v25.0`.
- Keep `MARKETING_ALLOW_STUB_OAUTH=0` and
  `MARKETING_ALLOW_STUB_PUBLISH=0` in production.
- Existing OAuth client credentials, token vault, Graph, DocuSign, cron, and
  snapshot approval variables remain required for their respective live paths.

## Phase 34 recommendations

1. Add provider ad-account discovery/selection, verified granted-scope health,
   and typed daily paid metrics with 7/30/90-day trend reporting.
2. Add atomic scheduler leases, TikTok upload reinitialization/cancellation,
   and contract tests for provider throttling and chunk reconciliation.
3. Add DocuSign replacement reconciliation and a dedicated recipient detail
   view.
4. Add an Intune polling worker and explicit operator approval UI; correlate
   Intune serials to local assets without assuming serial uniqueness.
5. Add downloadable warranty preview failures and richer batch history.
6. Continue Stage 4e observation and rollback drills. Do not add application
   rename or DROP capabilities.
