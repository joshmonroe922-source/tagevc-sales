# CRM full-text search

**Status: not applied to production — awaiting review.**

Two search surfaces live in this repo:

1. **Sales CRM** (Vite app) — Contacts / Accounts / ticket queues
2. **OS graph CRM** (`tagevc-os`) — ⌘K / `/api/spine/search` for accounts, contacts, jobs

Both now use Postgres FTS via `search_vector` +
`.textSearch(..., { type: 'websearch', config: 'english' })`
instead of `ILIKE` / `.or()` chains.

Backup checkpoint (pre-change HEAD): `80d7df79998fcabf26712b3f26ad1efaabe25d15`

## Sales CRM tables (`0047`)

| Table | Weights (A→D) |
|-------|----------------|
| `sales_contacts` | name, email (A); company, title (B); phone (C); notes (D) |
| `sales_accounts` | name (A); website (B); account_type (C); notes (D) |
| `sales_leads` | name, email (A); company (B); phone (C); notes (D) |
| `portal_tickets` | title (A); description (D) |

Files:

- Transactional: `supabase/migrations/0047_sales_crm_full_text_search.sql`
- Concurrent GIN: `supabase/scripts/0047_sales_crm_search_indexes_concurrent.sql`
- App: `src/lib/contactsApi.ts`, `src/lib/accountsApi.ts`, `src/lib/ticketsApi.ts`, `src/lib/textSearch.ts`

## OS graph tables (`0013` / phase109)

| Table | Weights (A→D) | Notes |
|-------|---------------|-------|
| `accounts` | name, domain (A); legal_name, website (B); industry, HQ (C); description (D) | Column + GIN already from phase94; this phase widens weights + backfill |
| `contacts` | name, email (A); title, dept, seniority (B); phone, location (C); skills, linkedin (D) | Phones/emails from jsonb `{value}` |
| `recruit_job_reqs` (`jobs` view) | title, req_number (A); location (B); status/skills (C); description, notes (D) | **New** `search_vector` |

Files:

- Transactional: `tagevc-os/supabase/migrations/spine/0013_crm_full_text_search.sql`
- SQL editor twin: `tagevc-os/supabase/phase109_crm_full_text_search.sql`
- Concurrent: `tagevc-os/supabase/phase109_crm_full_text_search_indexes_concurrent.sql`
- App: `tagevc-os/src/lib/spine/db/crud.ts` → `searchGraph`

## Safe apply (after approval)

Do **not** `supabase db push` until Josh says apply.

1. Confirm backup SHA `80d7df7` (or current `main`) is reachable.
2. **Sales CRM:** paste `0047_sales_crm_full_text_search.sql` in SQL editor for `hqmobgtnedmhzipusert`.
3. **OS graph:** paste `phase109_crm_full_text_search.sql` (same as spine `0013`).
4. Optional zero-downtime GIN: in a **separate** autocommit session, run each
   `CREATE INDEX CONCURRENTLY` statement alone from the concurrent scripts.
   - Cannot run inside a transaction.
   - Skip if the transactional file already created the same `IF NOT EXISTS` index.
5. Deploy the app commit that switches clients to `.textSearch`.
6. Smoke-test: Contacts search, Accounts search, ticket search, OS ⌘K (name / email / job title).
