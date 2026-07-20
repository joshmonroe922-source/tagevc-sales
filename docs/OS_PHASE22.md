# Tage VC Operating System — Phase 22

**Multichannel Marketing foundation · Shared Services hub polish · Stage 4 tooling (no DROP).**

## What shipped

### Multichannel Marketing (foundation)
| Area | Status |
|------|--------|
| Architecture doc | Done — `docs/OS_MARKETING.md` |
| Domain types + platforms | Done |
| SQL: campaigns, content, accounts, schedule + generation jobs | Done — `phase22_marketing.sql` |
| Pluggable AI stub provider | Done — no live LLM |
| Schedule queue (persist only) | Done — no auto-post |
| Hub UI CRUD + stub generate | Done — `/shared-services/marketing` |
| Permissions `read:marketing` / `write:marketing` | Done |
| Entity scoping (null = firm-wide) | Done |

### Shared Services hub
| Area | Status |
|------|--------|
| Module cards show live + foundation (not only planned) | Done |
| Grouped by service (Legal / IT / Marketing) | Done |
| Marketing card added | Done |

### Snapshot retirement
| Area | Status |
|------|--------|
| Archive export POST confirm (offsite store) | Done |
| Stage 4e checklist: table retained item | Done |
| Stage 4e DROP | **Not done** (deferred) |

## SQL

Apply **`tagevc-os/supabase/phase22_marketing.sql`**.

## Ops after deploy

1. Apply Phase 22 SQL.  
2. Shared Services → Multichannel Marketing: create campaign, content, register account, stub AI draft, schedule.  
3. Confirm hub cards for DocuSign / IT / Marketing.  
4. Admin → optional archive export + “Confirm offsite store”.

## Out of scope

- Full AI content engine  
- OAuth social posting automation  
- Dropping `os_store_snapshots`  
- Push · user admin  

## Phase 23+ recommendations

1. **Marketing:** Live AI provider + brand voice per entity; OAuth social connect; schedule worker that posts.  
2. **DocuSign:** Signed PDF → `07_Signed`; templates / void.  
3. **IT assets:** Offboarding checklist automation.  
4. **Stage 4e:** Explicit DROP after ≥90-day retention + soak.  
5. **Platform:** Push notifications · user admin UI.  
