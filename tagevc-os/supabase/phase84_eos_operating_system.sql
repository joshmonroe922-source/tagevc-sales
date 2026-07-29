-- Phase 84: Traction EOS operating system spine (entity_id-scoped + Tage rollup)
-- Shared UDL tables used by Tage VC, Recruit 619, Instant NDA, Signent HR.
-- Canonical write path for subsidiaries; Tage reads Consolidated or per-entity.

-- ── Rocks (quarterly) ───────────────────────────────────────────────────────
create table if not exists public.os_eos_rocks (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null,
  owner_profile_id uuid references public.profiles (id) on delete set null,
  quarter_key text not null,
  title text not null,
  description text,
  scope text not null default 'company'
    check (scope in ('personal', 'team', 'department', 'company')),
  status text not null default 'on_track'
    check (status in ('on_track', 'off_track', 'done', 'dropped')),
  source_portal text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_eos_rocks_entity_q_idx
  on public.os_eos_rocks (entity_id, quarter_key, status);
create index if not exists os_eos_rocks_owner_idx
  on public.os_eos_rocks (owner_profile_id, quarter_key);

-- ── Issues (IDS) ────────────────────────────────────────────────────────────
create table if not exists public.os_eos_issues (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null,
  raised_by_profile_id uuid references public.profiles (id) on delete set null,
  owner_profile_id uuid references public.profiles (id) on delete set null,
  title text not null,
  detail text,
  scope text not null default 'company'
    check (scope in ('personal', 'team', 'company')),
  status text not null default 'open'
    check (status in ('open', 'discussing', 'solved', 'dropped')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high')),
  source_portal text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_eos_issues_entity_status_idx
  on public.os_eos_issues (entity_id, status, updated_at desc);

-- ── L10 to-dos ──────────────────────────────────────────────────────────────
create table if not exists public.os_eos_todos (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null,
  assignee_profile_id uuid references public.profiles (id) on delete set null,
  title text not null,
  detail text,
  status text not null default 'open'
    check (status in ('open', 'done')),
  due_at timestamptz,
  source_portal text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_eos_todos_entity_assignee_idx
  on public.os_eos_todos (entity_id, assignee_profile_id, status);

-- ── Scorecard metric definitions + weekly entries ───────────────────────────
create table if not exists public.os_eos_scorecard_metrics (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null,
  metric_key text not null,
  label text not null,
  goal numeric,
  unit text not null default 'count',
  scope text not null default 'company'
    check (scope in ('personal', 'team', 'company')),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, metric_key)
);

create table if not exists public.os_eos_scorecard_entries (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null,
  metric_key text not null,
  week_key text not null,
  goal numeric,
  actual numeric,
  unit text not null default 'count',
  scope text not null default 'company'
    check (scope in ('personal', 'team', 'company')),
  on_track boolean,
  owner_profile_id uuid references public.profiles (id) on delete set null,
  source_portal text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Nullable owner → expression unique index
create unique index if not exists os_eos_scorecard_entries_uniq
  on public.os_eos_scorecard_entries (
    entity_id,
    metric_key,
    week_key,
    (coalesce(owner_profile_id, '00000000-0000-0000-0000-000000000000'::uuid))
  );

create index if not exists os_eos_scorecard_entries_week_idx
  on public.os_eos_scorecard_entries (entity_id, week_key);

-- ── V/TO (Vision / Traction Organizer) one-pager per entity ─────────────────
create table if not exists public.os_eos_vto (
  entity_id text primary key,
  core_values text,
  core_focus text,
  ten_year_target text,
  three_year_picture text,
  one_year_plan text,
  marketing_strategy text,
  issues_list_notes text,
  updated_by_profile_id uuid references public.profiles (id) on delete set null,
  source_portal text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.os_eos_rocks enable row level security;
alter table public.os_eos_issues enable row level security;
alter table public.os_eos_todos enable row level security;
alter table public.os_eos_scorecard_metrics enable row level security;
alter table public.os_eos_scorecard_entries enable row level security;
alter table public.os_eos_vto enable row level security;

drop policy if exists "os_eos_rocks_access" on public.os_eos_rocks;
create policy "os_eos_rocks_access" on public.os_eos_rocks
  for all to authenticated
  using (public.can_access_entity(entity_id) or public.is_firm_wide_access())
  with check (public.can_access_entity(entity_id) or public.is_firm_wide_access());

drop policy if exists "os_eos_issues_access" on public.os_eos_issues;
create policy "os_eos_issues_access" on public.os_eos_issues
  for all to authenticated
  using (public.can_access_entity(entity_id) or public.is_firm_wide_access())
  with check (public.can_access_entity(entity_id) or public.is_firm_wide_access());

drop policy if exists "os_eos_todos_access" on public.os_eos_todos;
create policy "os_eos_todos_access" on public.os_eos_todos
  for all to authenticated
  using (public.can_access_entity(entity_id) or public.is_firm_wide_access())
  with check (public.can_access_entity(entity_id) or public.is_firm_wide_access());

drop policy if exists "os_eos_scorecard_metrics_access" on public.os_eos_scorecard_metrics;
create policy "os_eos_scorecard_metrics_access" on public.os_eos_scorecard_metrics
  for all to authenticated
  using (public.can_access_entity(entity_id) or public.is_firm_wide_access())
  with check (public.can_access_entity(entity_id) or public.is_firm_wide_access());

drop policy if exists "os_eos_scorecard_entries_access" on public.os_eos_scorecard_entries;
create policy "os_eos_scorecard_entries_access" on public.os_eos_scorecard_entries
  for all to authenticated
  using (public.can_access_entity(entity_id) or public.is_firm_wide_access())
  with check (public.can_access_entity(entity_id) or public.is_firm_wide_access());

drop policy if exists "os_eos_vto_access" on public.os_eos_vto;
create policy "os_eos_vto_access" on public.os_eos_vto
  for all to authenticated
  using (public.can_access_entity(entity_id) or public.is_firm_wide_access())
  with check (public.can_access_entity(entity_id) or public.is_firm_wide_access());

grant select, insert, update, delete on public.os_eos_rocks to authenticated;
grant select, insert, update, delete on public.os_eos_issues to authenticated;
grant select, insert, update, delete on public.os_eos_todos to authenticated;
grant select, insert, update, delete on public.os_eos_scorecard_metrics to authenticated;
grant select, insert, update, delete on public.os_eos_scorecard_entries to authenticated;
grant select, insert, update, delete on public.os_eos_vto to authenticated;

grant select, insert, update, delete on public.os_eos_rocks to service_role;
grant select, insert, update, delete on public.os_eos_issues to service_role;
grant select, insert, update, delete on public.os_eos_todos to service_role;
grant select, insert, update, delete on public.os_eos_scorecard_metrics to service_role;
grant select, insert, update, delete on public.os_eos_scorecard_entries to service_role;
grant select, insert, update, delete on public.os_eos_vto to service_role;

-- ── Seed default scorecard metrics per operating entity ─────────────────────
insert into public.os_eos_scorecard_metrics (entity_id, metric_key, label, goal, unit, scope, sort_order)
values
  ('ENT-FIRM', 'weekly_issues_solved', 'Issues solved', 5, 'count', 'company', 10),
  ('ENT-FIRM', 'weekly_rocks_on_track', 'Rocks on track %', 80, 'percent', 'company', 20),
  ('ENT-R619', 'weekly_send_outs', 'Send-outs', 25, 'count', 'company', 10),
  ('ENT-R619', 'weekly_interviews', 'Interviews / offer stages', 40, 'count', 'company', 20),
  ('ENT-R619', 'weekly_placements', 'Placements', 4, 'count', 'company', 30),
  ('ENT-INDA', 'weekly_nda_volume', 'NDAs completed', 50, 'count', 'company', 10),
  ('ENT-INDA', 'weekly_mrr_growth', 'MRR growth', 2, 'percent', 'company', 20),
  ('ENT-INDA', 'weekly_churn_risk', 'At-risk accounts', 3, 'count', 'company', 30),
  ('ENT-SIGNENT', 'weekly_audits', 'HR audits closed', 4, 'count', 'company', 10),
  ('ENT-SIGNENT', 'weekly_proposals', 'Proposals out', 6, 'count', 'company', 20),
  ('ENT-SIGNENT', 'weekly_delivery_hours', 'Delivery hours', 80, 'hours', 'company', 30)
on conflict (entity_id, metric_key) do nothing;

-- ── Migrate Recruit 619 legacy desk EOS rows into spine (idempotent) ────────
do $$
begin
  if to_regclass('public.r619_eos_rocks') is not null then
    insert into public.os_eos_rocks (
      id, entity_id, owner_profile_id, quarter_key, title, description,
      scope, status, source_portal, created_at, updated_at
    )
    select
      id, entity_id, owner_profile_id, quarter_key, title, description,
      scope, status, 'r619', created_at, updated_at
    from public.r619_eos_rocks
    on conflict (id) do nothing;
  end if;

  if to_regclass('public.r619_eos_issues') is not null then
    insert into public.os_eos_issues (
      id, entity_id, raised_by_profile_id, owner_profile_id, title, detail,
      scope, status, priority, source_portal, created_at, updated_at
    )
    select
      id, entity_id, raised_by_profile_id, owner_profile_id, title, detail,
      scope, status, priority, 'r619', created_at, updated_at
    from public.r619_eos_issues
    on conflict (id) do nothing;
  end if;

  if to_regclass('public.r619_eos_todos') is not null then
    insert into public.os_eos_todos (
      id, entity_id, assignee_profile_id, title, detail, status, due_at,
      source_portal, created_at, updated_at
    )
    select
      id, entity_id, assignee_profile_id, title, detail, status, due_at,
      'r619', created_at, updated_at
    from public.r619_eos_todos
    on conflict (id) do nothing;
  end if;
end $$;

comment on table public.os_eos_rocks is
  'Traction EOS rocks — entity_id scoped; Tage Consolidated rolls up all entities.';
comment on table public.os_eos_issues is
  'Traction EOS IDS issues — entity_id scoped spine.';
comment on table public.os_eos_todos is
  'Traction EOS Level 10 to-dos — entity_id scoped spine.';
comment on table public.os_eos_vto is
  'Vision/Traction Organizer one-pager per operating entity.';
