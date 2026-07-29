-- Prerequisite: SSC app_role enum values (phase83) must exist before policies referencing ssc_hr / ssc_finance.
-- If missing: alter type public.app_role add value if not exists 'ssc_hr'; (etc.)

-- Phase 85: Org spine (reports-to + title) · L10 weekly meetings · hire financial impact
-- Shared UDL — apply once. Idempotent. Mirrored in subsidiary supabase/ for scaffolds.

-- ── Profiles: reports-to + job title ────────────────────────────────────────
alter table public.profiles
  add column if not exists manager_profile_id uuid references public.profiles (id) on delete set null;

alter table public.profiles
  add column if not exists job_title text;

create index if not exists profiles_manager_profile_idx
  on public.profiles (manager_profile_id)
  where manager_profile_id is not null;

create index if not exists profiles_entity_active_idx
  on public.profiles (entity_id, active)
  where active = true;

-- Prevent trivial self-manager; deeper cycles enforced in app
create or replace function public.profiles_reject_self_manager()
returns trigger
language plpgsql
as $$
begin
  if new.manager_profile_id is not null and new.manager_profile_id = new.id then
    raise exception 'manager_profile_id cannot equal profile id';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_reject_self_manager_trg on public.profiles;
create trigger profiles_reject_self_manager_trg
  before insert or update of manager_profile_id on public.profiles
  for each row execute function public.profiles_reject_self_manager();

-- Admin / HR / Visionary / COO may update org fields on others
drop policy if exists "profiles_update_org_spine" on public.profiles;
create policy "profiles_update_org_spine"
  on public.profiles for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active = true
        and p.role in ('admin', 'visionary', 'coo', 'ssc_hr', 'partner')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active = true
        and p.role in ('admin', 'visionary', 'coo', 'ssc_hr', 'partner')
    )
  );

-- ── Org L10 teams (per meeting owner / level — NOT company-wide) ────────────
create table if not exists public.os_org_l10_teams (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null,
  name text not null,
  owner_profile_id uuid not null references public.profiles (id) on delete cascade,
  level_key text not null default 'leadership'
    check (level_key in ('firm', 'entity', 'leadership', 'department', 'team')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, owner_profile_id, name)
);

create index if not exists os_org_l10_teams_entity_owner_idx
  on public.os_org_l10_teams (entity_id, owner_profile_id)
  where active = true;

alter table public.os_org_l10_teams enable row level security;

drop policy if exists os_org_l10_teams_select on public.os_org_l10_teams;
create policy os_org_l10_teams_select on public.os_org_l10_teams
  for select to authenticated using (true);

drop policy if exists os_org_l10_teams_write on public.os_org_l10_teams;
create policy os_org_l10_teams_write on public.os_org_l10_teams
  for all to authenticated
  using (
    owner_profile_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'visionary', 'coo', 'ssc_hr', 'partner', 'sub_lead')
    )
  )
  with check (
    owner_profile_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'visionary', 'coo', 'ssc_hr', 'partner', 'sub_lead')
    )
  );

grant select, insert, update, delete on public.os_org_l10_teams to authenticated;
grant select, insert, update, delete on public.os_org_l10_teams to service_role;

-- ── Weekly L10 meeting instances ────────────────────────────────────────────
create table if not exists public.os_eos_l10_meetings (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.os_org_l10_teams (id) on delete set null,
  entity_id text not null,
  week_key text not null,
  title text not null,
  owner_profile_id uuid not null references public.profiles (id) on delete cascade,
  -- Live EOS snapshot at generate/save time
  snapshot jsonb not null default '{}'::jsonb,
  -- In-meeting notes (markdown / plain) — Save writes here + optional doc library
  notes_body text not null default '',
  document_id uuid,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'closed')),
  generated_at timestamptz not null default now(),
  saved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists os_eos_l10_meetings_week_owner_uidx
  on public.os_eos_l10_meetings (
    entity_id,
    owner_profile_id,
    week_key,
    coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists os_eos_l10_meetings_entity_week_idx
  on public.os_eos_l10_meetings (entity_id, week_key desc);

create index if not exists os_eos_l10_meetings_owner_idx
  on public.os_eos_l10_meetings (owner_profile_id, week_key desc);

alter table public.os_eos_l10_meetings enable row level security;

drop policy if exists os_eos_l10_meetings_select on public.os_eos_l10_meetings;
create policy os_eos_l10_meetings_select on public.os_eos_l10_meetings
  for select to authenticated
  using (
    owner_profile_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.role in ('admin', 'visionary', 'coo', 'ssc_hr', 'partner')
          or (p.role = 'sub_lead' and p.entity_id = os_eos_l10_meetings.entity_id)
        )
    )
  );

drop policy if exists os_eos_l10_meetings_write on public.os_eos_l10_meetings;
create policy os_eos_l10_meetings_write on public.os_eos_l10_meetings
  for all to authenticated
  using (
    owner_profile_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'visionary', 'coo', 'ssc_hr', 'partner')
    )
  )
  with check (
    owner_profile_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'visionary', 'coo', 'ssc_hr', 'partner')
    )
  );

grant select, insert, update, delete on public.os_eos_l10_meetings to authenticated;
grant select, insert, update, delete on public.os_eos_l10_meetings to service_role;

-- ── Hire role cost templates (editable until IES payroll live) ──────────────
create table if not exists public.os_hire_role_cost_templates (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null,
  role_key text not null,
  title text not null,
  level_label text not null default '',
  base_salary_annual numeric not null default 0,
  burden_pct numeric not null default 0.30,
  tools_annual numeric not null default 0,
  recruiting_one_time numeric not null default 0,
  notes text,
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, role_key)
);

create index if not exists os_hire_role_cost_templates_entity_idx
  on public.os_hire_role_cost_templates (entity_id)
  where active = true;

alter table public.os_hire_role_cost_templates enable row level security;

drop policy if exists os_hire_role_cost_select on public.os_hire_role_cost_templates;
create policy os_hire_role_cost_select on public.os_hire_role_cost_templates
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.role in ('admin', 'visionary', 'coo', 'partner', 'ssc_hr', 'ssc_finance', 'sub_lead')
          or p.entity_id = os_hire_role_cost_templates.entity_id
        )
    )
  );

drop policy if exists os_hire_role_cost_write on public.os_hire_role_cost_templates;
create policy os_hire_role_cost_write on public.os_hire_role_cost_templates
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'visionary', 'coo', 'partner', 'ssc_hr', 'ssc_finance', 'sub_lead')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'visionary', 'coo', 'partner', 'ssc_hr', 'ssc_finance', 'sub_lead')
    )
  );

grant select, insert, update, delete on public.os_hire_role_cost_templates to authenticated;
grant select, insert, update, delete on public.os_hire_role_cost_templates to service_role;

-- ── Hire impact scenarios (dynamic budget over time) ────────────────────────
create table if not exists public.os_hire_impact_scenarios (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null,
  title text not null,
  template_id uuid references public.os_hire_role_cost_templates (id) on delete set null,
  role_title text not null,
  manager_profile_id uuid references public.profiles (id) on delete set null,
  hris_employee_id uuid,
  headcount int not null default 1 check (headcount > 0),
  start_month date not null,
  months int not null default 12 check (months between 1 and 60),
  base_salary_annual numeric not null default 0,
  burden_pct numeric not null default 0.30,
  tools_annual numeric not null default 0,
  recruiting_one_time numeric not null default 0,
  status text not null default 'draft'
    check (status in ('draft', 'planned', 'approved', 'hired', 'cancelled')),
  assumptions_locked boolean not null default false,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_hire_impact_scenarios_entity_idx
  on public.os_hire_impact_scenarios (entity_id, status, start_month);

alter table public.os_hire_impact_scenarios enable row level security;

drop policy if exists os_hire_impact_select on public.os_hire_impact_scenarios;
create policy os_hire_impact_select on public.os_hire_impact_scenarios
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.role in ('admin', 'visionary', 'coo', 'partner', 'ssc_hr', 'ssc_finance')
          or (p.role = 'sub_lead' and p.entity_id = os_hire_impact_scenarios.entity_id)
          or p.id = os_hire_impact_scenarios.manager_profile_id
          or p.id = os_hire_impact_scenarios.created_by
        )
    )
  );

drop policy if exists os_hire_impact_write on public.os_hire_impact_scenarios;
create policy os_hire_impact_write on public.os_hire_impact_scenarios
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.role in ('admin', 'visionary', 'coo', 'partner', 'ssc_hr', 'ssc_finance')
          or (p.role = 'sub_lead' and p.entity_id = os_hire_impact_scenarios.entity_id)
          or p.id = os_hire_impact_scenarios.created_by
        )
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.role in ('admin', 'visionary', 'coo', 'partner', 'ssc_hr', 'ssc_finance')
          or (p.role = 'sub_lead' and p.entity_id = os_hire_impact_scenarios.entity_id)
          or p.id = os_hire_impact_scenarios.created_by
        )
    )
  );

grant select, insert, update, delete on public.os_hire_impact_scenarios to authenticated;
grant select, insert, update, delete on public.os_hire_impact_scenarios to service_role;

-- Seed default role cost templates per operating entity (editable assumptions)
insert into public.os_hire_role_cost_templates (
  entity_id, role_key, title, level_label,
  base_salary_annual, burden_pct, tools_annual, recruiting_one_time, notes
)
values
  ('ENT-FIRM', 'associate', 'Associate', 'IC', 95000, 0.32, 2400, 8000, 'Editable until IES payroll live'),
  ('ENT-FIRM', 'ops_lead', 'Ops Lead', 'Manager', 135000, 0.32, 3600, 12000, 'Editable until IES payroll live'),
  ('ENT-R619', 'recruiter', 'Recruiter', 'IC', 45000, 0.30, 1800, 6000, 'Editable until IES payroll live'),
  ('ENT-R619', 'senior_recruiter', 'Senior Recruiter', 'Senior IC', 55000, 0.30, 2400, 8000, 'Editable until IES payroll live'),
  ('ENT-R619', 'team_lead', 'Team Lead', 'Manager', 65000, 0.32, 3000, 10000, 'Editable until IES payroll live'),
  ('ENT-INDA', 'cs_rep', 'Customer Success', 'IC', 70000, 0.30, 1800, 5000, 'Editable until IES payroll live'),
  ('ENT-INDA', 'engineer', 'Software Engineer', 'IC', 130000, 0.32, 3600, 15000, 'Editable until IES payroll live'),
  ('ENT-SIGNENT', 'hr_specialist', 'HR Specialist', 'IC', 72000, 0.30, 1800, 5500, 'Editable until IES payroll live'),
  ('ENT-SIGNENT', 'hr_manager', 'HR Manager', 'Manager', 105000, 0.32, 2400, 9000, 'Editable until IES payroll live')
on conflict (entity_id, role_key) do nothing;

-- Recruiting bases + Team Lead title (dropdown: Recruiter → Senior Recruiter → Team Lead)
update public.os_hire_role_cost_templates
set
  base_salary_annual = case role_key
    when 'recruiter' then 45000
    when 'senior_recruiter' then 55000
    when 'team_lead' then 65000
  end,
  title = case role_key
    when 'recruiter' then 'Recruiter'
    when 'senior_recruiter' then 'Senior Recruiter'
    when 'team_lead' then 'Team Lead'
  end,
  updated_at = now()
where entity_id = 'ENT-R619'
  and role_key in ('recruiter', 'senior_recruiter', 'team_lead');
