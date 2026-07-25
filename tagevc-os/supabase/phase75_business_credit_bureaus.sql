-- Phase 75: Business credit multi-bureau (D&B + Experian Business + Equifax Business).
-- Additive on Phase 73 business credit. Safe to re-run.
-- Does NOT touch os_store_snapshots, personal credit (Phase 74), or SSC tables.
-- Permissions: same as Phase 73 business credit — can_view_business_credit()
-- (visionary, admin, service_lead, counsel_ops, coo) + entity access.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Per-bureau business credit snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.os_business_credit_snapshots (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  bureau text not null
    check (bureau in ('dnb', 'experian_business', 'equifax_business')),
  pulled_at timestamptz not null default now(),
  report_date date,
  source text not null default 'manual_upload'
    check (source in ('manual_upload', 'guided_export', 'manual_entry', 'api_future')),
  -- e.g. { "duns": "123456789", "experian_file_number": "...", "equifax_id": "..." }
  identifiers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(identifiers) = 'object'),
  -- e.g. { "paydex": 80, "intelliscore_plus": 65, "business_credit_risk": 420, ... }
  scores jsonb not null default '{}'::jsonb
    check (jsonb_typeof(scores) = 'object'),
  -- payment_performance, public_records, inquiries, tradelines_count, risk_flags, ...
  summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(summary) = 'object'),
  raw_storage_path text,
  parse_status text not null default 'pending'
    check (parse_status in ('pending', 'parsed', 'partial', 'failed')),
  parse_errors text not null default '',
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists os_bcs_snapshots_entity_bureau_idx
  on public.os_business_credit_snapshots (entity_id, bureau, pulled_at desc);
create index if not exists os_bcs_snapshots_report_date_idx
  on public.os_business_credit_snapshots (entity_id, bureau, report_date);

-- ---------------------------------------------------------------------------
-- Per-bureau connection metadata (no credentials — guided import only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_business_credit_connections (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  bureau text not null
    check (bureau in ('dnb', 'experian_business', 'equifax_business')),
  status text not null default 'disconnected'
    check (status in ('connected_guided', 'stale', 'disconnected')),
  last_successful_pull_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, bureau)
);

-- Seed a connection shell per existing business-credit company × bureau
insert into public.os_business_credit_connections (entity_id, bureau)
select p.entity_id, b.bureau
from public.os_business_credit_profiles p
cross join (values ('dnb'), ('experian_business'), ('equifax_business')) as b (bureau)
on conflict (entity_id, bureau) do nothing;

-- ---------------------------------------------------------------------------
-- RLS — identical posture to os_business_credit_profiles
-- ---------------------------------------------------------------------------
alter table public.os_business_credit_snapshots enable row level security;
alter table public.os_business_credit_connections enable row level security;

drop policy if exists os_bcs_snapshots_all on public.os_business_credit_snapshots;
create policy os_bcs_snapshots_all on public.os_business_credit_snapshots
  for all to authenticated
  using (
    public.can_view_business_credit()
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  )
  with check (
    public.can_view_business_credit()
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  );

drop policy if exists os_bcs_connections_all on public.os_business_credit_connections;
create policy os_bcs_connections_all on public.os_business_credit_connections
  for all to authenticated
  using (
    public.can_view_business_credit()
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  )
  with check (
    public.can_view_business_credit()
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  );

revoke all on public.os_business_credit_snapshots from public, anon;
revoke all on public.os_business_credit_connections from public, anon;
grant select, insert, update, delete on public.os_business_credit_snapshots to authenticated;
grant select, insert, update, delete on public.os_business_credit_connections to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: raw business reports live in credit-private under business/
-- (bucket created by Phase 74; personal paths remain Visionary-only)
-- ---------------------------------------------------------------------------
drop policy if exists "credit_private_business_select" on storage.objects;
create policy "credit_private_business_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'credit-private'
    and name like 'business/%'
    and public.can_view_business_credit()
  );

drop policy if exists "credit_private_business_insert" on storage.objects;
create policy "credit_private_business_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'credit-private'
    and name like 'business/%'
    and public.can_view_business_credit()
  );

comment on table public.os_business_credit_snapshots is
  'Phase 75: per-bureau business credit snapshots (D&B / Experian Business / Equifax Business). Guided import only — no scraping, no fake scores.';
comment on table public.os_business_credit_connections is
  'Phase 75: bureau connection metadata per company. No credentials stored.';
