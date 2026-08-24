-- 0013_crm_full_text_search — production-safe FTS hardening (transaction OK)
-- Requires spine 0011 (job desk columns + jobs view).
--
-- Context: accounts/contacts already have search_vector + GIN from 0002/0003 /
-- phase94. This migration:
--   1) Widens weighted fields (email/phone/skills/HQ/website/jobs)
--   2) Adds search_vector to recruit_job_reqs (jobs view)
--   3) Standardizes GIN names to *_search_vector_idx (rename, no rebuild)
--   4) Adds filter B-tree indexes via CREATE INDEX IF NOT EXISTS (txn-safe)
--   5) Adds ranked search RPCs (ts_rank_cd) for Cmd-K / list search
--
-- Do NOT full-table UPDATE here. After this file, re-run batches in
--   supabase/phase109_crm_full_text_search_backfill.sql
-- until each statement reports 0 rows.
--
-- GIN / large indexes that should use CONCURRENTLY on a live DB:
--   → apply supabase/phase109_crm_full_text_search_indexes_concurrent.sql
--     in the Supabase SQL editor (NOT via a transactional migrate runner).
--
-- DO NOT apply to production until reviewed. Awaiting Josh sign-off.
-- Prerequisites: phase94 / spine 0002–0007; ideally 0011 (skills, req_number, …).
-- Backup / revert: tag checkpoint/before-fts-optimization (do not move).

-- Defensive columns if 0011 not yet applied
alter table public.contacts
  add column if not exists skills text[] not null default '{}';

alter table public.recruit_job_reqs
  add column if not exists req_number text,
  add column if not exists description text,
  add column if not exists location text,
  add column if not exists employment_type text,
  add column if not exists req_skills text[] not null default '{}';

-- ─── helpers: jsonb phone/email value extraction ─────────────────────────────
create or replace function public.spine_jsonb_text_values(j jsonb)
returns text
language sql
immutable
as $$
  select coalesce(
    (
      select string_agg(distinct coalesce(elem->>'value', elem->>'number', elem->>'email', elem#>>'{}'), ' ')
      from jsonb_array_elements(coalesce(j, '[]'::jsonb)) as elem
      where jsonb_typeof(elem) = 'object'
         or jsonb_typeof(elem) = 'string'
    ),
    ''
  );
$$;

-- ─── shared vector builders (triggers + chunked backfill) ────────────────────
create or replace function public.accounts_compute_search_vector(
  p_name text,
  p_canonical_domain text,
  p_legal_name text,
  p_website text,
  p_industry text,
  p_hq_city text,
  p_hq_state text,
  p_hq_country text,
  p_description text
)
returns tsvector
language sql
immutable
as $$
  select
    setweight(to_tsvector('english'::regconfig, coalesce(p_name, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(p_canonical_domain, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(p_legal_name, '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce(p_website, '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce(p_industry, '')), 'C') ||
    setweight(
      to_tsvector(
        'english'::regconfig,
        trim(both ' ' from concat_ws(' ', p_hq_city, p_hq_state, p_hq_country))
      ),
      'C'
    ) ||
    setweight(to_tsvector('english'::regconfig, coalesce(p_description, '')), 'D');
$$;

create or replace function public.contacts_compute_search_vector(
  p_full_name text,
  p_first_name text,
  p_last_name text,
  p_primary_email text,
  p_emails jsonb,
  p_phones jsonb,
  p_title text,
  p_department text,
  p_seniority text,
  p_location text,
  p_skills text[],
  p_linkedin_url text
)
returns tsvector
language sql
immutable
as $$
  select
    setweight(to_tsvector('english'::regconfig, coalesce(p_full_name, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(p_first_name, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(p_last_name, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(p_primary_email, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, public.spine_jsonb_text_values(p_emails)), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(p_title, '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce(p_department, '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce(p_seniority, '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, public.spine_jsonb_text_values(p_phones)), 'C') ||
    setweight(to_tsvector('english'::regconfig, coalesce(p_location, '')), 'C') ||
    setweight(to_tsvector('english'::regconfig, coalesce(array_to_string(p_skills, ' '), '')), 'D') ||
    setweight(to_tsvector('english'::regconfig, coalesce(p_linkedin_url, '')), 'D');
$$;

create or replace function public.recruit_job_reqs_compute_search_vector(
  p_title text,
  p_req_number text,
  p_location text,
  p_employment_type text,
  p_status text,
  p_req_skills text[],
  p_description text,
  p_notes text
)
returns tsvector
language sql
immutable
as $$
  select
    setweight(to_tsvector('english'::regconfig, coalesce(p_title, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(p_req_number, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(p_location, '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce(p_employment_type, '')), 'C') ||
    setweight(to_tsvector('english'::regconfig, coalesce(p_status, '')), 'C') ||
    setweight(to_tsvector('english'::regconfig, coalesce(array_to_string(p_req_skills, ' '), '')), 'C') ||
    setweight(to_tsvector('english'::regconfig, coalesce(p_description, '')), 'D') ||
    setweight(to_tsvector('english'::regconfig, coalesce(p_notes, '')), 'D');
$$;

-- ─── accounts: richer weights ────────────────────────────────────────────────
create or replace function public.accounts_rebuild_search_vector()
returns trigger
language plpgsql
as $$
begin
  new.search_vector := public.accounts_compute_search_vector(
    new.name, new.canonical_domain, new.legal_name, new.website,
    new.industry, new.hq_city, new.hq_state, new.hq_country, new.description
  );
  return new;
end;
$$;

drop trigger if exists accounts_search_vector_trg on public.accounts;
create trigger accounts_search_vector_trg
  before insert or update of
    name, canonical_domain, legal_name, website, industry,
    hq_city, hq_state, hq_country, description
  on public.accounts
  for each row execute function public.accounts_rebuild_search_vector();

-- ─── contacts: name/email A, title/company-ish B, phone C, notes/skills D ─────
create or replace function public.contacts_rebuild_search_vector()
returns trigger
language plpgsql
as $$
begin
  new.search_vector := public.contacts_compute_search_vector(
    new.full_name, new.first_name, new.last_name, new.primary_email,
    new.emails, new.phones, new.title, new.department, new.seniority,
    new.location, new.skills, new.linkedin_url
  );
  return new;
end;
$$;

drop trigger if exists contacts_search_vector_trg on public.contacts;
create trigger contacts_search_vector_trg
  before insert or update of
    full_name, first_name, last_name, primary_email, emails, phones,
    title, department, seniority, location, skills, linkedin_url
  on public.contacts
  for each row execute function public.contacts_rebuild_search_vector();

-- ─── recruit_job_reqs (jobs): search_vector ──────────────────────────────────
alter table public.recruit_job_reqs
  add column if not exists search_vector tsvector;

create or replace function public.recruit_job_reqs_rebuild_search_vector()
returns trigger
language plpgsql
as $$
begin
  new.search_vector := public.recruit_job_reqs_compute_search_vector(
    new.title, new.req_number, new.location, new.employment_type,
    new.status, new.req_skills, new.description, new.notes
  );
  return new;
end;
$$;

drop trigger if exists recruit_job_reqs_search_vector_trg on public.recruit_job_reqs;
create trigger recruit_job_reqs_search_vector_trg
  before insert or update of
    title, req_number, location, employment_type, status,
    req_skills, description, notes
  on public.recruit_job_reqs
  for each row execute function public.recruit_job_reqs_rebuild_search_vector();

-- Recreate comfort VIEW so search_vector is visible via public.jobs
create or replace view public.jobs as
  select * from public.recruit_job_reqs;

-- ─── GIN names: *_search_vector_idx (rename is instant; no rebuild) ──────────
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
    elsif to_regclass('public.' || rec.old_name) is not null
       and to_regclass('public.' || rec.new_name) is not null then
      execute format('drop index public.%I', rec.old_name);
    end if;
  end loop;
end $$;

-- ─── txn-safe filter indexes (IF NOT EXISTS) ─────────────────────────────────
-- Prefer the concurrent script on large prod tables if these take locks.

create index if not exists accounts_created_at_idx
  on public.accounts (created_at desc);

create index if not exists accounts_enrich_status_idx
  on public.accounts (enrich_status);

create index if not exists contacts_created_at_idx
  on public.contacts (created_at desc);

create index if not exists contacts_enrich_status_idx
  on public.contacts (enrich_status);

create index if not exists account_org_links_owner_idx
  on public.account_org_links (owner_user_id)
  where owner_user_id is not null;

create index if not exists contact_org_links_owner_idx
  on public.contact_org_links (owner_user_id)
  where owner_user_id is not null;

create index if not exists recruit_job_reqs_created_at_idx
  on public.recruit_job_reqs (created_at desc);

create index if not exists recruit_job_reqs_account_created_idx
  on public.recruit_job_reqs (account_id, created_at desc);

-- GIN (txn-safe create; skip on a live DB and use the concurrent script)
create index if not exists accounts_search_vector_idx
  on public.accounts using gin (search_vector);

create index if not exists contacts_search_vector_idx
  on public.contacts using gin (search_vector);

create index if not exists recruit_job_reqs_search_vector_idx
  on public.recruit_job_reqs using gin (search_vector);

-- ─── Ranked search RPCs (default for Cmd-K; .textSearch remains available) ───
create or replace function public.search_accounts_ranked(
  p_query text,
  p_limit int default 20,
  p_ids uuid[] default null
)
returns table (id uuid, name text, canonical_domain text, rank real)
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
    a.name,
    a.canonical_domain,
    ts_rank_cd(a.search_vector, q.tsq) as rank
  from public.accounts a, q
  where length(trim(coalesce(p_query, ''))) >= 2
    and q.tsq <> ''::tsquery
    and a.search_vector @@ q.tsq
    and (p_ids is null or a.id = any(p_ids))
  order by 4 desc, a.name asc nulls last
  limit greatest(1, least(coalesce(p_limit, 20), 40));
$$;

create or replace function public.search_contacts_ranked(
  p_query text,
  p_limit int default 20,
  p_ids uuid[] default null
)
returns table (id uuid, full_name text, primary_email text, title text, rank real)
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
    c.full_name,
    c.primary_email,
    c.title,
    ts_rank_cd(c.search_vector, q.tsq) as rank
  from public.contacts c, q
  where length(trim(coalesce(p_query, ''))) >= 2
    and q.tsq <> ''::tsquery
    and c.search_vector @@ q.tsq
    and (p_ids is null or c.id = any(p_ids))
  order by 5 desc, c.full_name asc nulls last
  limit greatest(1, least(coalesce(p_limit, 20), 40));
$$;

create or replace function public.search_recruit_job_reqs_ranked(
  p_query text,
  p_limit int default 20,
  p_org_id uuid default null
)
returns table (
  id uuid,
  title text,
  req_number text,
  location text,
  account_id uuid,
  rank real
)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select websearch_to_tsquery('english', trim(coalesce(p_query, ''))) as tsq
  )
  select
    j.id,
    j.title,
    j.req_number,
    j.location,
    j.account_id,
    ts_rank_cd(j.search_vector, q.tsq) as rank
  from public.recruit_job_reqs j, q
  where length(trim(coalesce(p_query, ''))) >= 2
    and q.tsq <> ''::tsquery
    and j.search_vector @@ q.tsq
    and (p_org_id is null or j.org_id = p_org_id)
  order by 6 desc, j.title asc nulls last
  limit greatest(1, least(coalesce(p_limit, 20), 40));
$$;

grant execute on function public.search_accounts_ranked(text, int, uuid[])
  to authenticated, service_role;
grant execute on function public.search_contacts_ranked(text, int, uuid[])
  to authenticated, service_role;
grant execute on function public.search_recruit_job_reqs_ranked(text, int, uuid)
  to authenticated, service_role;
