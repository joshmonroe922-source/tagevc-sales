# CRM full-text search (Sales CRM 0047 + OS phase109)

**Status: not applied to production — awaiting review.**

Two surfaces share the same Supabase project:

| Surface | App | Tables | Code |
|---------|-----|--------|------|
| **Sales CRM** (Vite) | `src/lib/*Api.ts` | `sales_contacts`, `sales_accounts`, `sales_leads`, `portal_tickets` | `.textSearch('search_vector', …, { type: 'websearch', config: 'english' })` |
| **OS graph CRM** (Next) | `tagevc-os` Cmd-K / `/api/spine/search` | `accounts`, `contacts`, `recruit_job_reqs` | same pattern via `searchGraph` |

## Migration files

### Sales CRM (generated `search_vector` + GIN)

1. Transactional: [`supabase/migrations/0047_sales_crm_full_text_search.sql`](../../supabase/migrations/0047_sales_crm_full_text_search.sql)
2. Concurrent GIN (SQL editor, no txn): [`supabase/scripts/0047_sales_crm_search_indexes_concurrent.sql`](../../supabase/scripts/0047_sales_crm_search_indexes_concurrent.sql)

Weights: name/email **A**, company/title **B**, phone **C**, notes/description **D**.

### OS graph CRM (trigger-maintained `search_vector`)

Accounts/contacts already had `search_vector` from phase94; this hardens weights, backfills, and adds jobs FTS.

1. Transactional: [`supabase/migrations/spine/0013_crm_full_text_search.sql`](../supabase/migrations/spine/0013_crm_full_text_search.sql)  
   Hand-apply twin: [`supabase/phase109_crm_full_text_search.sql`](../supabase/phase109_crm_full_text_search.sql)
2. Concurrent indexes: [`supabase/phase109_crm_full_text_search_indexes_concurrent.sql`](../supabase/phase109_crm_full_text_search_indexes_concurrent.sql)

## Safe apply (after approval)

1. Backup SHA / tag: `checkpoint/before-fts-optimization` → `80d7df79998fcabf26712b3f26ad1efaabe25d15`
2. Apply **0047** in SQL editor (or migrate runner).
3. Optionally run **0047 concurrent** script statement-by-statement if you skipped GIN in step 2.
4. Apply **phase109 / 0013** for OS graph tables.
5. Optionally run **phase109 concurrent** script (skip indexes that already exist).
6. Deploy app code that uses `.textSearch`.
7. Smoke-test Sales CRM contact/account search + OS ⌘K (account, email, job title).

### Why CONCURRENTLY is separate

`CREATE INDEX CONCURRENTLY` cannot run inside a transaction. Supabase migrate / many SQL-editor “run as transaction” modes wrap files in `BEGIN`/`COMMIT`. Put concurrent builds in the standalone scripts and run them with autocommit.
