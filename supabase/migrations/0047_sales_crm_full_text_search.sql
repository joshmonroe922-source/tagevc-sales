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
