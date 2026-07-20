# Snapshot Stage 4 — Final retirement plan

**Status:** Phase 19 — Stage 4b (SQL-only hydrate) + 4d export tooling shipped.  
**Non-goal:** Dropping `os_store_snapshots` in Phase 19.

## Preconditions (all must be green)

1. `WRITE_CUTOVER_ALL=1` (or equivalent) in production  
2. Soft-archive completed for all five pipeline collections  
3. **Empty-snapshot drills pass** (`Admin → Normalization` or `GET /api/admin/snapshot-drill`)  
4. FK orphans = 0  
5. Sync failure count = 0 for a soak window (≥7–14 days recommended)  
6. Archive backup retained (export via `/api/admin/archive-export` or DB dump)

## Stage 4 steps

| Step | Action | Status |
|------|--------|--------|
| 4a | Confirm drills + soak cron healthy | Ops / ongoing |
| 4b | SQL-only hydrate for cut-over domains | **Done (Phase 19)** — `shouldLoadSnapshotPayload` |
| 4c | Stop reading `os_store_snapshots` entirely | Partial (4b skips payload); full stop later |
| 4d | Export archive table; retain ≥90 days | **Tooling done** — `/api/admin/archive-export` |
| 4e | `DROP TABLE os_store_snapshots` | Deferred |

## Stage 4b behavior

When write cutover skips a domain (or `READ_CUTOVER_ALL=1` / `SNAPSHOT_READ_SKIP_DOMAINS`):

- Hydrate does **not** adopt live snapshot payloads  
- In-memory seed → SQL overlay only  
- Table retained for rollback  

Rollback hydrate: `SNAPSHOT_READ_FORCE=1` then redeploy.

## Empty-snapshot drill checks (per domain)

- Write cutover active (snapshot writes skipped)  
- Live payload empty `{}`  
- Primary normalized table non-empty  
- Archive row present  

## Soak monitoring

- Cron: `GET /api/admin/soak-health` every 6h (`tagevc-os/vercel.json`)  
- Auth: `Authorization: Bearer $CRON_SECRET` or `x-tagevc-digest-secret`  
- Alerts via Sentry when sync failures, FK orphans, or drills fail  

## Archive retention (4d)

- UI / API: `GET /api/admin/archive-export` (admin session or digest secret)  
- Keep `os_store_snapshot_archive` indefinitely until Stage 4e  
- Retain export ≥90 days offsite before any drop  

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

Then set `SNAPSHOT_READ_FORCE=1` briefly if needed to re-adopt payloads.
