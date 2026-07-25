-- Phase 69: Website → Tage OS deal-flow intake receipts (idempotency).
-- Additive. Safe to re-run. Does NOT touch os_store_snapshots.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.os_website_intake_receipts (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique
    check (char_length(idempotency_key) between 8 and 128),
  lead_id text not null,
  company_name text not null default '',
  email text not null default '',
  deal_path text not null default 'launch'
    check (deal_path in ('launch', 'partner', 'exit')),
  source text not null default 'website_form',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists os_website_intake_receipts_created_idx
  on public.os_website_intake_receipts (created_at desc);

alter table public.os_website_intake_receipts enable row level security;

drop policy if exists os_website_intake_receipts_select on public.os_website_intake_receipts;
create policy os_website_intake_receipts_select
  on public.os_website_intake_receipts for select to authenticated
  using (public.is_firm_wide_access());

drop policy if exists os_website_intake_receipts_insert on public.os_website_intake_receipts;
create policy os_website_intake_receipts_insert
  on public.os_website_intake_receipts for insert to authenticated
  with check (public.is_firm_wide_access());

-- Service role / persist client often bypasses RLS; grants for authenticated ops.
revoke all on public.os_website_intake_receipts from public, anon;
grant select, insert on public.os_website_intake_receipts to authenticated;
grant select, insert, update on public.os_website_intake_receipts to service_role;
