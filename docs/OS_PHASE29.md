# Tage VC Operating System — Phase 29

**TikTok OAuth · paid media stubs · SLA assignee routing · live template refresh · void audit · Graph offboard remove · warranty · Stage 4e soft-rename env (no DROP).**

## What shipped

### Multichannel Marketing
| Area | Status |
|------|--------|
| TikTok OAuth (Login Kit connect flow) | Done |
| Paid media campaign stubs (channel/budget/ad_platform) | Done |
| SLA assignee routing (`MARKETING_SLA_ASSIGNEE`) | Done |
| Hub visibility (paid badges, assignee on review) | Done |

### DocuSign
| Area | Status |
|------|--------|
| Live template recipient/role refresh | Done |
| Void reason required + actor audit payload | Done |
| Void audit card in hub | Done |

### IT automation
| Area | Status |
|------|--------|
| Graph remove groups/SKUs on offboard (opt-in) | Done |
| Hardware `warranty_ends_at` + renewals prefer warranty | Done |
| Hub warranty column + form field | Done |

### Snapshot retirement
| Area | Status |
|------|--------|
| `SNAPSHOT_SOFT_RENAMED_AT` checklist visibility | Done |
| Offline `phase29_stage4e_drop.sql` (notice only) | Done |
| App DROP of `os_store_snapshots` | **Not done** |

## SQL

Apply **`tagevc-os/supabase/phase29_paid_media_warranty.sql`**.

## Env (optional)

```bash
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
MARKETING_SLA_ASSIGNEE=

MS_GRAPH_REMOVE_GROUPS=0
MS_GRAPH_REMOVE_SKUS=0
MS_GRAPH_OFFBOARD_GROUP_IDS=
MS_GRAPH_OFFBOARD_SKU_IDS=

SNAPSHOT_SOFT_RENAMED_AT=
ALLOW_SNAPSHOT_DROP=0
```

## Out of scope

- Full push notification system  
- User admin UI  
- Dropping `os_store_snapshots`  
- Live paid ads APIs / TikTok publish  

## Phase 30+ recommendations

1. **Marketing:** TikTok publish publisher; paid ads API connectors; SLA digests to assignee email  
2. **DocuSign:** Envelope list filters; void undo policy docs  
3. **IT:** Bulk warranty import; Graph mailbox disable  
4. **Stage 4e:** Execute soft rename in controlled window after checklist green  
5. **Platform:** Push · user admin  
