-- HR shared services foundation (parent + portfolio).
-- Onboarding / offboarding checklists, employee records, compliance controls.
-- Kept under Human Resources portal — not entity-detail pages.
-- Run after 0023_legal_compliance.sql.

-- ---------------------------------------------------------------------------
-- Portal catalog
-- ---------------------------------------------------------------------------
update public.sales_portals
set
  description =
    'Shared HR: employees, onboarding/offboarding, and compliance across parent + portfolio.',
  active = true
where slug = 'human-resources';

-- ---------------------------------------------------------------------------
-- HR can read company names (employee / control scoping) without full ops access
-- ---------------------------------------------------------------------------
drop policy if exists "Users view assigned ops entities" on public.ops_entities;
create policy "Users view assigned ops entities"
  on public.ops_entities for select
  using (
    public.is_active_sales_user()
    and (
      public.user_has_entity(id)
      or public.user_has_portal('legal')
      or public.user_has_portal('human-resources')
    )
  );

-- ---------------------------------------------------------------------------
-- hr_employees
-- ---------------------------------------------------------------------------
create table if not exists public.hr_employees (
  id                 uuid primary key default gen_random_uuid(),
  -- null = Tage parent / shared services; set for portfolio company staff
  entity_id          uuid references public.ops_entities (id) on delete set null,
  full_name          text not null,
  work_email         text not null default '',
  personal_email     text not null default '',
  role_title         text not null default '',
  department         text not null default '',
  employment_status  text not null default 'active'
                       check (employment_status in (
                         'prospect',
                         'onboarding',
                         'active',
                         'offboarding',
                         'terminated',
                         'alumni'
                       )),
  start_date         date,
  end_date           date,
  manager_name       text not null default '',
  location           text not null default '',
  notes              text not null default '',
  created_by         uuid references public.sales_users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists hr_employees_entity_idx on public.hr_employees (entity_id);
create index if not exists hr_employees_status_idx on public.hr_employees (employment_status);
create index if not exists hr_employees_name_idx on public.hr_employees (full_name);

alter table public.hr_employees enable row level security;

create or replace function public.set_hr_employees_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists hr_employees_updated_at on public.hr_employees;
create trigger hr_employees_updated_at
  before update on public.hr_employees
  for each row execute function public.set_hr_employees_updated_at();

create policy "HR users manage employees"
  on public.hr_employees for all
  using (public.is_active_sales_user() and public.user_has_portal('human-resources'))
  with check (public.is_active_sales_user() and public.user_has_portal('human-resources'));

-- ---------------------------------------------------------------------------
-- Checklist templates (onboarding / offboarding)
-- ---------------------------------------------------------------------------
create table if not exists public.hr_onboarding_checklists (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.hr_employees (id) on delete cascade,
  kind           text not null
                   check (kind in ('onboarding', 'offboarding')),
  status         text not null default 'open'
                   check (status in ('open', 'in_progress', 'complete', 'cancelled')),
  template_slug  text not null default '',
  started_at     timestamptz,
  completed_at   timestamptz,
  notes          text not null default '',
  created_by     uuid references public.sales_users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists hr_onboarding_checklists_employee_idx
  on public.hr_onboarding_checklists (employee_id);
create index if not exists hr_onboarding_checklists_kind_status_idx
  on public.hr_onboarding_checklists (kind, status);

alter table public.hr_onboarding_checklists enable row level security;

create or replace function public.set_hr_onboarding_checklists_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists hr_onboarding_checklists_updated_at on public.hr_onboarding_checklists;
create trigger hr_onboarding_checklists_updated_at
  before update on public.hr_onboarding_checklists
  for each row execute function public.set_hr_onboarding_checklists_updated_at();

create policy "HR users manage onboarding checklists"
  on public.hr_onboarding_checklists for all
  using (public.is_active_sales_user() and public.user_has_portal('human-resources'))
  with check (public.is_active_sales_user() and public.user_has_portal('human-resources'));

-- ---------------------------------------------------------------------------
-- Checklist items
-- ---------------------------------------------------------------------------
create table if not exists public.hr_checklist_items (
  id              uuid primary key default gen_random_uuid(),
  checklist_id    uuid not null references public.hr_onboarding_checklists (id) on delete cascade,
  title           text not null,
  category        text not null default 'General',
  sort_order      int not null default 100,
  status          text not null default 'todo'
                    check (status in ('todo', 'doing', 'done', 'na')),
  -- Future Phase 3/4 hooks — do not store credentials here
  system_hook     text
                    check (
                      system_hook is null
                      or system_hook in (
                        'payroll',
                        'it_provision',
                        'asset_audit',
                        'benefits',
                        'swag',
                        'access_revoke',
                        'manual'
                      )
                    ),
  assignee_hint   text not null default '',
  due_at          timestamptz,
  completed_at    timestamptz,
  notes           text not null default '',
  created_at      timestamptz not null default now()
);

create index if not exists hr_checklist_items_checklist_idx
  on public.hr_checklist_items (checklist_id, sort_order);

alter table public.hr_checklist_items enable row level security;

create policy "HR users manage checklist items"
  on public.hr_checklist_items for all
  using (public.is_active_sales_user() and public.user_has_portal('human-resources'))
  with check (public.is_active_sales_user() and public.user_has_portal('human-resources'));

-- ---------------------------------------------------------------------------
-- Compliance controls (HR audit tracker — parent + entity scoped)
-- ---------------------------------------------------------------------------
create table if not exists public.hr_compliance_controls (
  id               uuid primary key default gen_random_uuid(),
  -- null = parent / shared services; set for portfolio entity
  entity_id        uuid references public.ops_entities (id) on delete set null,
  control_key      text not null default '',
  title            text not null,
  description      text not null default '',
  cadence          text not null default 'annual'
                     check (cadence in ('annual', 'monthly', 'quarterly', 'one_time', 'custom')),
  owner_role       text not null default 'HR',
  next_due_at      date,
  last_reviewed_at date,
  status           text not null default 'open'
                     check (status in ('open', 'in_progress', 'compliant', 'gap', 'na')),
  evidence_url     text not null default '',
  notes            text not null default '',
  active           boolean not null default true,
  created_by       uuid references public.sales_users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists hr_compliance_controls_entity_idx
  on public.hr_compliance_controls (entity_id);
create index if not exists hr_compliance_controls_status_idx
  on public.hr_compliance_controls (status)
  where active = true;
create index if not exists hr_compliance_controls_due_idx
  on public.hr_compliance_controls (next_due_at)
  where active = true;

alter table public.hr_compliance_controls enable row level security;

create or replace function public.set_hr_compliance_controls_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists hr_compliance_controls_updated_at on public.hr_compliance_controls;
create trigger hr_compliance_controls_updated_at
  before update on public.hr_compliance_controls
  for each row execute function public.set_hr_compliance_controls_updated_at();

create policy "HR users manage compliance controls"
  on public.hr_compliance_controls for all
  using (public.is_active_sales_user() and public.user_has_portal('human-resources'))
  with check (public.is_active_sales_user() and public.user_has_portal('human-resources'));
