-- 0047_sales_crm_full_text_search
-- Weighted tsvector columns for Sales CRM list search (contacts / accounts / leads / tickets).
--
-- NOT APPLIED TO PRODUCTION. Review before running.
--
-- Supabase CLI / SQL Editor wraps a pasted file in a transaction, so this
-- migration uses CREATE INDEX (not CONCURRENTLY). That takes a short write lock.
-- For zero-downtime GIN builds on a live DB, skip the GIN statements below and
-- run supabase/scripts/0047_sales_crm_search_indexes_concurrent.sql in the
-- SQL editor as separate statements (CONCURRENTLY cannot run inside a txn).

-- ─── sales_contacts: name/email A, company/title B, phone C, notes D ─────────
alter table public.sales_contacts
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(full_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(primary_email, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(array_to_string(emails, ' '), '')), 'A') ||
    setweight(to_tsvector('english', coalesce(company, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(title, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(primary_phone, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(phones, ' '), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(notes, '')), 'D')
  ) stored;

-- ─── sales_accounts: name A, website B, type C, notes D ──────────────────────
alter table public.sales_accounts
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(website, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(account_type, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(notes, '')), 'D')
  ) stored;

-- ─── sales_leads (deals): name/email A, company B, phone C, notes D ──────────
alter table public.sales_leads
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(email, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(company, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(phone, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(notes, '')), 'D')
  ) stored;

-- ─── portal_tickets: title A, description D ──────────────────────────────────
alter table public.portal_tickets
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'D')
  ) stored;

-- ─── filter B-trees (txn-safe; IF NOT EXISTS) ────────────────────────────────
create index if not exists sales_contacts_created_by_idx
  on public.sales_contacts (created_by)
  where created_by is not null;

create index if not exists sales_contacts_account_created_idx
  on public.sales_contacts (account_id, created_at desc)
  where account_id is not null;

create index if not exists sales_accounts_created_by_idx
  on public.sales_accounts (created_by)
  where created_by is not null;

create index if not exists sales_leads_stage_created_idx
  on public.sales_leads (stage, created_at desc);

-- ─── GIN on search_vector (short lock; use concurrent script on large tables) ─
create index if not exists sales_contacts_search_vector_idx
  on public.sales_contacts using gin (search_vector);

create index if not exists sales_accounts_search_vector_idx
  on public.sales_accounts using gin (search_vector);

create index if not exists sales_leads_search_vector_idx
  on public.sales_leads using gin (search_vector);

create index if not exists portal_tickets_search_vector_idx
  on public.portal_tickets using gin (search_vector);

-- ─── Ranked search RPCs (default for list UIs; .textSearch remains available) ─
-- Returns id + ts_rank_cd, best match first. SECURITY INVOKER → RLS applies.

create or replace function public.search_sales_contacts_ranked(
  p_query text,
  p_limit int default 80,
  p_account_id uuid default null,
  p_include_archived boolean default false
)
returns table (id uuid, rank real)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select websearch_to_tsquery('english', trim(coalesce(p_query, ''))) as tsq
  )
  select
    c.id,
    ts_rank_cd(c.search_vector, q.tsq) as rank
  from public.sales_contacts c, q
  where length(trim(coalesce(p_query, ''))) >= 2
    and q.tsq <> ''::tsquery
    and c.search_vector @@ q.tsq
    and (p_include_archived or c.archived_at is null)
    and (p_account_id is null or c.account_id = p_account_id)
  order by 2 desc, c.full_name asc nulls last
  limit greatest(1, least(coalesce(p_limit, 80), 100));
$$;

create or replace function public.search_sales_accounts_ranked(
  p_query text,
  p_limit int default 80,
  p_include_archived boolean default false
)
returns table (id uuid, rank real)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select websearch_to_tsquery('english', trim(coalesce(p_query, ''))) as tsq
  )
  select
    a.id,
    ts_rank_cd(a.search_vector, q.tsq) as rank
  from public.sales_accounts a, q
  where length(trim(coalesce(p_query, ''))) >= 2
    and q.tsq <> ''::tsquery
    and a.search_vector @@ q.tsq
    and (p_include_archived or a.archived_at is null)
  order by 2 desc, a.name asc nulls last
  limit greatest(1, least(coalesce(p_limit, 80), 100));
$$;

create or replace function public.search_sales_leads_ranked(
  p_query text,
  p_limit int default 80
)
returns table (id uuid, rank real)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select websearch_to_tsquery('english', trim(coalesce(p_query, ''))) as tsq
  )
  select
    l.id,
    ts_rank_cd(l.search_vector, q.tsq) as rank
  from public.sales_leads l, q
  where length(trim(coalesce(p_query, ''))) >= 2
    and q.tsq <> ''::tsquery
    and l.search_vector @@ q.tsq
  order by 2 desc, l.created_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 80), 100));
$$;

create or replace function public.search_portal_tickets_ranked(
  p_query text,
  p_limit int default 200
)
returns table (id uuid, rank real)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select websearch_to_tsquery('english', trim(coalesce(p_query, ''))) as tsq
  )
  select
    t.id,
    ts_rank_cd(t.search_vector, q.tsq) as rank
  from public.portal_tickets t, q
  where length(trim(coalesce(p_query, ''))) >= 2
    and q.tsq <> ''::tsquery
    and t.search_vector @@ q.tsq
  order by 2 desc, t.updated_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 200), 300));
$$;

grant execute on function public.search_sales_contacts_ranked(text, int, uuid, boolean)
  to authenticated, service_role;
grant execute on function public.search_sales_accounts_ranked(text, int, boolean)
  to authenticated, service_role;
grant execute on function public.search_sales_leads_ranked(text, int)
  to authenticated, service_role;
grant execute on function public.search_portal_tickets_ranked(text, int)
  to authenticated, service_role;
