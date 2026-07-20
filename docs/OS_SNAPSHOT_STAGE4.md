# Snapshot Stage 4 — Final retirement plan

**Status:** Phase 18 — empty-snapshot drills + soak health available.  
**Non-goal:** Dropping `os_store_snapshots` in Phase 18.

## Preconditions (all must be green)

1. `WRITE_CUTOVER_ALL=1` (or equivalent) in production  
2. Soft-archive completed for all five pipeline collections  
3. **Empty-snapshot drills pass** (`Admin → Normalization` or `GET /api/admin/snapshot-drill`)  
4. FK orphans = 0  
5. Sync failure count = 0 for a soak window (≥7–14 days recommended)  
6. Archive backup retained (export `os_store_snapshot_archive` or snapshot DB)

## Stage 4 steps (later phase)

| Step | Action | Reversible? |
|------|--------|-------------|
| 4a | Confirm drills + soak cron healthy | Yes |
| 4b | Remove hydrate snapshot branches for cut-over domains (SQL-only path) | Via revert |
| 4c | Stop reading `os_store_snapshots` entirely | Via revert |
| 4d | Export archive table; retain ≥90 days | Ops |
| 4e | `DROP TABLE os_store_snapshots` (and optionally archive later) | Restore from backup |

## Empty-snapshot drill checks (per domain)

- Write cutover active (snapshot writes skipped)  
- Live payload empty `{}`  
- Primary normalized table non-empty  
- Archive row present  

## Soak monitoring

- Cron: `GET /api/admin/soak-health` every 6h (`tagevc-os/vercel.json`)  
- Auth: `Authorization: Bearer $CRON_SECRET` or `x-tagevc-digest-secret`  
- Alerts via Sentry when sync failures, FK orphans, or drills fail  

## Archive retention

- Keep `os_store_snapshot_archive` indefinitely until Stage 4e  
- Optional: periodic CSV/JSON export to object storage before any drop  

## Rollback

Unset cutover env vars and restore live payload from archive:

```sql
update public.os_store_snapshots s
set payload = a.payload,
    version = a.version,
    updated_at = now()
from public.os_store_snapshot_archive a
where a.collection = s.collection
  and a.id = (
    select id from public.os_store_snapshot_archive x
    where x.collection = s.collection
    order by archived_at desc
    limit 1
  );
```
