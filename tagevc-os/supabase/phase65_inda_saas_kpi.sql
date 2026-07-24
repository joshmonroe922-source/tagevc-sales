-- Instant NDA SaaS KPI goals (additive)
-- Targets per KPI by role and period. Never invent actuals — goals only.

create table if not exists public.inda_kpi_goals (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null default 'ENT-INDA',
  kpi_id text not null,
  role_key text not null default 'subsidiary_leader',
  period_key text not null default 'current_month',
  period_start date,
  period_end date,
  target_value numeric,
  target_label text,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, kpi_id, role_key, period_key)
);

create index if not exists inda_kpi_goals_entity_idx
  on public.inda_kpi_goals (entity_id);
create index if not exists inda_kpi_goals_role_period_idx
  on public.inda_kpi_goals (entity_id, role_key, period_key);

alter table public.inda_kpi_goals enable row level security;

drop policy if exists inda_kpi_goals_select on public.inda_kpi_goals;
create policy inda_kpi_goals_select on public.inda_kpi_goals
  for select to authenticated
  using (
    entity_id = 'ENT-INDA'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active = true
        and (
          p.entity_id = 'ENT-INDA'
          or p.role in ('visionary', 'admin', 'partner', 'coo', 'counsel_ops', 'service_lead')
        )
    )
  );

drop policy if exists inda_kpi_goals_write on public.inda_kpi_goals;
create policy inda_kpi_goals_write on public.inda_kpi_goals
  for all to authenticated
  using (
    entity_id = 'ENT-INDA'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active = true
        and p.role in ('visionary', 'admin', 'partner', 'coo', 'sub_lead', 'service_lead')
    )
  )
  with check (
    entity_id = 'ENT-INDA'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active = true
        and p.role in ('visionary', 'admin', 'partner', 'coo', 'sub_lead', 'service_lead')
    )
  );

-- Optional durable snapshot cache for Tage parent reads
create table if not exists public.inda_saas_kpi_snapshots (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null default 'ENT-INDA',
  captured_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  source_status jsonb not null default '{}'::jsonb
);

create index if not exists inda_saas_kpi_snapshots_entity_captured_idx
  on public.inda_saas_kpi_snapshots (entity_id, captured_at desc);

alter table public.inda_saas_kpi_snapshots enable row level security;

drop policy if exists inda_saas_kpi_snapshots_select on public.inda_saas_kpi_snapshots;
create policy inda_saas_kpi_snapshots_select on public.inda_saas_kpi_snapshots
  for select to authenticated
  using (
    entity_id = 'ENT-INDA'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.active = true
    )
  );
