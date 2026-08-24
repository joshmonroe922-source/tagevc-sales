-- Concurrent indexes for OS CRM full-text search (companion to
-- supabase/migrations/spine/0013_crm_full_text_search.sql).
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction.
-- In the Supabase SQL Editor: run EACH statement by itself (highlight + Run).
-- Skip any index that 0013 already created (IF NOT EXISTS is safe).

set statement_timeout = 0;

create index concurrently if not exists accounts_search
  on public.accounts using gin (search_vector);

create index concurrently if not exists contacts_search
  on public.contacts using gin (search_vector);

create index concurrently if not exists recruit_job_reqs_search
  on public.recruit_job_reqs using gin (search_vector);

create index concurrently if not exists accounts_created_at_idx
  on public.accounts (created_at desc);

create index concurrently if not exists accounts_enrich_status_idx
  on public.accounts (enrich_status);

create index concurrently if not exists contacts_created_at_idx
  on public.contacts (created_at desc);

create index concurrently if not exists contacts_enrich_status_idx
  on public.contacts (enrich_status);

create index concurrently if not exists account_org_links_owner_idx
  on public.account_org_links (owner_user_id)
  where owner_user_id is not null;

create index concurrently if not exists contact_org_links_owner_idx
  on public.contact_org_links (owner_user_id)
  where owner_user_id is not null;

create index concurrently if not exists recruit_job_reqs_created_at_idx
  on public.recruit_job_reqs (created_at desc);

create index concurrently if not exists recruit_job_reqs_account_created_idx
  on public.recruit_job_reqs (account_id, created_at desc);
