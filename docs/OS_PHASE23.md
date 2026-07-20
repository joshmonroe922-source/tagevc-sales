# Tage VC Operating System — Phase 23

**Marketing functional layer · DocuSign signed archives · IT offboarding · Stage 4 retention visibility.**

## What shipped

### Multichannel Marketing
| Area | Status |
|------|--------|
| Live OpenAI provider (`MARKETING_AI_PROVIDER=openai`) | Done — stub fallback |
| Per-entity brand voice | Done — `os_marketing_brand_voices` |
| OAuth LinkedIn / X (+ encrypted token vault) | Done when client IDs + `MARKETING_TOKEN_SECRET` set |
| Stub connect when OAuth not configured | Done |
| Schedule worker posts due jobs | Done — `/api/marketing/schedule-worker` + Vercel cron */15 |
| LinkedIn / X live publishers | Done when tokens present; else stub URL |
| Approve + schedule workflow polish | Done |
| Loading / status feedback in hub | Done |

### DocuSign
| Area | Status |
|------|--------|
| Completed → archive PDF/text into `07_Signed` + `os_docusign_signed_files` | Done |
| Hub lists signed archives | Done |

### IT offboarding
| Area | Status |
|------|--------|
| Offboarding runs + checklist | Done |
| Auto return hardware / revoke seats | Done |
| Manual access checklist item | Done |

### Snapshot retirement
| Area | Status |
|------|--------|
| Retention countdown from `ARCHIVE_EXPORT_CONFIRMED_AT` | Done |
| Stage 4e DROP | **Not done** |

## SQL

Apply **`tagevc-os/supabase/phase23_automation.sql`**.

## Env (optional)

See `.env.example` — `OPENAI_API_KEY`, `MARKETING_*`, LinkedIn/X OAuth, `MARKETING_TOKEN_SECRET`, `MARKETING_SCHEDULER_ENABLED=1`.

## Out of scope

- Full multi-channel analytics / ads  
- Complete IT onboarding automation  
- Dropping `os_store_snapshots`  
- Advanced DocuSign templates/void  

## Phase 24+ recommendations

1. Marketing: refresh-token rotation, Instagram/Meta, approval SLA, analytics ingest  
2. DocuSign: Supabase Storage for large PDFs; certificate of completion  
3. IT: ticket-driven offboarding from HR; MDM hooks  
4. Stage 4e: explicit DROP after retention window  
5. Push notifications · user admin  
