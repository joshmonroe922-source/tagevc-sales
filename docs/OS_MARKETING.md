# Multichannel Marketing System — Architecture (Phases 22–31)

**Status:** Functional · hub under Shared Services · Marketing.  
**Live at:** `/shared-services/marketing`

## Platforms

| Platform | OAuth | Publish | Live engagement |
|----------|-------|---------|-----------------|
| LinkedIn | Yes | Yes | Yes |
| X | Yes | Yes | Yes |
| Meta | Yes | Basic | Yes |
| YouTube | Yes | Stub | Yes (opt-in Analytics) |
| TikTok | Yes (Login Kit) | Direct video/photo opt-in | Opt-in API |

## Phase 30

1. TikTok publisher (`TIKTOK_PUBLISH_DIRECT` + optional `TIKTOK_DEFAULT_IMAGE_URL`)  
2. Paid ads sync foundation (`MARKETING_PAID_ADS_LIVE` for Meta insights)  
3. Assignee SLA email digests (`MARKETING_SLA_EMAIL_ASSIGNEES`)  

SQL through `phase29_paid_media_warranty.sql` (no Phase 30 schema).

## Phase 31

1. TikTok HTTPS video publishing (`media_url` or `TIKTOK_DEFAULT_VIDEO_URL`)
2. LinkedIn Ads 30-day insights (`LINKEDIN_ADS_API` + reporting token)
3. Paid spend, revenue, CTR, ROI, and ROAS rollups using latest snapshots
4. Campaign-level external ID and attributed revenue tracking

SQL: `phase31_marketing_it_governance.sql`.

## Phase 32+

1. Resumable binary media upload + publish-status polling
2. Per-account Ads OAuth bindings
3. Server-side long-range analytics aggregation
