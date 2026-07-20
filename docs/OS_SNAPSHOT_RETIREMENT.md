# Snapshot Retirement Plan — `os_store_snapshots`

**Status:** Phase 25 — Stage 4e checklist + ≥90-day retention + explicit DROP approval env. Table retained until offline DROP.

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

## Exit criteria before drop

- [x] Soft-archive completed for cut-over collections (Phase 16)  
- [x] FKs validated (Phase 17)  
- [x] Empty-snapshot drills documented + tooling (Phase 18)  
- [x] SQL-only hydrate for cut-over domains (Phase 19 Stage 4b)  
- [ ] Empty-snapshot drills passing in production (ops confirm)  
- [ ] Archive backup retained (use `/api/admin/archive-export`)  
- [ ] App hydrate paths no longer require snapshot payloads for pipeline domains  

## Blockers for fully retiring `os_store_snapshots`

1. Stage 4c full stop (no table reads at all) not required while soft-archived `{}` rows remain.  
2. Need confirmed production drill pass + soak window.  
3. Stage 4e DROP still deferred.  

## Non-goals

- Dropping the table in Phase 16–19  
- DocuSign / push
