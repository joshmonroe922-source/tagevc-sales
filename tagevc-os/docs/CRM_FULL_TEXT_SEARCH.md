# CRM full-text search (Sales CRM 0047 + OS phase109)

**Status: not applied to production — awaiting review.**

Two surfaces share the same Supabase project:

| Surface | App | Tables | Default search |
|---------|-----|--------|----------------|
| **Sales CRM** (Vite) | `src/lib/*Api.ts` | `sales_contacts`, `sales_accounts`, `sales_leads`, `portal_tickets` | Ranked RPCs (`search_*_ranked`) via `rankedSearchIds` — `ts_rank_cd`, best match first |
| **OS graph CRM** (Next) | Cmd-K / `/api/spine/search` | `accounts`, `contacts`, `recruit_job_reqs` | Ranked RPCs (`search_accounts_ranked`, …) in `searchGraph` |

Unranked `.textSearch('search_vector', …, { type: 'websearch', config: 'english' })` stays as a fallback if the RPC is not applied yet.

## Ranking

List search and ⌘K do **not** rely on PostgREST `.textSearch` order (undefined). They call small `SECURITY INVOKER` RPCs that:

1. `websearch_to_tsquery('english', q)`
2. `search_vector @@ query`
3. `ORDER BY ts_rank_cd(search_vector, query) DESC`

Sales RPCs return `{ id, rank }`; helpers hydrate full rows and re-apply rank order. OS RPCs return the Cmd-K display columns already ranked.

## Migration files

### Sales CRM (generated `search_vector` + GIN)

Generated columns stay on `sales_*` / `portal_tickets`. GIN names already use `*_search_vector_idx`.

1. Transactional: [`supabase/migrations/0047_sales_crm_full_text_search.sql`](../../supabase/migrations/0047_sales_crm_full_text_search.sql) — columns, GIN, ranked RPCs
2. Concurrent GIN (SQL editor, no txn): [`supabase/scripts/0047_sales_crm_search_indexes_concurrent.sql`](../../supabase/scripts/0047_sales_crm_search_indexes_concurrent.sql)

Weights: name/email **A**, company/title **B**, phone **C**, notes/description **D**.

### OS graph CRM (trigger-maintained `search_vector`)

Accounts/contacts already had `search_vector` from phase94; this hardens weights, adds jobs FTS, **renames** GIN to `*_search_vector_idx`, and adds ranked RPCs.

1. Transactional: [`supabase/migrations/spine/0013_crm_full_text_search.sql`](../supabase/migrations/spine/0013_crm_full_text_search.sql)  
   Hand-apply twin: [`supabase/phase109_crm_full_text_search.sql`](../supabase/phase109_crm_full_text_search.sql)
2. **Chunked backfill** (re-run each statement until `UPDATE 0`): [`supabase/phase109_crm_full_text_search_backfill.sql`](../supabase/phase109_crm_full_text_search_backfill.sql)
3. Concurrent indexes: [`supabase/phase109_crm_full_text_search_indexes_concurrent.sql`](../supabase/phase109_crm_full_text_search_indexes_concurrent.sql)

Do **not** full-table `UPDATE` accounts/contacts/jobs — that takes a long write lock. Backfill updates 500 stale/NULL rows per statement and is safe to re-run.

GIN rename is instant (`ALTER INDEX … RENAME`): `accounts_search` → `accounts_search_vector_idx`, same for contacts and `recruit_job_reqs`. Old names are dropped if they conflict.

## Safe apply (after approval)

1. Backup SHA / tag: `checkpoint/before-fts-optimization` → `80d7df79998fcabf26712b3f26ad1efaabe25d15` (do not move or delete).
2. Apply **0047** in SQL editor (or migrate runner).
3. Optionally run **0047 concurrent** script statement-by-statement if you skipped GIN in step 2.
4. Apply **phase109 / 0013** for OS graph tables + ranked RPCs (no full-table backfill in this file).
5. Re-run **phase109 backfill** batches until each reports 0 rows.
6. Optionally run **phase109 concurrent** script (skip indexes that already exist).
7. Deploy app code that uses ranked RPCs (`.textSearch` fallback if RPC missing).
8. Smoke-test Sales CRM contact/account/lead search + OS ⌘K (account, email, job title) — best match should be first.

### Why CONCURRENTLY is separate

`CREATE INDEX CONCURRENTLY` cannot run inside a transaction. Supabase migrate / many SQL-editor “run as transaction” modes wrap files in `BEGIN`/`COMMIT`. Put concurrent builds in the standalone scripts and run them with autocommit.
