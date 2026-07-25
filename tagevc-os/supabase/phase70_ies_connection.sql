-- Phase 70: Intuit Enterprise Suite (IES) connection + read surfaces.
-- Additive. IES remains system of record. No autonomous write-backs.
-- Safe to re-run. Does not touch os_store_snapshots.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- OAuth CSRF state (hashed, single-use, 10 min)
-- ---------------------------------------------------------------------------
create table if not exists public.os_ies_oauth_states (
  state_id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  actor_id uuid,
  purpose text not null default 'connect'
    check (purpose in ('connect', 'reconnect')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists os_ies_oauth_states_expires_idx
  on public.os_ies_oauth_states (expires_at);

alter table public.os_ies_oauth_states enable row level security;

-- ---------------------------------------------------------------------------
-- Encrypted OAuth tokens keyed by Intuit realm (company) id
-- ---------------------------------------------------------------------------
create table if not exists public.os_ies_oauth_tokens (
  realm_id text primary key
    check (realm_id ~ '^[0-9A-Za-z-]{1,64}$'),
  company_name text,
  access_token_cipher text not null,
  refresh_token_cipher text,
  token_expires_at timestamptz,
  scopes text[],
  environment text not null default 'sandbox'
    check (environment in ('sandbox', 'production')),
  connected_by uuid,
  connected_at timestamptz not null default now(),
  refreshed_at timestamptz,
  status text not null default 'connected'
    check (status in ('connected', 'expired', 'revoked', 'error')),
  last_error text,
  detail jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint os_ies_oauth_tokens_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
    )
);

alter table public.os_ies_oauth_tokens enable row level security;

drop policy if exists os_ies_oauth_tokens_select on public.os_ies_oauth_tokens;
create policy os_ies_oauth_tokens_select
  on public.os_ies_oauth_tokens
  for select
  to authenticated
  using (public.is_firm_wide_access());

-- ---------------------------------------------------------------------------
-- Entity ↔ IES company (realm) map
-- ---------------------------------------------------------------------------
create table if not exists public.os_ies_entity_map (
  entity_id text primary key
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  realm_id text
    check (realm_id is null or realm_id ~ '^[0-9A-Za-z-]{1,64}$'),
  ies_company_name text,
  is_active boolean not null default true,
  notes text,
  mapped_at timestamptz,
  mapped_by uuid,
  updated_at timestamptz not null default now()
);

create unique index if not exists os_ies_entity_map_realm_uidx
  on public.os_ies_entity_map (realm_id)
  where realm_id is not null;

alter table public.os_ies_entity_map enable row level security;

drop policy if exists os_ies_entity_map_select on public.os_ies_entity_map;
create policy os_ies_entity_map_select
  on public.os_ies_entity_map
  for select
  to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

insert into public.os_ies_entity_map (entity_id, notes)
values
  ('ENT-FIRM', 'Tage Venture Capital — parent books in IES'),
  ('ENT-R619', 'Recruit 619 subsidiary books'),
  ('ENT-INDA', 'Instant NDA subsidiary books')
on conflict (entity_id) do nothing;

-- ---------------------------------------------------------------------------
-- Chart of accounts summary snapshots (read-only from IES)
-- ---------------------------------------------------------------------------
create table if not exists public.os_ies_coa_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  realm_id text not null,
  as_of date not null default ((now() at time zone 'utc')::date),
  account_count integer not null default 0,
  active_count integer not null default 0,
  by_type jsonb not null default '{}'::jsonb,
  sample_accounts jsonb not null default '[]'::jsonb,
  source_system text not null default 'ies',
  money_auto_approve boolean not null default false
    check (money_auto_approve = false),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_ies_coa_by_type_check
    check (jsonb_typeof(by_type)='object' and pg_column_size(by_type)<=4096),
  constraint os_ies_coa_sample_check
    check (jsonb_typeof(sample_accounts)='array' and pg_column_size(sample_accounts)<=8192),
  constraint os_ies_coa_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

create index if not exists os_ies_coa_entity_as_of_idx
  on public.os_ies_coa_snapshots (entity_id, as_of desc, created_at desc);

alter table public.os_ies_coa_snapshots enable row level security;

drop policy if exists os_ies_coa_snapshots_select on public.os_ies_coa_snapshots;
create policy os_ies_coa_snapshots_select
  on public.os_ies_coa_snapshots
  for select
  to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );

-- ---------------------------------------------------------------------------
-- Invoice / payment status signals (read-only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_ies_invoice_signals (
  signal_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  realm_id text not null,
  as_of date not null default ((now() at time zone 'utc')::date),
  open_invoice_count integer not null default 0,
  open_balance_total numeric(18,2),
  overdue_count integer not null default 0,
  overdue_balance_total numeric(18,2),
  paid_mtd_count integer not null default 0,
  paid_mtd_total numeric(18,2),
  money_auto_approve boolean not null default false
    check (money_auto_approve = false),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_ies_inv_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

create index if not exists os_ies_invoice_signals_entity_as_of_idx
  on public.os_ies_invoice_signals (entity_id, as_of desc, created_at desc);

alter table public.os_ies_invoice_signals enable row level security;

drop policy if exists os_ies_invoice_signals_select on public.os_ies_invoice_signals;
create policy os_ies_invoice_signals_select
  on public.os_ies_invoice_signals
  for select
  to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );

-- ---------------------------------------------------------------------------
-- Sync run log
-- ---------------------------------------------------------------------------
create table if not exists public.os_ies_sync_runs (
  run_id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'ok', 'partial', 'failed', 'skipped')),
  entities_attempted integer not null default 0,
  entities_ok integer not null default 0,
  entities_failed integer not null default 0,
  trigger_source text not null default 'manual'
    check (trigger_source ~ '^[A-Za-z0-9._-]{2,32}$'),
  detail jsonb not null default '{}'::jsonb,
  constraint os_ies_sync_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=8192)
);

create index if not exists os_ies_sync_runs_started_idx
  on public.os_ies_sync_runs (started_at desc);

alter table public.os_ies_sync_runs enable row level security;

drop policy if exists os_ies_sync_runs_select on public.os_ies_sync_runs;
create policy os_ies_sync_runs_select
  on public.os_ies_sync_runs
  for select
  to authenticated
  using (public.is_firm_wide_access());

-- No grants to anon. Service role / authenticated select via RLS.
revoke all on public.os_ies_oauth_states from public, anon;
revoke all on public.os_ies_oauth_tokens from public, anon;
revoke all on public.os_ies_entity_map from public, anon;
revoke all on public.os_ies_coa_snapshots from public, anon;
revoke all on public.os_ies_invoice_signals from public, anon;
revoke all on public.os_ies_sync_runs from public, anon;

grant select on public.os_ies_entity_map to authenticated;
grant select on public.os_ies_coa_snapshots to authenticated;
grant select on public.os_ies_invoice_signals to authenticated;
grant select on public.os_ies_sync_runs to authenticated;
grant select on public.os_ies_oauth_tokens to authenticated;
