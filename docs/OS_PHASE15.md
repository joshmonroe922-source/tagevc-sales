# Tage VC Operating System — Phase 15

**Write cutover for mature domains, Portfolio/Entity SQL-first edits, handoff/audit tables.**

## What shipped

### Write cutover (reversible)
| Area | Status |
|------|--------|
| Gate in `persist.ts` (`shouldWriteSnapshot`) | Done |
| `WRITE_SNAPSHOTS=0` + `SNAPSHOT_WRITE_DOMAINS` allowlist | Done |
| `SNAPSHOT_SKIP_DOMAINS` / `WRITE_CUTOVER_MATURE=1` for leads/tickets/docs | Done |
| Skip counters + gates in normalization-status API | Done |

Mutations remain **SQL-first** via `queueNormalizedSync`; snapshot writes are optional.

### Handoffs + audits (unlock safe cutover)
| Table | Status |
|-------|--------|
| `os_handoffs` | Done — dual-write from VC / MA / RE |
| `os_ic_audits` | Done |
| `os_ticket_audits` | Done |
| `os_doc_audits` | Done |

### Portfolio & Entity Master edits
| Area | Status |
|------|--------|
| SQL-first `patchPortfolioCompany` / `patchEntity` | Done |
| Forms on Entity OS overview (health, risk, notes, owners, status) | Done |
| Zod validation + `write:portfolio_health` RBAC | Done |

## Required ops step

1. Run **`tagevc-os/supabase/phase15_write_cutover.sql`** in Supabase.  
2. Redeploy.  
3. Confirm Portfolio / Entity edits save (badge **Live DB**).  
4. Optional write cutover on Vercel (after soak looks healthy):
   ```bash
   WRITE_CUTOVER_MATURE=1
   # or: SNAPSHOT_SKIP_DOMAINS=deal_flow,tickets,documents
   ```
5. Full off (keep MA/RE writing if needed):
   ```bash
   WRITE_SNAPSHOTS=0
   SNAPSHOT_WRITE_DOMAINS=ma,re
   ```
6. Monitor: `GET /api/admin/normalization-status`

## Still deferred (at Phase 15 ship)

- Dropping `os_store_snapshots` (Stage 4)
- MA/RE full write cutover — **available in Phase 16 via WRITE_CUTOVER_ALL**
- Financial field edits (ARR / burn / cash — rollup-sensitive)
- DocuSign · push

## Phase 16+ recommendations

1. Full write cutover for MA/RE once handoffs soak clean — **Phase 16**  
2. Empty-snapshot drills + archive snapshot rows — **Phase 16 soft-archive**  
3. Entity-scoped RLS for subsidiary portals  
4. Portfolio financial edits with rollup guards  
5. Observability (Sentry) · DocuSign · push — **Sentry scaffolding in Phase 16**
