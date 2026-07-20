# Multichannel Marketing System — Architecture (Phases 22–29)

**Status:** Functional · hub under Shared Services · Marketing.  
**Live at:** `/shared-services/marketing`

## Platforms

| Platform | OAuth | Publish | Live engagement |
|----------|-------|---------|-----------------|
| LinkedIn | Yes | Yes | Yes |
| X | Yes | Yes | Yes |
| Meta | Yes | Basic | Yes |
| YouTube | Yes | Stub | Yes (opt-in Analytics) |
| TikTok | Yes (Login Kit) | Stub | Opt-in API |

## Phase 29

1. TikTok OAuth connect via `TIKTOK_CLIENT_KEY/SECRET`  
2. Paid campaign stubs: `channel`, `budget_k`, `ad_platform`, `external_campaign_id`  
3. SLA assignee: `MARKETING_SLA_ASSIGNEE` → ticket + `approval_assignee`  

SQL through `phase29_paid_media_warranty.sql`.

## Phase 30+

1. TikTok publish publisher  
2. Paid ads API connectors  
3. Assignee email digests  
