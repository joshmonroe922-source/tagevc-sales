# Multichannel Marketing System — Architecture (Phases 22–24)

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
| Analytics | `marketing-analytics.ts` |
| SQL | `phase22_marketing.sql` + `phase23_automation.sql` + `phase24_maturation.sql` |

## Data model

```
os_marketing_campaigns
os_marketing_content
os_marketing_social_accounts
os_marketing_oauth_tokens          — encrypted vault (+ refresh metadata Phase 24)
os_marketing_brand_voices
os_marketing_schedule_jobs
os_marketing_generation_jobs
os_marketing_analytics_events      — Phase 24 post/engagement events
```

## Platforms

| Platform | OAuth | Publish | Token refresh |
|----------|-------|---------|---------------|
| LinkedIn | Yes | Yes | Yes |
| X | Yes | Yes | Yes |
| Facebook / Instagram (Meta) | Yes | Basic | Yes |
| YouTube | Yes (Google) | Stub/limited | Via Google refresh |

## Permissions

| Permission | Roles (examples) |
|------------|------------------|
| `read:marketing` | visionary, partner, coo, service_lead, sub_lead, admin |
| `write:marketing` | visionary, coo, service_lead, admin |

## Phase 25+

1. Live engagement ingest from platform APIs  
2. Approval SLA tied to Shared Services tickets  
3. Paid media / ads (out of current scope)  
