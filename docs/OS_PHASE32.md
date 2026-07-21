# Tage VC Operating System — Phase 32

**Verified publishing · deeper paid reporting · recipient-aware DocuSign · durable action intent · safer IT offboarding · auditable warranty changes · fail-closed soft-rename evidence.**

## What shipped

### Multichannel Marketing

- TikTok Content Posting API jobs now remain queued while TikTok processes the
  upload. The worker polls the publish-status endpoint and does not create a
  duplicate post on retry.
- TikTok engagement uses the confirmed public post ID.
- Organic API engagement is stored as one current snapshot per schedule job,
  preventing repeated pulls from inflating cumulative metrics.
- LinkedIn Ads aggregates every returned insight element and records reporting
  dates, currency, CPC, CPM, conversion rate, CPA, and budget utilization.
- Meta paid snapshots also retain currency and efficiency metrics.
- Aggregate ROI/ROAS is suppressed when paid results contain mixed currencies.
- Paid rollups show campaign name, entity, currency, efficiency, and budget use.
- Paid campaign validation and content/account platform/entity checks are
  enforced before scheduling or synchronization.

### DocuSign

- Live envelope filtering now separates status, date window, and
  subject/ID/recipient search from event filters.
- Recipient routing status is visible directly in the live envelope table.
- Event search covers envelope, document, entity, deal, and ticket identifiers.
- Template search includes name, description, and ID; sync freshness is shown.
- Void intent is durably recorded before the irreversible remote operation.
  Failures and final success remain separate audit events.
- Replacement creation records intent, child-to-source lineage, and reciprocal
  source-to-child lineage with actor email.

### IT automation

- Required litigation hold no longer blocks its own execution, and failed steps
  can be retried.
- Exchange automation acceptance is not treated as legal-hold completion. The
  endpoint must return `verified: true`; accepted jobs remain pending.
- SKU removal stays gated by verified hold and occurs before optional Entra
  user soft-delete.
- Offboarding completion no longer converts pending automation into successful
  verification. Only the explicit manual SSO confirmation is completed by the
  operator action.
- Intune inventory follows Graph pagination and captures richer device,
  compliance, encryption, and last-sync context.
- Group assignment checks existing membership; arbitrary HTTP 400 responses are
  no longer treated as success.
- Warranty imports enforce byte/row limits, handle UTF-8 BOMs, reject malformed
  headers and duplicate/conflicting rows, and persist before/after lifecycle
  evidence.

### Snapshot retirement

- Empty-snapshot drills fail closed on relation/query errors and become aware
  of the exact configured retired relation after a verified soft rename.
- Soft-rename readiness now requires approval before rename, a non-empty
  verified retired relation, and a matching `renamed` or `rename_verified`
  database event for the same table and approver.
- Soak observations are durable in `os_snapshot_soak_observations`; process
  memory remains only a compatibility fallback.
- Rename readiness is separated from legacy destructive retention/approval
  gates.
- `phase32_stage4e_soft_rename.sql` remains manual/offline and contains no
  destructive statement. The application does not rename or drop
  `os_store_snapshots`.

## SQL

Apply:

1. `tagevc-os/supabase/phase32_operational_evidence.sql`

Only after the reviewed production gates are complete, use the commented,
offline guidance in:

2. `tagevc-os/supabase/phase32_stage4e_soft_rename.sql`

## Optional environment

```bash
LINKEDIN_ADS_CURRENCY=USD
META_ADS_CURRENCY=USD
```

The Exchange automation response must use this contract only after
provider-side verification:

```json
{"verified":true,"job_id":"exchange-job-id","hold_enabled_at":"2026-07-20T00:00:00Z"}
```

## Phase 33+ recommendations

1. Bind paid ad accounts and OAuth tokens per entity and currency instead of
   relying on global reporting tokens.
2. Add TikTok creator-capability preflight and resumable binary upload.
3. Add DocuSign continuation-token pagination and a multi-role replacement form
   without prompt dialogs.
4. Persist Intune inventory/actions as structured per-device records with
   approval, polling, verification, and local serial correlation.
5. Add transactional warranty import preview/commit batches with downloadable
   failure files.
6. Require a durable healthy-observation streak throughout the rename soak and
   automatically reset it on rollback or degraded evidence.
7. Keep push notifications, user administration, major modules, and any
   destructive snapshot action deferred.
