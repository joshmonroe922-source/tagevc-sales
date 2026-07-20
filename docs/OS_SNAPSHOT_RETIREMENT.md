# Snapshot Retirement Plan — `os_store_snapshots`

**Status:** Phase 14 — Soak active; Portfolio/Entity Master on dual-read. Snapshots remain dual-write fallback for deal-flow domains.

## Current dual-write / dual-read map

| Domain store key | Normalized tables | Phase | Read prefer SQL |
|------------------|-------------------|-------|-----------------|
| `deal_flow` (leads/tasks) | `os_leads`, `os_lead_tasks` | 9 | Yes (non-empty / `USE_NORMALIZED_TABLES`) |
| `deal_flow` (deals/tasks) | `os_deals`, `os_deal_tasks` | 11 | Yes |
| `deal_flow` (IC) | `os_ic_reviews` | 12 | Yes |
| `documents` | `os_documents` | 11 | Yes |
| `ma` | `os_ma_targets`, `os_ma_tasks` | 12 | Yes |
| `re` | `os_re_deals`, `os_re_tasks` | 13 | Yes |
| `tickets` | `os_tickets` | 9 | Yes |
| Portfolio / Entity Master | `entities`, `portfolio_companies`, `entity_month_pnl`, `entity_month_kpi*` | 14 | Yes (seed migrate once) |
| Messaging | First-class only (no snapshots) | 10–13 | N/A |

Still snapshot-only nested payloads: handoffs, IC audits, MA/RE handoffs, Doc audits, ticket agent audits.

## Retirement stages

1. **Soak (Phase 14 — current)**  
   - Keep dual-write for deal-flow / tickets / docs / MA / RE.  
   - Prefer SQL on hydrate when rows exist (`shouldUseNormalizedRows` / non-empty fetch).  
   - Portfolio/Entity: seed → SQL one-shot migrate when tables empty.  
   - Monitor via `GET /api/admin/normalization-status` and `os_normalization_counts`.

2. **Read cutover**  
   - Set `USE_NORMALIZED_TABLES=1` in production once row counts match business expectations.  
   - Confirm IC / MA / RE / docs / leads / tickets / Portfolio / Entities UIs with empty-snapshot drills in staging.

3. **Write cutover**  
   - Stop `queueStorePersist` for domains with healthy SQL.  
   - Keep one release of snapshot writes as emergency rollback.

4. **Drop**  
   - Archive `os_store_snapshots` rows per domain key.  
   - Remove hydrate snapshot branches and unused seed-only paths.  
   - Do **not** drop the table until all domain keys are migrated.

## Ops checklist

### Soak monitoring
```bash
curl -H "x-tagevc-digest-secret: $DIGEST_SECRET" \
  https://app.tagevc.com/api/admin/normalization-status
```
Inspect `row_counts`, `sync_stats`, `snapshots[].updated_at`, `master_data_source`.

### Staging empty-snapshot drill
1. Export / backup `os_store_snapshots`.  
2. For one domain (e.g. tickets): `update os_store_snapshots set payload = '{}'::jsonb where collection = 'tickets';`  
3. Hard-refresh app — UI should still load from `os_tickets`.  
4. Restore payload if needed.

### Read cutover
1. Confirm soak exit criteria below.  
2. Set Vercel `USE_NORMALIZED_TABLES=1`.  
3. Redeploy and re-check normalization-status (`prefer_normalized_tables: true`).

## Exit criteria before Stage 3 (write cutover)

- [ ] Zero dual-write sync failures for 14 days on leads, tickets, deals, docs, IC, MA, RE (`sync_stats.*.fail`)  
- [ ] Staging verify: wipe snapshot payload for a domain → app still boots from SQL  
- [ ] Portfolio/Entity Master `master_data_source: "sql"` in production  
- [ ] Backup / export of `os_store_snapshots` retained  

## Blockers for fully retiring `os_store_snapshots`

1. **Nested audit / handoff payloads** still live only inside JSONB (no first-class tables yet).  
2. **Write cutover not started** — mutations still call `queueStorePersist`.  
3. **No automated soak alerts** — status endpoint is pull-based; wire to cron/Sentry later.  
4. **Subsidiary entity-scoped RLS** not yet required for firm-wide auth model — revisit before multi-tenant subsidiaries.

## Non-goals (Phase 14)

- Dropping `os_store_snapshots`  
- Stopping snapshot writes (Stage 3)  
- Push notifications / DocuSign / Sentry (separate tracks)
