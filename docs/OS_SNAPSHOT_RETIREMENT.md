# Snapshot Retirement Plan — `os_store_snapshots`

**Status:** Phase 16 — Full pipeline write cutover available; soft-archive ready. Table retained.

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
5. **Drop (later)** — Remove hydrate snapshot branches; drop table only when unused.

## Ops

### Enable cutover
```bash
WRITE_CUTOVER_MATURE=1   # deal_flow, tickets, documents
WRITE_CUTOVER_ALL=1      # + ma, re
```

### Soft-archive
- UI: `/admin/normalization`  
- API: `POST /api/admin/snapshot-archive` with `{ "only_cutover": true }`  
- Requires Phase 16 SQL. Refuses `deal_flow` archive if `os_leads` is empty.

### Rollback write cutover
Unset cutover env vars and redeploy. Snapshot upserts resume. Restore from archive with a manual SQL insert if needed.

## Exit criteria before drop

- [ ] `WRITE_CUTOVER_ALL` (or equivalent) ≥14 days, `sync_failure_count=0`  
- [ ] Soft-archive completed for cut-over collections  
- [ ] Empty-snapshot drills pass  
- [ ] Archive backup retained  

## Non-goals

- Dropping `os_store_snapshots` in Phase 16  
- DocuSign / push
