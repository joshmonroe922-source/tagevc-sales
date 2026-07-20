# Tage VC Operating System — Phase 18

**Snapshot retirement progress, pipeline entity scope, CORE financial edits, soak observability.**

## What shipped

### Snapshot retirement
| Area | Status |
|------|--------|
| Empty-snapshot drills (API + admin UI) | Done — `snapshot-drills.ts`, `/api/admin/snapshot-drill` |
| Archive safety for all pipeline domains | Done — `assertArchiveSafe` |
| Stage 4 plan doc | Done — `docs/OS_SNAPSHOT_STAGE4.md` |
| Soak health cron (every 6h) | Done — `/api/admin/soak-health` + `tagevc-os/vercel.json` |

### Entity scoping
| Area | Status |
|------|--------|
| Parent/child parity in app `canAccessEntityId` | Done |
| Soft RLS on leads / deals / MA / RE / handoffs | Done — `phase18_pipeline_entity_rls.sql` |
| App-layer scoped list helpers + list pages | Done — `pipeline-scope.ts` |

### Financial data
| Area | Status |
|------|--------|
| CORE $ edit form (ARR, burn, cash, runway, MoM, COGS, OpEx) | Done |
| Rollup guards (Portfolio Active ↔ same-period P&L) | Done |
| Append-only financial audit table | Done — `phase18_financial_audit.sql` |

### Observability
| Area | Status |
|------|--------|
| Sentry tags (`cutover`, `vercel_env`) | Done |
| Admin drills + Stage 4 ready badge | Done |
| Soak alerts on degraded health | Done |

## Required ops step

1. Run **`tagevc-os/supabase/phase18_pipeline_entity_rls.sql`**  
2. Run **`tagevc-os/supabase/phase18_financial_audit.sql`**  
3. Redeploy (enables soak cron on Vercel)  
4. Confirm **Admin → Normalization** shows Stage 4 drills pass (or pending with clear failures)  
5. Smoke: edit Instant NDA CORE financials; confirm roll-up updates  

## Notes

- Service role still bypasses RLS — app-layer `pipeline-scope` is the primary server guard for list pages.  
- Unscoped pipeline rows (`entity_id` / `related_entity_id` null) remain visible to subsidiary roles (soft scope).  
- `os_store_snapshots` is **not** dropped in Phase 18.

## Still deferred

- Dropping `os_store_snapshots`  
- Hydrate path fully SQL-only (Stage 4b)  
- DocuSign · push · full user admin UI  

## Phase 19+ recommendations

1. Execute Stage 4b–4e after soak window (hydrate SQL-only → drop table)  
2. Harder pipeline scope (hide null-entity rows from sub_lead) if product requires  
3. KPI flex edits + richer financial history UI  
4. User admin UI · DocuSign · push notifications  
