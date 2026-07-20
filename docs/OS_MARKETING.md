# Multichannel Marketing System — Architecture (Phase 22)

**Status:** Foundation · hub under Shared Services · Marketing.  
**Non-goal:** Live LLM generation, OAuth posting, or full automation in Phase 22.

## Goals

1. Centralized marketing for **Tage VC** (firm-wide = `entity_id` null)  
2. Scoped usage by **subsidiaries / portfolio** (`entity_id` set)  
3. Extensible AI generation + multi-platform social + scheduling  

## Placement

| Layer | Path |
|-------|------|
| Hub | `/shared-services/marketing` |
| Types | `lib/shared-services/marketing-types.ts` |
| Repo | `lib/shared-services/marketing-repo.ts` |
| AI framework | `lib/shared-services/marketing-ai.ts` |
| Scheduler stubs | `lib/shared-services/marketing-scheduler.ts` |
| SQL | `supabase/phase22_marketing.sql` |
| Docs | `docs/OS_MARKETING.md` |

## Data model

```
os_marketing_campaigns     — campaigns (draft → active → …)
os_marketing_content       — blog/social/email drafts & published
os_marketing_social_accounts — platform + handle metadata (no OAuth secrets)
os_marketing_schedule_jobs — queue for future workers
os_marketing_generation_jobs — AI job audit trail
```

## Frameworks (pluggable)

### AI (`MarketingAiProvider`)
- Default: `StubMarketingAiProvider` — materializes draft content without external calls  
- Swap via `setMarketingAiProvider` / `MARKETING_AI_PROVIDER` in Phase 23+  

### Scheduler
- `enqueueScheduleJob` persists pending jobs and marks content `scheduled`  
- `MARKETING_SCHEDULER_ENABLED` reserved for future worker loops  
- **Does not post** to social networks in Phase 22  

## Permissions

| Permission | Roles (examples) |
|------------|------------------|
| `read:marketing` | visionary, partner, coo, service_lead, sub_lead, admin |
| `write:marketing` | visionary, coo, service_lead, admin |

## Phase 23+ slices

1. Real AI provider (OpenAI/Anthropic) with brand voice packs per entity  
2. OAuth connect for LinkedIn / X / Meta (secrets in vault, not Postgres plaintext)  
3. Worker that drains `os_marketing_schedule_jobs` and posts  
4. Approval workflow (content `review` → `approved`) tied to SS tickets  
5. Analytics / engagement ingest  

## Out of scope here

- Full AI content engine  
- Complete social scheduling automation  
- Ad-buy / paid media  
