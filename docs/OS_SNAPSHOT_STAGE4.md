# Snapshot Stage 4 — Final retirement plan

**Status:** Phase 20 — Stage 4e checklist + soak last-run on Admin.  
**Non-goal:** Dropping `os_store_snapshots` in Phase 20.

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
| 4a | Confirm drills + soak cron healthy | **UI + cron** — last soak on Admin |
| 4b | SQL-only hydrate for cut-over domains | **Done (Phase 19)** |
| 4c | Stop reading `os_store_snapshots` entirely | Partial (4b skips payload) |
| 4d | Export archive table; retain ≥90 days | **Tooling done** |
| 4e | `DROP TABLE os_store_snapshots` | Deferred — checklist on Admin |

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
- Admin: **Run soak now** + last-run card  
- Alerts via Sentry when sync failures, FK orphans, or drills fail  

## Archive retention (4d)

- UI / API: `GET /api/admin/archive-export`  
- Keep `os_store_snapshot_archive` indefinitely until Stage 4e  
- Retain export ≥90 days offsite before any drop  

## Stage 4e

Admin Normalization shows an informational checklist. **Export retention is always ops-manual** — the app never marks DROP as ready automatically.

## Rollback

Unset cutover env vars and restore live payload from archive (see Phase 19 docs). Then set `SNAPSHOT_READ_FORCE=1` briefly if needed.
