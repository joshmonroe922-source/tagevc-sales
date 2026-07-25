-- Phase 73: Investor (I-quadrant) assets, Net Worth, Credit Management.
-- Additive. Safe to re-run. Does NOT touch os_store_snapshots.
-- Visibility: visionary_private (Visionary-only) vs firm_visible (role-appropriate).

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_visionary_role()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'visionary'
      and p.active = true
  );
$$;

create or replace function public.can_view_business_credit()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.role in (
        'visionary', 'admin', 'service_lead', 'counsel_ops', 'coo'
      )
  );
$$;

grant execute on function public.is_visionary_role() to authenticated;
grant execute on function public.can_view_business_credit() to authenticated;

-- ---------------------------------------------------------------------------
-- Asset registry
-- ---------------------------------------------------------------------------
create table if not exists public.os_investor_assets (
  id uuid primary key default gen_random_uuid(),
  asset_key text not null unique
    check (asset_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,80}$'),
  name text not null,
  institution text not null default '',
  asset_class text not null
    check (asset_class in (
      'brokerage',
      'retirement',
      'stock_fund',
      'crypto',
      'private_other',
      'business_equity',
      'real_estate',
      'firm_cash',
      'firm_other'
    )),
  visibility_scope text not null
    check (visibility_scope in ('visionary_private', 'firm_visible')),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  balance numeric(18,2) not null default 0,
  currency text not null default 'USD'
    check (currency ~ '^[A-Z]{3}$'),
  as_of timestamptz not null default now(),
  last_synced_at timestamptz,
  source text not null default 'manual'
    check (source in ('manual', 'csv', 'connector', 'derived')),
  external_id text,
  connector_kind text,
  notes text not null default '',
  detail jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_investor_assets_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=8192),
  constraint os_investor_assets_class_scope_check
    check (
      (asset_class in ('brokerage','retirement','stock_fund','crypto','private_other')
        and visibility_scope = 'visionary_private')
      or
      (asset_class in ('business_equity','real_estate','firm_cash','firm_other')
        and visibility_scope = 'firm_visible')
    )
);

create index if not exists os_investor_assets_scope_idx
  on public.os_investor_assets (visibility_scope, asset_class);
create index if not exists os_investor_assets_entity_idx
  on public.os_investor_assets (entity_id)
  where entity_id is not null;
create index if not exists os_investor_assets_as_of_idx
  on public.os_investor_assets (as_of desc);

alter table public.os_investor_assets enable row level security;

drop policy if exists os_investor_assets_select on public.os_investor_assets;
create policy os_investor_assets_select on public.os_investor_assets
  for select to authenticated
  using (
    (visibility_scope = 'visionary_private' and public.is_visionary_role())
    or (
      visibility_scope = 'firm_visible'
      and (
        public.is_firm_wide_access()
        or entity_id is null
        or public.can_access_entity(entity_id)
      )
    )
  );

drop policy if exists os_investor_assets_write on public.os_investor_assets;
create policy os_investor_assets_write on public.os_investor_assets
  for all to authenticated
  using (
    (visibility_scope = 'visionary_private' and public.is_visionary_role())
    or (
      visibility_scope = 'firm_visible'
      and public.can_view_business_credit()
      and (
        public.is_firm_wide_access()
        or entity_id is null
        or public.can_access_entity(entity_id)
      )
    )
  )
  with check (
    (visibility_scope = 'visionary_private' and public.is_visionary_role())
    or (
      visibility_scope = 'firm_visible'
      and public.can_view_business_credit()
      and (
        public.is_firm_wide_access()
        or entity_id is null
        or public.can_access_entity(entity_id)
      )
    )
  );

revoke all on public.os_investor_assets from public, anon;
grant select, insert, update, delete on public.os_investor_assets to authenticated;

-- ---------------------------------------------------------------------------
-- Personal credit (Visionary-only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_personal_credit_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null unique,
  experian_score integer check (experian_score is null or (experian_score between 300 and 850)),
  equifax_score integer check (equifax_score is null or (equifax_score between 300 and 850)),
  transunion_score integer check (transunion_score is null or (transunion_score between 300 and 850)),
  score_as_of date,
  source text not null default 'manual'
    check (source in ('manual', 'connector')),
  notes text not null default '',
  detail jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint os_personal_credit_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

create table if not exists public.os_personal_credit_items (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null
    references public.os_personal_credit_profiles (id) on delete cascade,
  kind text not null
    check (kind in ('open_item', 'negative', 'dispute', 'inquiry', 'other')),
  bureau text
    check (bureau is null or bureau in ('experian', 'equifax', 'transunion', 'other')),
  title text not null,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'resolved', 'waived')),
  amount numeric(14,2),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.os_personal_credit_actions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null
    references public.os_personal_credit_profiles (id) on delete cascade,
  title text not null,
  status text not null default 'todo'
    check (status in ('todo', 'doing', 'done', 'skipped')),
  sort_order integer not null default 0,
  due_at date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.os_personal_credit_profiles enable row level security;
alter table public.os_personal_credit_items enable row level security;
alter table public.os_personal_credit_actions enable row level security;

drop policy if exists os_personal_credit_profiles_all on public.os_personal_credit_profiles;
create policy os_personal_credit_profiles_all on public.os_personal_credit_profiles
  for all to authenticated
  using (public.is_visionary_role())
  with check (public.is_visionary_role());

drop policy if exists os_personal_credit_items_all on public.os_personal_credit_items;
create policy os_personal_credit_items_all on public.os_personal_credit_items
  for all to authenticated
  using (public.is_visionary_role())
  with check (public.is_visionary_role());

drop policy if exists os_personal_credit_actions_all on public.os_personal_credit_actions;
create policy os_personal_credit_actions_all on public.os_personal_credit_actions
  for all to authenticated
  using (public.is_visionary_role())
  with check (public.is_visionary_role());

revoke all on public.os_personal_credit_profiles from public, anon;
revoke all on public.os_personal_credit_items from public, anon;
revoke all on public.os_personal_credit_actions from public, anon;
grant select, insert, update, delete on public.os_personal_credit_profiles to authenticated;
grant select, insert, update, delete on public.os_personal_credit_items to authenticated;
grant select, insert, update, delete on public.os_personal_credit_actions to authenticated;

-- ---------------------------------------------------------------------------
-- Business credit (Visionary + finance/SSC)
-- ---------------------------------------------------------------------------
create table if not exists public.os_business_credit_profiles (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null unique
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  duns_number text,
  duns_status text not null default 'unknown'
    check (duns_status in (
      'unknown', 'not_started', 'pending', 'active', 'stale', 'issue'
    )),
  dn_b_score text,
  experian_biz_score text,
  equifax_biz_score text,
  report_as_of date,
  monitoring_cadence text not null default 'quarterly'
    check (monitoring_cadence in ('monthly', 'quarterly', 'annual')),
  next_review_at date,
  negative_notes text not null default '',
  source text not null default 'manual'
    check (source in ('manual', 'connector')),
  detail jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint os_business_credit_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

create table if not exists public.os_business_credit_checklist (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  title text not null,
  status text not null default 'todo'
    check (status in ('todo', 'doing', 'done', 'skipped')),
  due_at date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_biz_credit_checklist_entity_idx
  on public.os_business_credit_checklist (entity_id, status);

alter table public.os_business_credit_profiles enable row level security;
alter table public.os_business_credit_checklist enable row level security;

drop policy if exists os_business_credit_profiles_select on public.os_business_credit_profiles;
create policy os_business_credit_profiles_select on public.os_business_credit_profiles
  for select to authenticated
  using (
    public.can_view_business_credit()
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  );

drop policy if exists os_business_credit_profiles_write on public.os_business_credit_profiles;
create policy os_business_credit_profiles_write on public.os_business_credit_profiles
  for all to authenticated
  using (
    public.can_view_business_credit()
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  )
  with check (
    public.can_view_business_credit()
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  );

drop policy if exists os_business_credit_checklist_all on public.os_business_credit_checklist;
create policy os_business_credit_checklist_all on public.os_business_credit_checklist
  for all to authenticated
  using (
    public.can_view_business_credit()
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  )
  with check (
    public.can_view_business_credit()
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  );

revoke all on public.os_business_credit_profiles from public, anon;
revoke all on public.os_business_credit_checklist from public, anon;
grant select, insert, update, delete on public.os_business_credit_profiles to authenticated;
grant select, insert, update, delete on public.os_business_credit_checklist to authenticated;

-- Seed empty business credit shells for known companies (idempotent)
insert into public.os_business_credit_profiles (entity_id, duns_status, monitoring_cadence)
select e.entity_id, 'not_started', 'quarterly'
from (
  values
    ('ENT-FIRM'),
    ('ENT-R619'),
    ('ENT-INDA'),
    ('ENT-SIGNENT')
) as e(entity_id)
where not exists (
  select 1 from public.os_business_credit_profiles p where p.entity_id = e.entity_id
);

comment on table public.os_investor_assets is
  'Phase 73 investor asset registry. Private I-quadrant rows are Visionary-only.';
comment on table public.os_personal_credit_profiles is
  'Phase 73 personal credit — Visionary-only. Never expose via Live Look.';
comment on table public.os_business_credit_profiles is
  'Phase 73 business credit — Visionary + finance/SSC roles.';
