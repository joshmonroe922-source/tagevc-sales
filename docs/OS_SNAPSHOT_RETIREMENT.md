# Snapshot Retirement Plan — `os_store_snapshots`

**Status:** Planning only (Phase 13). Snapshots remain the dual-write fallback.

## Current dual-write map

| Domain store key | Normalized tables | Phase |
|------------------|-------------------|-------|
| `deal_flow` (leads/tasks) | `os_leads`, `os_lead_tasks` | 9 |
| `deal_flow` (deals/tasks) | `os_deals`, `os_deal_tasks` | 11 |
| `deal_flow` (IC) | `os_ic_reviews` | 12 |
| `documents` | `os_documents` | 11 |
| `ma` | `os_ma_targets`, `os_ma_tasks` | 12 |
| `re` | `os_re_deals`, `os_re_tasks` | 13 |
| `tickets` / shared services | `os_tickets` | 9 |
| Messaging | First-class only (no snapshots) | 10–13 |

Still snapshot-only (candidates for later phases): handoffs, IC audits, MA/RE handoffs, Doc audits, portfolio seed, entity OS composites.

## Retirement stages

1. **Soak (now–Phase 14)**  
   - Keep dual-write.  
   - Prefer SQL on hydrate when rows exist (`preferNormalizedTables` / non-empty fetch).  
   - Monitor persist errors vs normalized sync errors.

2. **Read cutover**  
   - Set `USE_NORMALIZED_TABLES=1` in production once row counts match business expectations.  
   - Confirm IC / MA / RE / docs / leads / tickets UIs with empty-snapshot drills in staging.

3. **Write cutover**  
   - Stop `queueStorePersist` for domains with healthy SQL.  
   - Keep one release of snapshot writes as emergency rollback.

4. **Drop**  
   - Archive `os_store_snapshots` rows per domain key.  
   - Remove hydrate snapshot branches and unused seed-only paths.  
   - Do **not** drop the table until all domain keys are migrated.

## Exit criteria before Stage 3

- [ ] Zero dual-write sync failures for 14 days on leads, tickets, deals, docs, IC, MA, RE  
- [ ] Staging verify: wipe snapshot payload for a domain → app still boots from SQL  
- [ ] Backup / export of `os_store_snapshots` retained  

## Non-goals (Phase 13)

- Dropping `os_store_snapshots`  
- Migrating portfolio / entity master off seed+snapshot  
- Removing JSONB from document `ai_review` / ticket diagnose fields (those are column JSON, not store snapshots)
