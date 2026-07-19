-- Recruit 619 KPI hierarchy: Recruiter → Manager → Location → Region → COO
-- Portal mirror of TalentDesk org dimensions + monthly KPI facts.
-- Live computation remains in TalentDesk; portal stores hierarchy + optional facts.

-- ---------------------------------------------------------------------------
-- Org dimensions
-- ---------------------------------------------------------------------------
create table if not exists public.recruiting_regions (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references public.ops_entities (id) on delete cascade,
  name          text not null,
  code          text not null,
  salesforce_id text,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (entity_id, code)
);

create index if not exists recruiting_regions_entity_idx
  on public.recruiting_regions (entity_id, sort_order);

create table if not exists public.recruiting_locations (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references public.ops_entities (id) on delete cascade,
  region_id     uuid not null references public.recruiting_regions (id) on delete restrict,
  name          text not null,
  code          text not null,
  salesforce_id text,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (entity_id, code)
);

create index if not exists recruiting_locations_region_idx
  on public.recruiting_locations (region_id, sort_order);

-- Recruiter/manager org assignment (portal-side hierarchy mirror)
create table if not exists public.recruiting_org_members (
  id              uuid primary key default gen_random_uuid(),
  entity_id       uuid not null references public.ops_entities (id) on delete cascade,
  -- Portal sales_users.id and/or TalentDesk email for SSO match
  sales_user_id   uuid references public.sales_users (id) on delete set null,
  email           text not null,
  display_name    text not null default '',
  -- recruiter | manager | coo | admin
  role            text not null default 'recruiter',
  manager_member_id uuid references public.recruiting_org_members (id) on delete set null,
  location_id     uuid references public.recruiting_locations (id) on delete set null,
  sf_user_id      text,
  talentdesk_user_id text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (entity_id, email)
);

create index if not exists recruiting_org_members_manager_idx
  on public.recruiting_org_members (manager_member_id);
create index if not exists recruiting_org_members_location_idx
  on public.recruiting_org_members (location_id);

-- ---------------------------------------------------------------------------
-- Monthly KPI facts (per recruiter; rollups computed in app)
-- ---------------------------------------------------------------------------
create table if not exists public.recruiting_kpi_facts (
  id              uuid primary key default gen_random_uuid(),
  entity_id       uuid not null references public.ops_entities (id) on delete cascade,
  member_id       uuid not null references public.recruiting_org_members (id) on delete cascade,
  period_key      text not null, -- YYYY-MM
  -- Denormalized hierarchy for rollup queries
  manager_member_id uuid references public.recruiting_org_members (id) on delete set null,
  location_id     uuid references public.recruiting_locations (id) on delete set null,
  region_id       uuid references public.recruiting_regions (id) on delete set null,
  send_outs       numeric not null default 0,
  interviews      numeric not null default 0,
  job_board_applies numeric not null default 0,
  placements      numeric not null default 0,
  revenue         numeric not null default 0,
  commissions_earned numeric not null default 0,
  commissions_paid numeric not null default 0,
  time_to_fill_days numeric,
  notes           text not null default '',
  source          text not null default 'manual', -- manual | talentdesk | salesforce
  recorded_at     timestamptz not null default now(),
  recorded_by     uuid references public.sales_users (id) on delete set null,
  unique (member_id, period_key)
);

create index if not exists recruiting_kpi_facts_period_idx
  on public.recruiting_kpi_facts (entity_id, period_key);
create index if not exists recruiting_kpi_facts_manager_idx
  on public.recruiting_kpi_facts (manager_member_id, period_key);
create index if not exists recruiting_kpi_facts_location_idx
  on public.recruiting_kpi_facts (location_id, period_key);
create index if not exists recruiting_kpi_facts_region_idx
  on public.recruiting_kpi_facts (region_id, period_key);

alter table public.recruiting_regions enable row level security;
alter table public.recruiting_locations enable row level security;
alter table public.recruiting_org_members enable row level security;
alter table public.recruiting_kpi_facts enable row level security;

drop policy if exists "Entity users manage recruiting regions" on public.recruiting_regions;
create policy "Entity users manage recruiting regions"
  on public.recruiting_regions for all
  using (public.is_active_sales_user() and public.user_has_entity(entity_id))
  with check (public.is_active_sales_user() and public.user_has_entity(entity_id));

drop policy if exists "Entity users manage recruiting locations" on public.recruiting_locations;
create policy "Entity users manage recruiting locations"
  on public.recruiting_locations for all
  using (public.is_active_sales_user() and public.user_has_entity(entity_id))
  with check (public.is_active_sales_user() and public.user_has_entity(entity_id));

drop policy if exists "Entity users manage recruiting org members" on public.recruiting_org_members;
create policy "Entity users manage recruiting org members"
  on public.recruiting_org_members for all
  using (public.is_active_sales_user() and public.user_has_entity(entity_id))
  with check (public.is_active_sales_user() and public.user_has_entity(entity_id));

drop policy if exists "Entity users manage recruiting kpi facts" on public.recruiting_kpi_facts;
create policy "Entity users manage recruiting kpi facts"
  on public.recruiting_kpi_facts for all
  using (public.is_active_sales_user() and public.user_has_entity(entity_id))
  with check (public.is_active_sales_user() and public.user_has_entity(entity_id));

-- Expand Recruit 619 entity KPI templates to full recruiting pack
insert into public.entity_kpi_templates (entity_slug, key, label, description, unit, target_value, sort_order)
values
  ('recruit-619', 'send_outs_month', 'Send outs / month', 'Client submittals (send outs).', 'count', 80, 10),
  ('recruit-619', 'interviews_month', 'Interviews / month', 'Applications reaching interview/offer.', 'count', null, 15),
  ('recruit-619', 'job_board_applies_month', 'Job board applies / month', 'ATS / job-board pipeline count.', 'count', null, 18),
  ('recruit-619', 'placements_month', 'Placements / month', 'Confirmed placements by placement date.', 'count', 8, 20),
  ('recruit-619', 'send_outs_per_placement', 'Send outs per placement', 'Send outs ÷ placements.', 'ratio', 10, 30),
  ('recruit-619', 'placement_conversion_pct', 'Send-out → placement %', 'Placements ÷ send outs.', '%', null, 32),
  ('recruit-619', 'interview_to_placement_pct', 'Interview → placement %', 'Placements ÷ interviews.', '%', null, 34),
  ('recruit-619', 'revenue_month', 'Revenue / month', 'Fee revenue by placement date month.', 'USD', null, 40),
  ('recruit-619', 'commissions_earned_month', 'Commissions earned / month', 'Earned on placement date month.', 'USD', null, 50),
  ('recruit-619', 'commissions_paid_month', 'Commissions paid / month', 'Paid on commission paid date (typically following month).', 'USD', null, 60),
  ('recruit-619', 'time_to_fill_days', 'Time to fill (avg days)', 'Job open → placement confirmed.', 'days', null, 70)
on conflict (entity_slug, key) do update set
  label = excluded.label,
  description = excluded.description,
  unit = excluded.unit,
  target_value = coalesce(excluded.target_value, public.entity_kpi_templates.target_value),
  sort_order = excluded.sort_order;

-- Seed KPIs onto existing recruit-619 entity if present
do $$
declare
  v_entity_id uuid;
begin
  select id into v_entity_id from public.ops_entities where slug = 'recruit-619' limit 1;
  if v_entity_id is null then
    return;
  end if;

  insert into public.entity_kpis (
    entity_id, key, label, description, unit, target_value, sort_order, active
  )
  select
    v_entity_id, t.key, t.label, t.description, t.unit, t.target_value, t.sort_order, true
  from public.entity_kpi_templates t
  where t.entity_slug = 'recruit-619'
  on conflict (entity_id, key) do update set
    label = excluded.label,
    description = excluded.description,
    unit = excluded.unit,
    target_value = coalesce(excluded.target_value, public.entity_kpis.target_value),
    sort_order = excluded.sort_order,
    updated_at = now();
end $$;
