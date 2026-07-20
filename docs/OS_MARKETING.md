# Multichannel Marketing System — Architecture (Phases 22–26)

**Status:** Functional · hub under Shared Services · Marketing.  
**Live at:** `/shared-services/marketing`

## Goals

1. Centralized marketing for **Tage VC** (firm-wide = `entity_id` null)  
2. Scoped usage by **subsidiaries / portfolio** (`entity_id` set)  
3. Extensible AI generation + multi-platform social + scheduling + analytics  

## Placement

| Layer | Path |
|-------|------|
| Hub | `/shared-services/marketing` |
| Types | `lib/shared-services/marketing-types.ts` |
| Repo | `lib/shared-services/marketing-repo.ts` |
| AI | `lib/shared-services/marketing-ai.ts` |
| OAuth / tokens | `marketing-oauth.ts`, `marketing-crypto.ts`, `marketing-token-refresh.ts` |
| Publishers | `marketing-social.ts` |
| Scheduler | `marketing-scheduler.ts` |
| Analytics / engagement | `marketing-analytics.ts`, `marketing-engagement.ts` |
| SQL | `phase22`–`phase25` marketing SQL |

## Data model

```
os_marketing_campaigns
os_marketing_content                 — + external_post_id (Phase 25)
os_marketing_social_accounts
os_marketing_oauth_tokens
os_marketing_brand_voices
os_marketing_schedule_jobs
os_marketing_generation_jobs
os_marketing_analytics_events
```

## Platforms

| Platform | OAuth | Publish | Token refresh | Live engagement |
|----------|-------|---------|---------------|-----------------|
| LinkedIn | Yes | Yes | Yes | Yes |
| X | Yes | Yes | Yes | Yes (Phase 26) |
| Facebook / Instagram (Meta) | Yes | Basic | Yes | Yes |
| YouTube | Yes (Google) | Stub/limited | Via Google refresh | No |

## Permissions

| Permission | Roles (examples) |
|------------|------------------|
| `read:marketing` | visionary, partner, coo, service_lead, sub_lead, admin |
| `write:marketing` | visionary, coo, service_lead, admin |

## Phase 27+

1. Approval SLA tied to Shared Services tickets  
2. LinkedIn Marketing API impressions / YouTube analytics  
3. Paid media / ads (out of current scope)  
