# Tage VC Operating System — Phase 16

**Write cutover advancement (MA/RE), snapshot soft-archive, observability, admin health UI.**

## What shipped

### Write cutover
| Area | Status |
|------|--------|
| `WRITE_CUTOVER_ALL=1` (includes MA/RE) | Done |
| Keep `WRITE_CUTOVER_MATURE` for leads/tickets/docs | Done |
| Soft-archive: `os_store_snapshot_archive` + `archive_store_snapshot()` | Done |
| `POST /api/admin/snapshot-archive` (admin session or digest secret) | Done |
| Safety check: refuse archiving `deal_flow` if `os_leads` empty | Done |

### Schema
| Area | Status |
|------|--------|
| Handoff/audit indexes (`entity_id`, `portfolio_id`, `track+source`) | Done |
| Optional FKs as `NOT VALID` (validate after orphan cleanup) | Done |

### Observability & admin
| Area | Status |
|------|--------|
| `@sentry/nextjs` + `instrumentation.ts` (opt-in via `SENTRY_DSN`) | Done |
| Sync failures → `captureException` | Done |
| `/admin` hub + `/admin/normalization` health UI | Done |
| Shared `getNormalizationStatus()` for API + UI | Done |

## Required ops step

1. Run **`tagevc-os/supabase/phase16_snapshot_archive.sql`** in Supabase.  
2. Redeploy.  
3. Open **Admin → Normalization health** (Visionary/Admin).  
4. Enable cutover on Vercel (gradual):
   ```bash
   WRITE_CUTOVER_MATURE=1          # leads / tickets / docs
   # then, when ready:
   WRITE_CUTOVER_ALL=1             # + MA / RE
   ```
5. Soft-archive cut-over collections from the admin UI (or):
   ```bash
   curl -X POST -H "x-tagevc-digest-secret: $DIGEST_SECRET" \
     -H "content-type: application/json" \
     -d '{"only_cutover":true}' \
     https://app.tagevc.com/api/admin/snapshot-archive
   ```
6. Optional: set `SENTRY_DSN` on Vercel.

## Still deferred

- Dropping `os_store_snapshots`  
- Validating FKs (`VALIDATE CONSTRAINT`) after orphan cleanup  
- DocuSign · push notifications · full user admin

## Phase 17+ recommendations

1. Validate FKs; empty-snapshot drills for all pipeline domains  
2. Entity-scoped RLS for subsidiary portals  
3. Financial portfolio edits with rollup guards  
4. Richer Sentry alerts / soak cron  
5. DocuSign · push
