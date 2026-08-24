-- Concurrent indexes for OS CRM full-text search (companion to
-- supabase/migrations/spine/0013_crm_full_text_search.sql).
--
-- CREATE/DROP INDEX CONCURRENTLY cannot run inside a transaction.
-- In the Supabase SQL Editor: run EACH statement by itself (highlight + Run).
-- Skip any index that 0013 already created (IF NOT EXISTS is safe).
--
-- GIN names are standardized to *_search_vector_idx. The first DO block
-- renames legacy accounts_search / contacts_search / recruit_job_reqs_search
-- (instant). Then CONCURRENTLY builds any missing new-name GIN / B-trees
-- and drops leftover old names.

set statement_timeout = 0;

-- Instant rename (no rebuild). Safe if the new name already exists.
do $$
declare
  rec record;
begin
  for rec in
    select * from (values
      ('accounts_search', 'accounts_search_vector_idx'),
      ('contacts_search', 'contacts_search_vector_idx'),
      ('recruit_job_reqs_search', 'recruit_job_reqs_search_vector_idx')
    ) as t(old_name, new_name)
  loop
    if to_regclass('public.' || rec.old_name) is not null
       and to_regclass('public.' || rec.new_name) is null then
      execute format('alter index public.%I rename to %I', rec.old_name, rec.new_name);
    end if;
  end loop;
end $$;

create index concurrently if not exists accounts_search_vector_idx
  on public.accounts using gin (search_vector);

create index concurrently if not exists contacts_search_vector_idx
  on public.contacts using gin (search_vector);

create index concurrently if not exists recruit_job_reqs_search_vector_idx
  on public.recruit_job_reqs using gin (search_vector);

-- Leftover old names if both old and new existed
drop index concurrently if exists accounts_search;
drop index concurrently if exists contacts_search;
drop index concurrently if exists recruit_job_reqs_search;

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
