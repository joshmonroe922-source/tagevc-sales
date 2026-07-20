# Tage VC Operating System — Phase 17

**Data integrity (FK validate), entity-scoped access, pinned sidebar, edit/UX polish.**

## What shipped

### Data integrity
| Area | Status |
|------|--------|
| Orphan cleanup + `VALIDATE CONSTRAINT` for Phase 16 FKs | Done — `phase17_validate_fks.sql` |
| `os_fk_integrity` view for admin health | Done |

### Entity-scoped access
| Area | Status |
|------|--------|
| SQL helpers `can_access_entity` / `is_firm_wide_access` | Done — `phase17_entity_rls.sql` |
| Scoped RLS on entities, portfolio, P&L/KPIs, tickets, docs | Done |
| App-layer `entity-scope.ts` + repository filtering | Done |
| Write guards on Portfolio/Entity edit actions | Done |

### UI / UX
| Area | Status |
|------|--------|
| Fully fixed sidebar (`h-svh` + main scrollport) | Done |
| Portfolio/Entity edit polish (empty state, autosize feedback, placeholders) | Done |
| Admin health: FK orphans, sync failure detail, gate colors, fetched_at | Done |

### Observability
| Area | Status |
|------|--------|
| Capture exceptions on master-data save failures | Done |
| Snapshot retirement docs updated for Stage 4 blockers | Done |

## Required ops step

1. Run **`tagevc-os/supabase/phase17_validate_fks.sql`**  
2. Run **`tagevc-os/supabase/phase17_entity_rls.sql`**  
3. Redeploy  
4. Confirm **Admin → Normalization health** shows **FK orphans · 0**  
5. Smoke: scroll a long page — sidebar stays fixed; edit Instant NDA pulse

## Notes

- Persist client may use **service role** (bypasses RLS). App-layer entity scope in repositories/actions is the primary server guard; SQL RLS protects cookie-session and future client queries.
- Firm-wide roles (visionary/admin/partner/associate/coo/counsel/service_lead) and `entity_id` null/`ENT-FIRM` keep full access.

## Still deferred

- Dropping `os_store_snapshots`  
- Financial CORE $ field edits (rollup-sensitive)  
- DocuSign · push  

## Phase 18+ recommendations

1. Empty-snapshot drills + archive retention policy; Stage 4 planning  
2. Extend entity scope to deal-flow pipelines (optional)  
3. Financial portfolio edits with rollup guards  
4. Richer Sentry alerts / soak cron  
5. DocuSign · push · user admin UI
