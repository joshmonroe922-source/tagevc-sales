-- Concurrent GIN indexes for 0047 Sales CRM full-text search.
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction.
-- In the Supabase SQL Editor: run EACH statement by itself (highlight + Run),
-- or disable "run as transaction" if your editor offers that.
-- Skip this file if you already applied the GIN indexes inside 0047.

set statement_timeout = 0;

create index concurrently if not exists sales_contacts_search_vector_idx
  on public.sales_contacts using gin (search_vector);

create index concurrently if not exists sales_accounts_search_vector_idx
  on public.sales_accounts using gin (search_vector);

create index concurrently if not exists sales_leads_search_vector_idx
  on public.sales_leads using gin (search_vector);

create index concurrently if not exists portal_tickets_search_vector_idx
  on public.portal_tickets using gin (search_vector);
