# Tage VC Operating System — Phase 30

**TikTok publish · paid ads foundation · assignee SLA digests · DocuSign filters / void policy · Graph mailbox disable · bulk warranty · Stage 4e soft-rename visibility (no DROP).**

## What shipped

### Multichannel Marketing
| Area | Status |
|------|--------|
| TikTok publisher (inbox / direct photo opt-in) | Done |
| Paid ads API foundation (`syncPaidCampaign` + Meta insights opt-in) | Done |
| Assignee email digests (`MARKETING_SLA_EMAIL_ASSIGNEES`) | Done |
| Hub “Sync paid” + Phase 30 analytics visibility | Done |

### DocuSign
| Area | Status |
|------|--------|
| Advanced envelope/event filters (status, event_type) | Done |
| Void policy (`DOCUSIGN_VOID_POLICY`: allow / warn_capital / block_capital) | Done |
| Event type column + filter chips in hub | Done |

### IT automation
| Area | Status |
|------|--------|
| Graph disable account / mailbox (`MS_GRAPH_DISABLE_ACCOUNT`) | Done |
| Bulk warranty import (asset_id or serial + date) | Done |
| Offboarding checklist item for mailbox disable | Done |

### Snapshot retirement
| Area | Status |
|------|--------|
| Soft-rename path copy → `phase30_stage4e_drop.sql` | Done |
| `SNAPSHOT_SOFT_RENAMED_AT` checklist visibility | Retained |
| App DROP of `os_store_snapshots` | **Not done** |

## SQL

No new schema SQL required (Phase 29 columns cover paid media + warranty).  
Offline notice only: **`tagevc-os/supabase/phase30_stage4e_drop.sql`** (do not run DROP from the app).

Optional: re-apply `phase29_paid_media_warranty.sql` if any env is missing those columns.

## Env (optional)

```bash
# Marketing
TIKTOK_PUBLISH_DIRECT=0
TIKTOK_DEFAULT_IMAGE_URL=
MARKETING_SLA_EMAIL_ASSIGNEES=0
MARKETING_PAID_ADS_LIVE=0

# DocuSign
DOCUSIGN_VOID_POLICY=allow   # allow | warn_capital | block_capital

# IT
MS_GRAPH_DISABLE_ACCOUNT=0

# Snapshot (ops)
SNAPSHOT_SOFT_RENAMED_AT=
ALLOW_SNAPSHOT_DROP=0
```

## Out of scope

- Full push notification system  
- User admin UI  
- Dropping `os_store_snapshots`  
- Full LinkedIn Ads / TikTok video upload pipeline  

## Phase 31+ recommendations

1. **Marketing:** Richer TikTok video upload; LinkedIn Ads insights; campaign ROI rollups in hub  
2. **DocuSign:** Envelope list UX polish; template library search; void undo / restore policy  
3. **IT:** Mailbox soft-delete / litigation hold options; warranty CSV upload file; Intune retire device on offboard  
4. **Stage 4e:** Execute soft rename in a controlled window after checklist green + written approval  
5. **Platform:** Push · user admin (still deferred)  
