# Snapshot Retirement Plan — `os_store_snapshots`

**Status:** Phase 15 — Write cutover available (env-gated). Handoffs/audits dual-written.

## Current dual-write / dual-read map

| Domain store key | Normalized tables | Phase | Snapshot writes |
|------------------|-------------------|-------|-----------------|
| `deal_flow` (leads/tasks/deals/IC) | `os_leads`, `os_deals`, `os_ic_reviews` | 9–12 | Optional — `WRITE_CUTOVER_MATURE` |
| `deal_flow` (IC audits, handoffs) | `os_ic_audits`, `os_handoffs` | 15 | Same collection gate |
| `documents` (+ audits) | `os_documents`, `os_doc_audits` | 11 / 15 | Optional mature cutover |
| `tickets` (+ audits) | `os_tickets`, `os_ticket_audits` | 9 / 15 | Optional mature cutover |
| `ma` (+ handoffs) | `os_ma_*`, `os_handoffs` | 12 / 15 | Still dual-write by default |
| `re` (+ handoffs) | `os_re_*`, `os_handoffs` | 13 / 15 | Still dual-write by default |
| Portfolio / Entity Master | `entities`, `portfolio_companies`, … | 14 | No snapshots (SQL-first) |
| Messaging | First-class only | 10–13 | N/A |

## Retirement stages

1. **Soak** — Prefer SQL on hydrate; dual-write both paths.  
2. **Read cutover** — `USE_NORMALIZED_TABLES=1`.  
3. **Write cutover (Phase 15)** — Gate in `persist.ts`:
   - `WRITE_CUTOVER_MATURE=1` → skip `deal_flow`, `tickets`, `documents`
   - `SNAPSHOT_SKIP_DOMAINS=…` → skip listed collections
   - `WRITE_SNAPSHOTS=0` → suppress all unless `SNAPSHOT_WRITE_DOMAINS` allowlist
   - Loads still work for rollback; SQL remains source of truth for mutations
4. **Drop** — Archive rows; remove hydrate snapshot branches; do not drop table until all keys migrated.

## Ops checklist

### Enable mature write cutover
1. Apply `phase15_write_cutover.sql`.  
2. Confirm `os_handoffs` / audit tables in `/api/admin/normalization-status`.  
3. Confirm `sync_failure_count` is 0 after traffic.  
4. Set `WRITE_CUTOVER_MATURE=1` on Vercel → redeploy.  
5. Verify `write_cutover.snapshot_write_gates.deal_flow.allow === false` and `skips` increment on mutations.

### Rollback
Unset `WRITE_CUTOVER_MATURE` / `WRITE_SNAPSHOTS` / `SNAPSHOT_SKIP_DOMAINS` and redeploy. Snapshot upserts resume immediately.

## Exit criteria before Stage 4 (drop)

- [ ] Mature domains on write cutover ≥14 days with zero SQL sync failures  
- [ ] Staging empty-snapshot drill for `deal_flow`, `tickets`, `documents`  
- [ ] MA/RE also cut over (or accepted residual dual-write)  
- [ ] Backup of `os_store_snapshots` retained  

## Blockers for fully retiring `os_store_snapshots`

1. MA/RE still dual-writing by default (intentional).  
2. No automated soak alerts (pull-based status API only).  
3. Subsidiary entity-scoped RLS not yet required.

## Non-goals

- Dropping the `os_store_snapshots` table in Phase 15  
- Push / DocuSign / Sentry
