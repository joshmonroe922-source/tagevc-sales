-- Phase 14: Portfolio Active + Entity Master alignment, write RLS, indexes
-- Self-contained: creates Phase 1/6 tables if they were never applied.
-- Dual-read: app prefers SQL when rows exist; seed migrates once when empty.

-- ---------------------------------------------------------------------------
-- Align entities columns with TypeScript Entity type (keep legacy cols in sync)
-- ---------------------------------------------------------------------------
alter table public.entities
  add column if not exists entity_type text,
  add column if not exists track_origin text,
  add column if not exists parent_entity_id text,
  add column if not exists industry_module text,
  add column if not exists qbe_class_or_company text,
  add column if not exists coo_owner text,
  add column if not exists close_date date;

-- Backfill from Phase 0 legacy column names
update public.entities set
  entity_type = coalesce(nullif(entity_type, ''), type),
  parent_entity_id = coalesce(nullif(parent_entity_id, ''), parent_id),
  industry_module = coalesce(nullif(industry_module, ''), module),
  qbe_class_or_company = coalesce(nullif(qbe_class_or_company, ''), qbe_key),
  coo_owner = coalesce(nullif(coo_owner, ''), ops_lead)
where true;

-- Keep legacy columns populated when canonical columns are written
create or replace function public.entities_sync_legacy_columns()
returns trigger
language plpgsql
as $$
begin
  if new.entity_type is not null then
    new.type := new.entity_type;
  elsif new.type is not null and (new.entity_type is null or new.entity_type = '') then
    new.entity_type := new.type;
  end if;

  if new.parent_entity_id is not null then
    new.parent_id := new.parent_entity_id;
  elsif new.parent_id is not null and (new.parent_entity_id is null or new.parent_entity_id = '') then
    new.parent_entity_id := new.parent_id;
  end if;

  if new.industry_module is not null then
    new.module := new.industry_module;
  elsif new.module is not null and (new.industry_module is null or new.industry_module = '') then
    new.industry_module := new.module;
  end if;

  if new.qbe_class_or_company is not null then
    new.qbe_key := new.qbe_class_or_company;
  elsif new.qbe_key is not null and (new.qbe_class_or_company is null or new.qbe_class_or_company = '') then
    new.qbe_class_or_company := new.qbe_key;
  end if;

  if new.coo_owner is not null then
    new.ops_lead := new.coo_owner;
  elsif new.ops_lead is not null and (new.coo_owner is null or new.coo_owner = '') then
    new.coo_owner := new.ops_lead;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists entities_sync_legacy_columns_trg on public.entities;
create trigger entities_sync_legacy_columns_trg
  before insert or update on public.entities
  for each row execute function public.entities_sync_legacy_columns();

create index if not exists entities_status_idx on public.entities (status);
create index if not exists entities_entity_type_idx on public.entities (entity_type);
create index if not exists entities_portfolio_id_idx on public.entities (portfolio_id);
create index if not exists entities_updated_at_idx on public.entities (updated_at desc);

-- Broader write policy for authenticated (matches os_* dual-write pattern)
drop policy if exists "entities_admin_write" on public.entities;
drop policy if exists "entities_authenticated_write" on public.entities;
create policy "entities_authenticated_write"
  on public.entities for all to authenticated
  using (true) with check (true);

grant select, insert, update, delete on public.entities to authenticated;

-- ---------------------------------------------------------------------------
-- Ensure Portfolio Active + P&L tables exist (Phase 1 may never have been applied)
-- ---------------------------------------------------------------------------
create table if not exists public.portfolio_companies (
  id uuid primary key default gen_random_uuid(),
  portfolio_id text not null unique,
  entity_id text not null references public.entities (entity_id),
  company_name text not null,
  deal_id text,
  path text,
  close_date date,
  coo_owner text,
  board_lead text,
  arr_k numeric not null default 0,
  mom_growth numeric,
  net_burn_k numeric not null default 0,
  runway_mo numeric,
  cash_k numeric not null default 0,
  health text not null check (health in ('On Track', 'Watch', 'At Risk', 'Critical')),
  top_risk text,
  next_milestone text,
  last_update date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.entity_month_pnl (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities (entity_id),
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  revenue_arr_k numeric not null default 0,
  cogs_k numeric not null default 0,
  opex_k numeric not null default 0,
  net_burn_k numeric not null default 0,
  ending_cash_k numeric not null default 0,
  is_firm boolean not null default false,
  unique (entity_id, period)
);

alter table public.portfolio_companies enable row level security;
alter table public.entity_month_pnl enable row level security;

drop policy if exists "portfolio_companies_authenticated_read" on public.portfolio_companies;
create policy "portfolio_companies_authenticated_read"
  on public.portfolio_companies for select to authenticated using (true);

drop policy if exists "entity_month_pnl_authenticated_read" on public.entity_month_pnl;
create policy "entity_month_pnl_authenticated_read"
  on public.entity_month_pnl for select to authenticated using (true);

create index if not exists portfolio_companies_entity_id_idx
  on public.portfolio_companies (entity_id);
create index if not exists portfolio_companies_health_idx
  on public.portfolio_companies (health);
create index if not exists portfolio_companies_updated_at_idx
  on public.portfolio_companies (updated_at desc);

drop policy if exists "portfolio_companies_authenticated_write" on public.portfolio_companies;
create policy "portfolio_companies_authenticated_write"
  on public.portfolio_companies for all to authenticated
  using (true) with check (true);

grant select, insert, update, delete on public.portfolio_companies to authenticated;

-- ---------------------------------------------------------------------------
-- Entity month P&L — timestamps + write RLS + indexes
-- ---------------------------------------------------------------------------
alter table public.entity_month_pnl
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists entity_month_pnl_entity_period_idx
  on public.entity_month_pnl (entity_id, period);
create index if not exists entity_month_pnl_period_idx
  on public.entity_month_pnl (period);

drop policy if exists "entity_month_pnl_authenticated_write" on public.entity_month_pnl;
create policy "entity_month_pnl_authenticated_write"
  on public.entity_month_pnl for all to authenticated
  using (true) with check (true);

grant select, insert, update, delete on public.entity_month_pnl to authenticated;

-- ---------------------------------------------------------------------------
-- Ensure CORE / FLEX KPI tables exist (Phase 6 may never have been applied)
-- ---------------------------------------------------------------------------
create table if not exists public.entity_month_kpi (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities (entity_id),
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  kpi_key text not null,
  label text not null,
  value_num numeric,
  value_text text,
  unit text,
  method text not null check (
    method in ('SUM', 'WEIGHTED', 'MIN_FLAG', 'COUNT', 'LIST', 'n/a')
  ),
  standard text not null default 'CORE' check (standard = 'CORE'),
  unique (entity_id, period, kpi_key)
);

create table if not exists public.entity_month_kpi_flex (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities (entity_id),
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  flex_key text not null,
  label text not null,
  value_num numeric,
  value_text text,
  unit text,
  industry_module text not null,
  standard text not null default 'FLEX' check (standard = 'FLEX'),
  unique (entity_id, period, flex_key)
);

create index if not exists entity_month_kpi_entity_period_idx
  on public.entity_month_kpi (entity_id, period);
create index if not exists entity_month_kpi_flex_entity_period_idx
  on public.entity_month_kpi_flex (entity_id, period);

alter table public.entity_month_kpi enable row level security;
alter table public.entity_month_kpi_flex enable row level security;

drop policy if exists "entity_month_kpi_authenticated_read" on public.entity_month_kpi;
create policy "entity_month_kpi_authenticated_read"
  on public.entity_month_kpi for select to authenticated using (true);

drop policy if exists "entity_month_kpi_flex_authenticated_read" on public.entity_month_kpi_flex;
create policy "entity_month_kpi_flex_authenticated_read"
  on public.entity_month_kpi_flex for select to authenticated using (true);

drop policy if exists "entity_month_kpi_authenticated_write" on public.entity_month_kpi;
create policy "entity_month_kpi_authenticated_write"
  on public.entity_month_kpi for all to authenticated
  using (true) with check (true);

drop policy if exists "entity_month_kpi_flex_authenticated_write" on public.entity_month_kpi_flex;
create policy "entity_month_kpi_flex_authenticated_write"
  on public.entity_month_kpi_flex for all to authenticated
  using (true) with check (true);

grant select, insert, update, delete on public.entity_month_kpi to authenticated;
grant select, insert, update, delete on public.entity_month_kpi_flex to authenticated;

-- ---------------------------------------------------------------------------
-- Soak helper view: row counts for dual-written domains (ops / cutover checks)
-- ---------------------------------------------------------------------------
create or replace view public.os_normalization_counts as
select 'entities'::text as domain, count(*)::bigint as row_count from public.entities
union all
select 'portfolio_companies', count(*) from public.portfolio_companies
union all
select 'entity_month_pnl', count(*) from public.entity_month_pnl
union all
select 'entity_month_kpi', count(*) from public.entity_month_kpi
union all
select 'entity_month_kpi_flex', count(*) from public.entity_month_kpi_flex
union all
select 'os_leads', count(*) from public.os_leads
union all
select 'os_lead_tasks', count(*) from public.os_lead_tasks
union all
select 'os_tickets', count(*) from public.os_tickets
union all
select 'os_deals', count(*) from public.os_deals
union all
select 'os_deal_tasks', count(*) from public.os_deal_tasks
union all
select 'os_documents', count(*) from public.os_documents
union all
select 'os_ic_reviews', count(*) from public.os_ic_reviews
union all
select 'os_ma_targets', count(*) from public.os_ma_targets
union all
select 'os_ma_tasks', count(*) from public.os_ma_tasks
union all
select 'os_re_deals', count(*) from public.os_re_deals
union all
select 'os_re_tasks', count(*) from public.os_re_tasks
union all
select 'os_store_snapshots', count(*) from public.os_store_snapshots;

grant select on public.os_normalization_counts to authenticated;
