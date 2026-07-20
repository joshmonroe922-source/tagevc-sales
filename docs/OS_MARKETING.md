# Multichannel Marketing System — Architecture (Phases 22–28)

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
| SLA digests | `marketing-sla-digest.ts` · `/api/marketing/approval-sla-digest` |
| SQL | `phase22`–`phase28` marketing SQL |

## Platforms

| Platform | OAuth | Publish | Token refresh | Live engagement |
|----------|-------|---------|---------------|-----------------|
| LinkedIn | Yes | Yes | Yes | Yes (+ Marketing API impressions) |
| X | Yes | Yes | Yes | Yes |
| Facebook / Instagram (Meta) | Yes | Basic | Yes | Yes |
| YouTube | Yes (Google) | Stub/limited | Via Google refresh | Yes (Data API / Analytics opt-in) |
| TikTok | Stub | Stub | — | Opt-in API (`TIKTOK_ANALYTICS=1`) |

## Phase 28 workflows

1. **SLA digest** cron + hub button escalates overdue `review` content.  
2. **YouTube / TikTok** engagement pulls when posts have `external_id` and tokens.  
3. Set `MARKETING_SLA_DIGEST_TO` + `RESEND_API_KEY` for email digests.

## Phase 29+

1. Paid media / ads stubs  
2. TikTok OAuth connect UX  
3. SLA assignee routing  
