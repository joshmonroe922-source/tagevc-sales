# Tage VC Operating System — Phase 31

**TikTok video publishing · LinkedIn Ads insights and ROI · live envelope management · safe void replacement · mailbox retention modes · warranty CSV · Intune lifecycle audit · governed Stage 4e soft rename.**

## What shipped

### Multichannel Marketing

- TikTok direct video publishing from an HTTPS media URL using Content Posting API.
- LinkedIn Ads 30-day insights for impressions, clicks, spend, and conversions.
- Latest-snapshot paid rollups: spend, attributed revenue, CTR, ROI, and ROAS.
- Campaign fields for external campaign ID and attributed revenue.
- Explicit entity checks for campaign/content creation and paid sync.

### DocuSign

- Authoritative 30-day live-envelope table with status filters and detail visibility.
- Status preflight and irreversible confirmation before void.
- Replacement-envelope workflow with lineage audit; voids are never represented as undoable.
- HTTP status, DocuSign error code, and trace token visibility for advanced actions.
- Audit-write failure is surfaced even when the remote action succeeded.

### IT automation

- Mailbox modes: `disable_only`, `retain_mailbox`, and opt-in `soft_delete_user`.
- Litigation hold through a controlled Exchange automation endpoint (not mislabeled as Microsoft Graph).
- Header-aware, quoted warranty CSV upload with file validation and zero-row update detection.
- Intune retirement results include device IDs and no longer let webhook success mask Graph failure.
- Immutable lifecycle-attempt table and hub visibility.

### Snapshot retirement

- Durable `os_snapshot_retirement_events` evidence.
- Strict rename timestamp, retired-table name, written approval, table verification, and rename-soak checks.
- Manual `phase31_stage4e_soft_rename.sql` with rollback guidance and no DROP statement.
- The application still does not rename or drop `os_store_snapshots`.

## SQL

Apply:

1. `tagevc-os/supabase/phase31_marketing_it_governance.sql`

Do not run the soft-rename block until the Admin Stage 4e checklist and written approvals are complete:

2. `tagevc-os/supabase/phase31_stage4e_soft_rename.sql`

## Optional environment

```bash
LINKEDIN_ADS_API=0
LINKEDIN_ADS_ACCESS_TOKEN=
LINKEDIN_API_VERSION=202506
TIKTOK_DEFAULT_VIDEO_URL=

IT_OFFBOARD_MAILBOX_MODE=disable_only
IT_OFFBOARD_LITIGATION_HOLD=0
EXCHANGE_AUTOMATION_URL=
EXCHANGE_AUTOMATION_SECRET=
MS_GRAPH_SOFT_DELETE_USER=0
INTUNE_AUTO_RETIRE=0

SNAPSHOT_SOFT_RENAMED_AT=
SNAPSHOT_RETIRED_TABLE_NAME=
SNAPSHOT_SOFT_RENAME_APPROVED_AT=
SNAPSHOT_SOFT_RENAME_APPROVED_BY=
SNAPSHOT_SOFT_RENAME_SOAK_DAYS=7
```

## Phase 32+ recommendations

1. TikTok binary/resumable upload and publish-status polling; per-account LinkedIn Ads OAuth binding.
2. DocuSign recipient detail drawer, pagination, and resend-blueprint support for multi-role replacements.
3. Exchange hold verification callbacks, deleted-user restore action, and serial-to-Intune device correlation.
4. Transactional warranty import preview/error download and richer asset retirement history.
5. Complete the governed Stage 4e rename soak before considering a separately approved offline destruction plan.
6. Push notifications and user admin remain deferred.
