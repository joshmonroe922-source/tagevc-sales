-- phase109_crm_full_text_search.sql
-- Hand-apply twin of migrations/spine/0013_crm_full_text_search.sql
-- Paste into Supabase SQL editor after review. Then run
-- phase109_crm_full_text_search_indexes_concurrent.sql outside a transaction.
--
-- NOT APPLIED TO PRODUCTION. Awaiting Josh sign-off.

-- 0013_crm_full_text_search — production-safe FTS hardening (transaction OK)
-- Requires spine 0011 (job desk columns + jobs view).
--
-- Context: accounts/contacts already have search_vector + GIN from 0002/0003 /
-- phase94. This migration:
--   1) Widens weighted fields (email/phone/skills/HQ/website/jobs)
--   2) Adds search_vector to recruit_job_reqs (jobs view)
--   3) Backfills NULL / stale vectors
--   4) Adds filter B-tree indexes via CREATE INDEX IF NOT EXISTS (txn-safe)
--
-- GIN / large indexes that should use CONCURRENTLY on a live DB:
--   → apply supabase/phase109_crm_full_text_search_indexes_concurrent.sql
--     in the Supabase SQL editor (NOT via a transactional migrate runner).

-- Prerequisites: phase94 / spine 0002–0007; ideally 0011 (skills, req_number, …).

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

-- ─── accounts: richer weights ────────────────────────────────────────────────
create or replace function public.accounts_rebuild_search_vector()
returns trigger
language plpgsql
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.canonical_domain, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.legal_name, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.website, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.industry, '')), 'C') ||
    setweight(
      to_tsvector(
        'english',
        trim(both ' ' from concat_ws(' ', new.hq_city, new.hq_state, new.hq_country))
      ),
      'C'
    ) ||
    setweight(to_tsvector('english', coalesce(new.description, '')), 'D');
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
declare
  phone_text text;
  email_extra text;
  skills_text text;
begin
  phone_text := public.spine_jsonb_text_values(new.phones);
  email_extra := public.spine_jsonb_text_values(new.emails);
  skills_text := coalesce(array_to_string(new.skills, ' '), '');

  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.full_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.first_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.last_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.primary_email, '')), 'A') ||
    setweight(to_tsvector('english', email_extra), 'A') ||
    setweight(to_tsvector('english', coalesce(new.title, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.department, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.seniority, '')), 'B') ||
    setweight(to_tsvector('english', phone_text), 'C') ||
    setweight(to_tsvector('english', coalesce(new.location, '')), 'C') ||
    setweight(to_tsvector('english', skills_text), 'D') ||
    setweight(to_tsvector('english', coalesce(new.linkedin_url, '')), 'D');
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
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.req_number, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.location, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.employment_type, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(new.status, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(array_to_string(new.req_skills, ' '), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(new.description, '')), 'D') ||
    setweight(to_tsvector('english', coalesce(new.notes, '')), 'D');
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

-- ─── backfill (batch-friendly; safe to re-run) ───────────────────────────────
update public.accounts
set search_vector =
  setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(canonical_domain, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(legal_name, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(website, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(industry, '')), 'C') ||
  setweight(
    to_tsvector(
      'english',
      trim(both ' ' from concat_ws(' ', hq_city, hq_state, hq_country))
    ),
    'C'
  ) ||
  setweight(to_tsvector('english', coalesce(description, '')), 'D')
;

update public.contacts
set search_vector =
  setweight(to_tsvector('english', coalesce(full_name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(first_name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(last_name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(primary_email, '')), 'A') ||
  setweight(to_tsvector('english', public.spine_jsonb_text_values(emails)), 'A') ||
  setweight(to_tsvector('english', coalesce(title, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(department, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(seniority, '')), 'B') ||
  setweight(to_tsvector('english', public.spine_jsonb_text_values(phones)), 'C') ||
  setweight(to_tsvector('english', coalesce(location, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(array_to_string(skills, ' '), '')), 'D') ||
  setweight(to_tsvector('english', coalesce(linkedin_url, '')), 'D')
;

update public.recruit_job_reqs
set search_vector =
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(req_number, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(location, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(employment_type, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(status, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(array_to_string(req_skills, ' '), '')), 'C') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'D') ||
  setweight(to_tsvector('english', coalesce(notes, '')), 'D')
;

-- ─── txn-safe filter indexes (IF NOT EXISTS) ─────────────────────────────────
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

create index if not exists recruit_job_reqs_search
  on public.recruit_job_reqs using gin (search_vector);
