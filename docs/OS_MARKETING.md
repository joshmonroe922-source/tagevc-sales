# Multichannel Marketing System — Architecture (Phases 22–32)

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

## Phase 32

1. TikTok publish-status polling with duplicate-initiation prevention
2. Current-snapshot organic engagement instead of cumulative double counting
3. LinkedIn Ads reporting dates, currencies, CPC/CPM/CPA, conversion rate, and
   budget utilization
4. Mixed-currency ROI guard and entity-aware paid campaign labels
5. Explicit account selection with entity/platform validation when scheduling

SQL: `phase32_operational_evidence.sql` is shared operational evidence only;
Marketing needs no Phase 32 schema change.

## Phase 33

1. Cryptographically random, one-time OAuth state with expiry, platform,
   purpose, actor, and entity binding
2. Publisher vs paid-ad connections; paid campaigns require a connected
   same-entity LinkedIn or Meta ad account
3. Live ad sync uses the account token, strict provider dispatch, current
   configurable API versions, explicit reporting windows, and no token in URLs
4. Browser-to-TikTok resumable `FILE_UPLOAD` with sequential chunk evidence,
   creator capability preflight, explicit privacy choice, and existing
   publish-status polling
5. Worker-time account/content/platform/entity/status revalidation and
   production stub publishing disabled by default

SQL: `phase33_marketing_connections.sql`.

## Phase 34

1. Paid OAuth grants remain pending until live Meta/LinkedIn discovery,
   explicit provider-account selection, and a reporting permission probe pass.
2. Paid campaign sync stores typed, idempotent daily rows by account, campaign,
   and reporting date rather than relying only on overlapping JSON snapshots.
3. The hub exposes 7/30/90-day daily spend/click trends, data-through dates,
   account scope health, and provider conversion metric selection.
4. Paid account/campaign bindings are checked in PostgreSQL for provider,
   connection status, and entity consistency.
5. Subsidiary pages filter campaigns, content, jobs, accounts, voices, and typed
   analytics to the active entity.

SQL: `phase34_marketing_analytics.sql`.

## Phase 35

1. Six-hour scheduled paid sync queues deterministic seven-day windows covering
   the rolling 28 complete provider days and missing 90-day bootstrap history.
2. Database leases, complete-window replacement, response hashes, retry state,
   and independent coverage days prevent partial responses from appearing
   complete.
3. Meta uses bounded cursor pagination and campaign-specific conversion actions;
   LinkedIn uses bounded campaign batches and explicit daily dates.
4. Hub operations show account health, coverage, windows, attempts, rows, and
   errors under entity scope.

SQL: `phase35_marketing_paid_backfill.sql`.

## Phase 36

1. Historical scheduling uses missing per-account coverage across the exact
   previous 90 complete dates.
2. LinkedIn reporting follows bounded pages; scheduling and one-window worker
   processing run independently.
3. Provider-account reselection increments a connection revision and clears
   stale reporting state atomically.
4. Manual campaign sync queues governed windows instead of directly overwriting
   daily metrics.
5. Reporting requires every eligible account for overall completeness and shows
   currency-grouped totals without cross-currency summation.

SQL: `phase36_marketing_paid_reliability.sql`.

## Phase 37+

1. Provider fixtures and authoritative account-total reconciliation
2. Period-aligned attributed revenue
3. TikTok upload cancellation/reinitialization
