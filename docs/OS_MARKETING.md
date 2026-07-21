# Multichannel Marketing System — Architecture (Phases 22–30)

**Status:** Functional · hub under Shared Services · Marketing.  
**Live at:** `/shared-services/marketing`

## Platforms

| Platform | OAuth | Publish | Live engagement |
|----------|-------|---------|-----------------|
| LinkedIn | Yes | Yes | Yes |
| X | Yes | Yes | Yes |
| Meta | Yes | Basic | Yes |
| YouTube | Yes | Stub | Yes (opt-in Analytics) |
| TikTok | Yes (Login Kit) | Inbox / direct photo opt-in | Opt-in API |

## Phase 30

1. TikTok publisher (`TIKTOK_PUBLISH_DIRECT` + optional `TIKTOK_DEFAULT_IMAGE_URL`)  
2. Paid ads sync foundation (`MARKETING_PAID_ADS_LIVE` for Meta insights)  
3. Assignee SLA email digests (`MARKETING_SLA_EMAIL_ASSIGNEES`)  

SQL through `phase29_paid_media_warranty.sql` (no Phase 30 schema).

## Phase 31+

1. TikTok video upload pipeline  
2. LinkedIn Ads insights  
3. Campaign ROI rollups  
