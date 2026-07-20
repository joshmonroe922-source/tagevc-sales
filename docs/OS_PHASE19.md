# Tage VC Operating System — Phase 19

**Stage 4b SQL-only hydrate, CORE/FLEX KPI edits, harder pipeline scope, Stage 4d archive export.**

## What shipped

### Snapshot retirement
| Area | Status |
|------|--------|
| Stage 4b SQL-only hydrate when write cutover active | Done — `shouldLoadSnapshotPayload` |
| Rollback via `SNAPSHOT_READ_FORCE=1` | Done |
| Admin read gates + `sql_only_hydrate` stage | Done |
| Stage 4d archive metadata export API | Done — `/api/admin/archive-export` |
| Stage 4e DROP TABLE | Deferred (out of scope) |

### Financial & KPI
| Area | Status |
|------|--------|
| CORE KPI edit (non-money keys) | Done |
| FLEX KPI edit by industry module | Done |
| Financial / KPI audit history on Entity OS | Done |

### Entity / pipeline scope
| Area | Status |
|------|--------|
| Default hide null-entity rows for subsidiary roles | Done — `PIPELINE_NULL_ENTITY_MODE=hide` |
| Soft mode restore | `PIPELINE_NULL_ENTITY_MODE=soft` |

### Observability
| Area | Status |
|------|--------|
| Admin: SQL-only hydrate, null-entity mode, archive export | Done |
| Stage 4 docs updated | Done |

## Ops

No new SQL required (reuses Phase 17–18). After deploy:

1. Confirm **Admin → Normalization** shows **SQL-only hydrate · on** (with `WRITE_CUTOVER_ALL=1`)
2. Optional: download archive export for offsite retention
3. Smoke: Instant NDA CORE KPI + FLEX edit; history list updates
4. Optional: set `PIPELINE_NULL_ENTITY_MODE=soft` if pre-close unscoped pipeline rows must stay visible to `sub_lead`

### Env cheatsheet

```bash
# Already in prod
WRITE_CUTOVER_ALL=1

# Stage 4b (auto when write cutover on; force all reads off:)
READ_CUTOVER_ALL=1

# Rollback hydrate from snapshots
SNAPSHOT_READ_FORCE=1

# Pipeline null-entity visibility (default hide)
PIPELINE_NULL_ENTITY_MODE=hide   # or soft
```

## Still deferred

- Dropping `os_store_snapshots` (Stage 4e)
- Stopping all reads of the table (Stage 4c — partially achieved via 4b)
- DocuSign · push · full user admin UI

## Phase 20+ recommendations

1. Soak window confirmation + Stage 4c/4e when ready  
2. Harder RLS for null-entity hide (match app default)  
3. Richer KPI batch edit UI / period picker  
4. DocuSign · push · user admin
