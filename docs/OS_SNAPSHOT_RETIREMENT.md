# Snapshot Retirement Plan — `os_store_snapshots`

**Status:** Phase 31 — Stage 4e requires durable retirement evidence, a valid rename timestamp/table name, written approval, verified retired table, and a configurable rename soak. The app does not rename or drop `os_store_snapshots`. Offline guide: `phase31_stage4e_soft_rename.sql`.

## Dual-write / dual-read map

| Domain | Normalized tables | Snapshot writes |
|--------|-------------------|-----------------|
| `deal_flow` | leads/deals/IC + audits/handoffs | Skip via `WRITE_CUTOVER_MATURE` or `WRITE_CUTOVER_ALL` |
| `tickets` / `documents` | + audit tables | Same |
| `ma` / `re` | + handoffs | Skip via `WRITE_CUTOVER_ALL` or `SNAPSHOT_SKIP_DOMAINS` |
| Portfolio / Entity | live tables | No snapshots |
| Messaging | first-class | N/A |

## Stages

1. **Soak** — Dual-write; prefer SQL on hydrate.  
2. **Read cutover** — `USE_NORMALIZED_TABLES=1`.  
3. **Write cutover** — `WRITE_CUTOVER_MATURE` → then `WRITE_CUTOVER_ALL` (or skip list).  
4. **Soft-archive (Phase 16)** — `archive_store_snapshot(collection)` copies to `os_store_snapshot_archive`, clears live payload to `{}`.  
5. **Drop (later)** — See **`docs/OS_SNAPSHOT_STAGE4.md`**.

## Ops

### Enable cutover
```bash
WRITE_CUTOVER_MATURE=1   # deal_flow, tickets, documents
WRITE_CUTOVER_ALL=1      # + ma, re
```

### Soft-archive
- UI: `/admin/normalization`  
- API: `POST /api/admin/snapshot-archive` with `{ "only_cutover": true }`  
- Safety: refuses archive when primary normalized table is empty  

### Empty-snapshot drills
- UI: Admin Normalization → Empty-snapshot drills  
- API: `GET /api/admin/snapshot-drill`  

### Soak health
- Cron: every 6h → `/api/admin/soak-health`  
- Alerts Sentry on sync failures / FK orphans / failed drills  

### Rollback write cutover
Unset cutover env vars and redeploy. Snapshot upserts resume. Restore from archive with SQL (see Stage 4 doc).

### Governed soft rename

1. Apply `phase31_marketing_it_governance.sql`.
2. Complete production drills, retention, export, and written approval gates.
3. Review the commented transaction in `phase31_stage4e_soft_rename.sql`.
4. Perform the rename offline and record `os_snapshot_retirement_events`.
5. Set the four `SNAPSHOT_SOFT_RENAME*` / retired-table environment values.
6. Observe the rename soak; rollback by renaming the table back if needed.

No Phase 31 SQL contains a DROP statement.

## Exit criteria before drop

- [x] Soft-archive completed for cut-over collections (Phase 16)  
- [x] FKs validated (Phase 17)  
- [x] Empty-snapshot drills documented + tooling (Phase 18)  
- [x] SQL-only hydrate for cut-over domains (Phase 19 Stage 4b)  
- [ ] Empty-snapshot drills passing in production (ops confirm)  
- [ ] Archive backup retained (use `/api/admin/archive-export`)  
- [ ] App hydrate paths no longer require snapshot payloads for pipeline domains  
- [ ] Written soft-rename approval and durable audit evidence recorded
- [ ] Retired table verified and rename soak completed

## Blockers for fully retiring `os_store_snapshots`

1. Stage 4c full stop (no table reads at all) not required while soft-archived `{}` rows remain.  
2. Need confirmed production drill pass + soak window.  
3. Stage 4e DROP still deferred.  

## Non-goals

- Dropping the table in Phase 16–19  
- DocuSign / push
