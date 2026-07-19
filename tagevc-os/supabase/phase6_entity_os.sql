-- Phase 6: Entity OS + CORE/FLEX KPIs + lead↔ entity links
-- Future Supabase cutover stub (in-memory stores remain source of truth in app).

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

-- Optional follow-on / inbound link from Pipeline Active to Entity Master
alter table public.leads
  add column if not exists related_entity_id text references public.entities (entity_id);

create index if not exists entity_month_kpi_entity_period_idx
  on public.entity_month_kpi (entity_id, period);

create index if not exists entity_month_kpi_flex_entity_period_idx
  on public.entity_month_kpi_flex (entity_id, period);

create index if not exists leads_related_entity_idx
  on public.leads (related_entity_id);

alter table public.entity_month_kpi enable row level security;
alter table public.entity_month_kpi_flex enable row level security;

create policy "entity_month_kpi_authenticated_read"
  on public.entity_month_kpi for select to authenticated using (true);

create policy "entity_month_kpi_flex_authenticated_read"
  on public.entity_month_kpi_flex for select to authenticated using (true);
