# Tage VC Operating System — Phase 14

**Schema normalization, Portfolio/Entity Master live tables, snapshot soak → read cutover.**

## What shipped

### Portfolio Active + Entity Master
| Area | Status |
|------|--------|
| Align `entities` columns with TS (`entity_type`, `track_origin`, `parent_entity_id`, …) | Done |
| Legacy column sync trigger (`type` ↔ `entity_type`, etc.) | Done |
| Write RLS + indexes on entities, portfolio, P&L, KPIs | Done |
| `entities-repo` + `portfolio-repo` (fetch/sync) | Done |
| `master-data` hydrate: SQL prefer → seed fallback → one-shot migrate | Done |
| Wire `repositories.ts` + `entity-os.ts` + document entity lookups | Done |
| Portfolio / Entities loading states + Live DB / Seed badge | Done |

### Snapshot soak & read cutover
| Area | Status |
|------|--------|
| Shared `shouldUseNormalizedRows()` dual-read gate | Done |
| Sync success/fail stats in `queueNormalizedSync` | Done |
| `GET /api/admin/normalization-status` soak diagnostics | Done |
| `os_normalization_counts` SQL view | Done |
| Updated retirement plan (Stage 1–2 executable) | Done — `docs/OS_SNAPSHOT_RETIREMENT.md` |

## Required ops step

1. Run **`tagevc-os/supabase/phase14_portfolio_entity.sql`** in Supabase SQL editor  
   (creates `portfolio_companies` / P&L / KPI tables if Phase 1/6 were never applied).  
2. Redeploy (or wait for auto-deploy).  
3. Hit Portfolio / Entities — first boot with empty tables migrates seed → SQL. Badge should move **Seed → Migrating → Live DB**.  
4. Optional soak check:
   ```bash
   curl -H "x-tagevc-digest-secret: $DIGEST_SECRET" \
     https://app.tagevc.com/api/admin/normalization-status
   ```
5. When dual-written domains look healthy for ~14 days, set Vercel env **`USE_NORMALIZED_TABLES=1`** (read cutover). Keep dual-write until Stage 3 exit criteria.

## Still snapshot / seed nested (not cut over)

- Handoffs (`icAudits`, VC/MA/RE handoff packs)
- Ticket / document audit trails inside JSONB payloads
- Full drop of `os_store_snapshots` (Stage 4 — later)

## Phase 15+ recommendations

1. Write cutover — stop `queueStorePersist` for healthy domains after exit criteria  
2. Normalize handoffs + audit events into first-class tables  
3. In-app Portfolio / Entity edit mutations (health, KPIs) writing SQL-first  
4. Entity-scoped RLS for subsidiary portals  
5. Richer moderation · DocuSign · push · Sentry
