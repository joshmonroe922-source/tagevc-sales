-- Phase 68: HRIS employee system of record + onboarding/offboarding process runs.
-- Additive. Safe to re-run. Does NOT touch os_store_snapshots or legacy hr_*.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Employees (system of record)
-- ---------------------------------------------------------------------------
create table if not exists public.os_hris_employees (
  id uuid primary key default gen_random_uuid(),
  employee_key text not null unique
    check (employee_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$'),
  full_name text not null,
  work_email text not null default '',
  personal_email text not null default '',
  phone text not null default '',
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  role_title text not null default '',
  department text not null default '',
  location text not null default '',
  manager_employee_id uuid references public.os_hris_employees (id) on delete set null,
  manager_name text not null default '',
  status text not null default 'pre_start'
    check (status in (
      'pre_start', 'onboarding', 'active', 'leave', 'offboarding', 'terminated'
    )),
  start_date date,
  end_date date,
  offer_accepted_at date,
  onboarding_status text not null default 'none'
    check (onboarding_status in (
      'none', 'not_started', 'in_progress', 'blocked', 'complete', 'cancelled'
    )),
  offboarding_status text not null default 'none'
    check (offboarding_status in (
      'none', 'not_started', 'in_progress', 'blocked', 'complete', 'cancelled'
    )),
  onboarding_pct numeric not null default 0
    check (onboarding_pct >= 0 and onboarding_pct <= 100),
  offboarding_pct numeric not null default 0
    check (offboarding_pct >= 0 and offboarding_pct <= 100),
  profile_id uuid,
  recruit_assignment jsonb not null default '{}'::jsonb,
  notes text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_hris_employees_entity_idx
  on public.os_hris_employees (entity_id, status);
create index if not exists os_hris_employees_name_idx
  on public.os_hris_employees (full_name);
create index if not exists os_hris_employees_status_idx
  on public.os_hris_employees (status);

alter table public.os_hris_employees enable row level security;

drop policy if exists os_hris_employees_select on public.os_hris_employees;
create policy os_hris_employees_select on public.os_hris_employees
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

drop policy if exists os_hris_employees_write on public.os_hris_employees;
create policy os_hris_employees_write on public.os_hris_employees
  for all to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  )
  with check (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

revoke all on public.os_hris_employees from public, anon;
grant select, insert, update, delete on public.os_hris_employees to authenticated;

create or replace function public.set_os_hris_employees_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists os_hris_employees_updated_at on public.os_hris_employees;
create trigger os_hris_employees_updated_at
  before update on public.os_hris_employees
  for each row execute function public.set_os_hris_employees_updated_at();

-- ---------------------------------------------------------------------------
-- Process templates
-- ---------------------------------------------------------------------------
create table if not exists public.os_hris_process_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  kind text not null check (kind in ('onboarding', 'offboarding')),
  title text not null,
  description text not null default '',
  source_doc text not null default '',
  audience text not null default 'all'
    check (audience in ('all', 'recruit619', 'signent', 'parent')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.os_hris_process_template_steps (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null
    references public.os_hris_process_templates (id) on delete cascade,
  step_key text not null
    check (step_key ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  title text not null,
  category text not null default 'General',
  sort_order int not null default 100,
  owner_role text not null default 'Human Resources',
  timing_anchor text not null default 'start_date'
    check (timing_anchor in ('offer_accepted', 'start_date', 'end_date')),
  offset_days int not null default 0,
  evidence_required boolean not null default false,
  automation text not null default 'manual'
    check (automation in ('manual', 'assist', 'auto')),
  destructive boolean not null default false,
  optional_for_audience boolean not null default false,
  system_hook text
    check (
      system_hook is null
      or system_hook in (
        'manual', 'payroll', 'it_provision', 'asset_audit', 'benefits',
        'access_revoke', 'i9', 'handbook_ack', 'employment_contract',
        'compliance_ack', 'messaging_revoke', 'portal_revoke', 'ticketing_revoke',
        'knowledge_handoff', 'exit_interview'
      )
    ),
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (template_id, step_key)
);

create index if not exists os_hris_template_steps_order_idx
  on public.os_hris_process_template_steps (template_id, sort_order);

alter table public.os_hris_process_templates enable row level security;
alter table public.os_hris_process_template_steps enable row level security;

drop policy if exists os_hris_templates_select on public.os_hris_process_templates;
create policy os_hris_templates_select on public.os_hris_process_templates
  for select to authenticated using (true);

drop policy if exists os_hris_templates_write on public.os_hris_process_templates;
create policy os_hris_templates_write on public.os_hris_process_templates
  for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

drop policy if exists os_hris_template_steps_select on public.os_hris_process_template_steps;
create policy os_hris_template_steps_select on public.os_hris_process_template_steps
  for select to authenticated using (true);

drop policy if exists os_hris_template_steps_write on public.os_hris_process_template_steps;
create policy os_hris_template_steps_write on public.os_hris_process_template_steps
  for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

revoke all on public.os_hris_process_templates from public, anon;
revoke all on public.os_hris_process_template_steps from public, anon;
grant select, insert, update, delete on public.os_hris_process_templates to authenticated;
grant select, insert, update, delete on public.os_hris_process_template_steps to authenticated;

-- ---------------------------------------------------------------------------
-- Process runs + steps
-- ---------------------------------------------------------------------------
create table if not exists public.os_hris_process_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique
    check (run_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$'),
  employee_id uuid not null
    references public.os_hris_employees (id) on delete cascade,
  template_id uuid not null
    references public.os_hris_process_templates (id),
  kind text not null check (kind in ('onboarding', 'offboarding')),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'blocked', 'complete', 'cancelled')),
  completion_pct numeric not null default 0
    check (completion_pct >= 0 and completion_pct <= 100),
  escalated_ticket_id text,
  offer_accepted_at date,
  start_date date,
  end_date date,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_hris_runs_employee_idx
  on public.os_hris_process_runs (employee_id, kind, status);
create index if not exists os_hris_runs_kind_status_idx
  on public.os_hris_process_runs (kind, status);

create table if not exists public.os_hris_process_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null
    references public.os_hris_process_runs (id) on delete cascade,
  template_step_id uuid
    references public.os_hris_process_template_steps (id) on delete set null,
  step_key text not null,
  title text not null,
  category text not null default 'General',
  sort_order int not null default 100,
  owner_role text not null default 'Human Resources',
  timing_anchor text not null default 'start_date',
  offset_days int not null default 0,
  due_at date,
  status text not null default 'pending'
    check (status in (
      'pending', 'in_progress', 'done', 'waived', 'blocked', 'na'
    )),
  evidence_required boolean not null default false,
  evidence_note text not null default '',
  evidence_url text,
  automation text not null default 'manual',
  destructive boolean not null default false,
  optional_for_audience boolean not null default false,
  system_hook text,
  blocker boolean not null default false,
  escalated_ticket_id text,
  completed_by uuid,
  completed_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, step_key)
);

create index if not exists os_hris_steps_run_order_idx
  on public.os_hris_process_steps (run_id, sort_order);
create index if not exists os_hris_steps_due_idx
  on public.os_hris_process_steps (due_at, status)
  where status in ('pending', 'in_progress', 'blocked');

alter table public.os_hris_process_runs enable row level security;
alter table public.os_hris_process_steps enable row level security;

drop policy if exists os_hris_runs_select on public.os_hris_process_runs;
create policy os_hris_runs_select on public.os_hris_process_runs
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.os_hris_employees e
      where e.id = employee_id and public.can_access_entity(e.entity_id)
    )
  );

drop policy if exists os_hris_runs_write on public.os_hris_process_runs;
create policy os_hris_runs_write on public.os_hris_process_runs
  for all to authenticated
  using (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.os_hris_employees e
      where e.id = employee_id and public.can_access_entity(e.entity_id)
    )
  )
  with check (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.os_hris_employees e
      where e.id = employee_id and public.can_access_entity(e.entity_id)
    )
  );

drop policy if exists os_hris_steps_select on public.os_hris_process_steps;
create policy os_hris_steps_select on public.os_hris_process_steps
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or exists (
      select 1
      from public.os_hris_process_runs r
      join public.os_hris_employees e on e.id = r.employee_id
      where r.id = run_id and public.can_access_entity(e.entity_id)
    )
  );

drop policy if exists os_hris_steps_write on public.os_hris_process_steps;
create policy os_hris_steps_write on public.os_hris_process_steps
  for all to authenticated
  using (
    public.is_firm_wide_access()
    or exists (
      select 1
      from public.os_hris_process_runs r
      join public.os_hris_employees e on e.id = r.employee_id
      where r.id = run_id and public.can_access_entity(e.entity_id)
    )
  )
  with check (
    public.is_firm_wide_access()
    or exists (
      select 1
      from public.os_hris_process_runs r
      join public.os_hris_employees e on e.id = r.employee_id
      where r.id = run_id and public.can_access_entity(e.entity_id)
    )
  );

revoke all on public.os_hris_process_runs from public, anon;
revoke all on public.os_hris_process_steps from public, anon;
grant select, insert, update, delete on public.os_hris_process_runs to authenticated;
grant select, insert, update, delete on public.os_hris_process_steps to authenticated;

-- ---------------------------------------------------------------------------
-- Events + soft links
-- ---------------------------------------------------------------------------
create table if not exists public.os_hris_employee_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null
    references public.os_hris_employees (id) on delete cascade,
  event_kind text not null
    check (event_kind in (
      'created', 'status_change', 'step_done', 'step_waived', 'step_blocked',
      'escalated', 'note', 'run_started', 'run_completed', 'link_added'
    )),
  summary text not null,
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists os_hris_events_employee_idx
  on public.os_hris_employee_events (employee_id, created_at desc);

create table if not exists public.os_hris_employee_links (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null
    references public.os_hris_employees (id) on delete cascade,
  kind text not null
    check (kind in (
      'document', 'equipment', 'access', 'it_onboarding', 'it_offboarding',
      'ticket', 'checklist', 'other'
    )),
  ref_id text not null,
  label text not null,
  href text,
  created_at timestamptz not null default now()
);

create index if not exists os_hris_links_employee_idx
  on public.os_hris_employee_links (employee_id, kind);

alter table public.os_hris_employee_events enable row level security;
alter table public.os_hris_employee_links enable row level security;

drop policy if exists os_hris_events_select on public.os_hris_employee_events;
create policy os_hris_events_select on public.os_hris_employee_events
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.os_hris_employees e
      where e.id = employee_id and public.can_access_entity(e.entity_id)
    )
  );

drop policy if exists os_hris_events_write on public.os_hris_employee_events;
create policy os_hris_events_write on public.os_hris_employee_events
  for insert to authenticated
  with check (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.os_hris_employees e
      where e.id = employee_id and public.can_access_entity(e.entity_id)
    )
  );

drop policy if exists os_hris_links_select on public.os_hris_employee_links;
create policy os_hris_links_select on public.os_hris_employee_links
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.os_hris_employees e
      where e.id = employee_id and public.can_access_entity(e.entity_id)
    )
  );

drop policy if exists os_hris_links_write on public.os_hris_employee_links;
create policy os_hris_links_write on public.os_hris_employee_links
  for all to authenticated
  using (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.os_hris_employees e
      where e.id = employee_id and public.can_access_entity(e.entity_id)
    )
  )
  with check (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.os_hris_employees e
      where e.id = employee_id and public.can_access_entity(e.entity_id)
    )
  );

revoke all on public.os_hris_employee_events from public, anon;
revoke all on public.os_hris_employee_links from public, anon;
grant select, insert on public.os_hris_employee_events to authenticated;
grant select, insert, update, delete on public.os_hris_employee_links to authenticated;

-- Cadence run log
create table if not exists public.os_hris_cadence_runs (
  run_id uuid primary key default gen_random_uuid(),
  run_kind text not null
    check (run_kind in ('full', 'timing', 'escalate')),
  trigger_source text not null default 'cron'
    check (trigger_source in ('cron', 'manual', 'api')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean not null default true,
  steps_retimed integer not null default 0,
  escalations_created integer not null default 0,
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid
);

alter table public.os_hris_cadence_runs enable row level security;
drop policy if exists os_hris_cadence_select on public.os_hris_cadence_runs;
create policy os_hris_cadence_select on public.os_hris_cadence_runs
  for select to authenticated using (public.is_firm_wide_access());
revoke all on public.os_hris_cadence_runs from public, anon;
grant select, insert, update on public.os_hris_cadence_runs to authenticated;

-- ---------------------------------------------------------------------------
-- Seed templates (idempotent)
-- ---------------------------------------------------------------------------
insert into public.os_hris_process_templates
  (slug, kind, title, description, source_doc, audience)
values
  (
    'r619-onboarding-v1',
    'onboarding',
    'Recruit 619 / Tage onboarding',
    'From TAGE Global Onboarding Checklist (Signent source). Company/owner labels ignored; steps + timing adapted for Recruit 619. Signent-specific tooling marked optional.',
    'TAGE Global - Onboarding Checklist - Signent.docx',
    'recruit619'
  ),
  (
    'r619-offboarding-v1',
    'offboarding',
    'Recruit 619 / Tage offboarding (revoke-first)',
    'Derived reverse of onboarding access/equipment plus audit protections. Destructive access revoke requires human confirmation.',
    'Derived + audit-offboarding-v2',
    'recruit619'
  )
on conflict (slug) do update set
  title = excluded.title,
  description = excluded.description,
  source_doc = excluded.source_doc,
  audience = excluded.audience,
  active = true,
  updated_at = now();

-- Clean re-seed template steps for these slugs
delete from public.os_hris_process_template_steps ts
using public.os_hris_process_templates t
where ts.template_id = t.id
  and t.slug in ('r619-onboarding-v1', 'r619-offboarding-v1');

insert into public.os_hris_process_template_steps
  (template_id, step_key, title, category, sort_order, owner_role,
   timing_anchor, offset_days, evidence_required, automation, destructive,
   optional_for_audience, system_hook)
select t.id, v.step_key, v.title, v.category, v.sort_order, v.owner_role,
       v.timing_anchor, v.offset_days, v.evidence_required, v.automation,
       v.destructive, v.optional_for_audience, v.system_hook
from public.os_hris_process_templates t
cross join (values
  -- Pre-Employment (-14 .. -7)
  ('pre.verify_resume', 'Verify application or resume', 'Pre-Employment', 10, 'Hiring Manager', 'offer_accepted', 0, false, 'manual', false, false, 'manual'),
  ('pre.offer_details', 'Provide HR offer details (name, emails, phone, resume, position, start date, salary, comp plan)', 'Pre-Employment', 20, 'Hiring Manager', 'offer_accepted', 1, true, 'manual', false, false, 'manual'),
  ('pre.offer_letter', 'Create and send offer letter & NDA if needed (copy manager)', 'Pre-Employment', 30, 'Human Resources', 'offer_accepted', 2, true, 'assist', false, false, 'employment_contract'),
  ('pre.personnel_file', 'Confirm documents & create personnel file', 'Pre-Employment', 40, 'Human Resources', 'start_date', -14, true, 'manual', false, false, 'manual'),
  ('pre.file_resume', 'File resume in personnel file', 'Pre-Employment', 50, 'Human Resources', 'start_date', -14, true, 'manual', false, false, 'manual'),
  ('pre.file_offer', 'File signed offer letter / NDA', 'Pre-Employment', 60, 'Human Resources', 'start_date', -12, true, 'manual', false, false, 'employment_contract'),
  ('pre.emp_verify', 'Begin employment verification with authorization', 'Pre-Employment', 70, 'Human Resources', 'start_date', -10, true, 'assist', false, false, 'compliance_ack'),
  ('pre.bg_check', 'Begin background check with authorization', 'Pre-Employment', 80, 'Human Resources', 'start_date', -10, true, 'assist', false, false, 'compliance_ack'),
  ('pre.calendar', 'Add start date to calendar (copy manager & leadership)', 'Pre-Employment', 90, 'Human Resources', 'start_date', -7, false, 'manual', false, false, 'manual'),
  -- Before Start Date (-7 .. -1)
  ('bs.announce', 'Send internal team announcement', 'Before Start Date', 100, 'Hiring Manager', 'start_date', -7, false, 'manual', false, false, 'manual'),
  ('bs.computer_avail', 'Confirm computer / equipment availability', 'Before Start Date', 110, 'IT', 'start_date', -7, false, 'assist', false, false, 'asset_audit'),
  ('bs.order_computer', 'Order computer if necessary', 'Before Start Date', 120, 'IT', 'start_date', -6, false, 'assist', false, true, 'asset_audit'),
  ('bs.assign_equipment', 'Assign and tag equipment', 'Before Start Date', 130, 'IT', 'start_date', -5, true, 'assist', false, false, 'asset_audit'),
  ('bs.computer_setup', 'Computer cleaned / set up / updated', 'Before Start Date', 140, 'IT', 'start_date', -4, false, 'assist', false, false, 'it_provision'),
  ('bs.notify_it', 'Notify IT for laptop provisioning & user setup', 'Before Start Date', 150, 'IT', 'start_date', -5, false, 'assist', false, false, 'it_provision'),
  ('bs.ms_email', 'Create Microsoft email / portal identity', 'Before Start Date', 160, 'IT', 'start_date', -4, true, 'assist', false, false, 'it_provision'),
  ('bs.apps_install', 'Install core apps (Chrome, Teams, Outlook, Word, phone softphone)', 'Before Start Date', 170, 'IT', 'start_date', -3, false, 'assist', false, true, 'it_provision'),
  ('bs.ringcentral', 'Create RingCentral account and extension (if used)', 'Before Start Date', 180, 'IT', 'start_date', -3, false, 'assist', false, true, 'it_provision'),
  ('bs.salesforce', 'Create Salesforce account and connect phone (if used)', 'Before Start Date', 190, 'IT', 'start_date', -3, false, 'assist', false, true, 'it_provision'),
  ('bs.training_sched', 'Create training schedule', 'Before Start Date', 200, 'Hiring Manager', 'start_date', -5, false, 'manual', false, false, 'manual'),
  ('bs.live_training', 'Schedule all live training sessions', 'Before Start Date', 210, 'Hiring Manager', 'start_date', -4, false, 'manual', false, false, 'manual'),
  ('bs.welcome_lunch', 'Schedule welcome lunch (start date or after)', 'Before Start Date', 220, 'Hiring Manager', 'start_date', -3, false, 'manual', false, false, 'manual'),
  ('bs.welcome_email', 'Send welcome email with first day/week details (copy HR)', 'Before Start Date', 230, 'Hiring Manager', 'start_date', -2, false, 'manual', false, false, 'manual'),
  ('bs.hris_enter', 'Enter employee into HRIS (this record)', 'Before Start Date', 240, 'Human Resources', 'start_date', -7, true, 'auto', false, false, 'manual'),
  ('bs.hris_invite', 'Email HRIS / portal invite to new hire', 'Before Start Date', 250, 'Human Resources', 'start_date', -3, false, 'assist', false, false, 'manual'),
  ('bs.hris_training', 'Assign HRIS / systems training', 'Before Start Date', 260, 'Human Resources', 'start_date', -2, false, 'manual', false, false, 'manual'),
  -- Start Date (0) + 30/60/90
  ('sd.i9', 'Complete Form I-9 via HRIS', 'Start Date', 270, 'Human Resources', 'start_date', 0, true, 'assist', false, false, 'i9'),
  ('sd.i9_ids', 'Collect copy of ID documents for I-9', 'Start Date', 280, 'Human Resources', 'start_date', 0, true, 'manual', false, false, 'i9'),
  ('sd.direct_deposit', 'Ensure employee completed direct deposit & tax setup', 'Start Date', 290, 'Human Resources', 'start_date', 0, true, 'assist', false, false, 'payroll'),
  ('sd.benefits', 'Send benefit guide & enrollment application', 'Start Date', 300, 'Human Resources', 'start_date', 0, true, 'assist', false, false, 'benefits'),
  ('sd.handbook', 'Send employee handbook', 'Start Date', 310, 'Human Resources', 'start_date', 0, true, 'assist', false, false, 'handbook_ack'),
  ('sd.review_computer', 'Review computer setup with new hire', 'Start Date', 320, 'IT', 'start_date', 0, false, 'manual', false, false, 'it_provision'),
  ('sd.review_zoom', 'Review Zoom / meeting tools', 'Start Date', 330, 'IT', 'start_date', 0, false, 'manual', false, true, 'manual'),
  ('sd.company_overview', 'Company overview briefing', 'Start Date', 340, 'Hiring Manager', 'start_date', 0, false, 'manual', false, false, 'manual'),
  ('sd.org_chart', 'Review org chart', 'Start Date', 350, 'Hiring Manager', 'start_date', 0, false, 'manual', false, false, 'manual'),
  ('sd.training_walkthrough', 'Walk through new hire training schedule', 'Start Date', 360, 'Hiring Manager', 'start_date', 0, false, 'manual', false, false, 'manual'),
  ('sd.calendars', 'Set up calendars', 'Start Date', 370, 'Hiring Manager', 'start_date', 0, false, 'manual', false, false, 'manual'),
  ('sd.email_sig', 'Configure email signature & Teams background', 'Start Date', 380, 'IT', 'start_date', 0, false, 'assist', false, false, 'manual'),
  ('sd.distro', 'Add to location calendar / distribution lists', 'Start Date', 390, 'IT', 'start_date', 0, false, 'assist', false, false, 'manual'),
  ('sd.meetings', 'Send company meeting invites', 'Start Date', 400, 'Hiring Manager', 'start_date', 0, false, 'manual', false, false, 'manual'),
  ('sd.bonus_sheet', 'Add to bonus / commission tracking (if applicable)', 'Start Date', 410, 'Finance', 'start_date', 1, false, 'assist', false, true, 'payroll'),
  ('sd.checkins', 'Schedule 30 / 60 / 90-day check-ins', 'Start Date', 420, 'Hiring Manager', 'start_date', 0, false, 'manual', false, false, 'manual'),
  ('sd.payroll_reimb', 'Notify HR of any monthly payroll reimbursements', 'Start Date', 430, 'Hiring Manager', 'start_date', 1, false, 'manual', false, false, 'payroll'),
  ('ck.30', '30-day check-in completed', 'Check-ins', 440, 'Hiring Manager', 'start_date', 30, true, 'manual', false, false, 'manual'),
  ('ck.60', '60-day check-in completed', 'Check-ins', 450, 'Hiring Manager', 'start_date', 60, true, 'manual', false, false, 'manual'),
  ('ck.90', '90-day check-in completed', 'Check-ins', 460, 'Hiring Manager', 'start_date', 90, true, 'manual', false, false, 'manual'),
  -- Before First Payroll
  ('pay.benefits_confirm', 'Confirm all benefit / 401k deductions & earnings', 'Before First Payroll', 470, 'Human Resources', 'start_date', 7, true, 'assist', false, false, 'benefits')
) as v(step_key, title, category, sort_order, owner_role, timing_anchor, offset_days,
       evidence_required, automation, destructive, optional_for_audience, system_hook)
where t.slug = 'r619-onboarding-v1';

insert into public.os_hris_process_template_steps
  (template_id, step_key, title, category, sort_order, owner_role,
   timing_anchor, offset_days, evidence_required, automation, destructive,
   optional_for_audience, system_hook)
select t.id, v.step_key, v.title, v.category, v.sort_order, v.owner_role,
       v.timing_anchor, v.offset_days, v.evidence_required, v.automation,
       v.destructive, v.optional_for_audience, v.system_hook
from public.os_hris_process_templates t
cross join (values
  -- Revoke-first access
  ('off.last_day', 'Confirm last day and transition owner', 'Exit', 10, 'Human Resources', 'end_date', -7, true, 'manual', false, false, 'manual'),
  ('off.exit_docs', 'Apply dismissal / exit documentation rules', 'Compliance', 20, 'Human Resources', 'end_date', -5, true, 'manual', false, false, 'compliance_ack'),
  ('off.sep_agreement', 'Prepare separation agreement when used', 'Compliance', 30, 'Human Resources', 'end_date', -3, false, 'assist', false, true, 'compliance_ack'),
  ('off.portal_revoke', 'Revoke portal access (human confirm)', 'Access revoke', 40, 'IT', 'end_date', 0, true, 'assist', true, false, 'portal_revoke'),
  ('off.messaging_revoke', 'Revoke messaging access (human confirm)', 'Access revoke', 50, 'IT', 'end_date', 0, true, 'assist', true, false, 'messaging_revoke'),
  ('off.ticketing_revoke', 'Revoke ticketing access (human confirm)', 'Access revoke', 60, 'IT', 'end_date', 0, true, 'assist', true, false, 'ticketing_revoke'),
  ('off.sso_revoke', 'Revoke SSO, email, and app access (human confirm)', 'Access revoke', 70, 'IT', 'end_date', 0, true, 'assist', true, false, 'access_revoke'),
  ('off.recover_equipment', 'Recover and audit technology assets', 'Equipment', 80, 'IT', 'end_date', 1, true, 'assist', false, false, 'asset_audit'),
  ('off.badges', 'Collect badges / keys / facilities access', 'Facilities', 90, 'Ops', 'end_date', 1, true, 'manual', false, false, 'manual'),
  ('off.knowledge', 'Knowledge / handoff complete', 'Handoff', 100, 'Hiring Manager', 'end_date', -2, true, 'manual', false, false, 'knowledge_handoff'),
  ('off.final_pay', 'Final pay / commission checkpoint', 'Payroll', 110, 'Finance', 'end_date', 3, true, 'assist', false, false, 'payroll'),
  ('off.benefits_end', 'End benefits / COBRA / portability notice', 'Benefits', 120, 'Human Resources', 'end_date', 3, true, 'assist', false, false, 'benefits'),
  ('off.exit_interview', 'Exit interview / offboarding docs filed', 'Exit', 130, 'Human Resources', 'end_date', 5, true, 'manual', false, false, 'exit_interview'),
  ('off.signoff', 'HR + manager sign-off with evidence pack', 'Exit', 140, 'Human Resources', 'end_date', 7, true, 'manual', false, false, 'manual')
) as v(step_key, title, category, sort_order, owner_role, timing_anchor, offset_days,
       evidence_required, automation, destructive, optional_for_audience, system_hook)
where t.slug = 'r619-offboarding-v1';

-- ---------------------------------------------------------------------------
-- Seed Dennis (idempotent) + onboarding run
-- Start date = next Monday from today (or today if Monday)
-- ---------------------------------------------------------------------------
do $$
declare
  v_start date;
  v_emp_id uuid;
  v_tmpl_id uuid;
  v_run_id uuid;
  v_offer date;
  v_pct numeric;
  r record;
begin
  v_start := current_date + ((8 - extract(dow from current_date)::int) % 7);
  if extract(dow from current_date)::int = 1 then
    v_start := current_date;
  end if;
  v_offer := v_start - 14;

  insert into public.os_hris_employees (
    employee_key, full_name, work_email, personal_email, phone,
    entity_id, role_title, department, location, manager_name,
    status, start_date, offer_accepted_at,
    onboarding_status, recruit_assignment, notes
  ) values (
    'dennis-vp-recruiting-r619',
    'Dennis McCall',
    'dennismccall@recruit619.com',
    '',
    '',
    'ENT-R619',
    'VP of Recruiting',
    'Recruiting',
    'Remote',
    '',
    'onboarding',
    v_start,
    v_offer,
    'in_progress',
    jsonb_build_object(
      'portal_hint', 'https://portal.recruit619.com',
      'status', 'pending_link',
      'linked_at', null,
      'entity_id', 'ENT-R619',
      'note', 'Additive Recruit 619 assignment stub — link portal user when provisioned'
    ),
    'First live HRIS test case. Ignore mismatched company/owner labels on source onboarding docs.'
  )
  on conflict (employee_key) do update set
    full_name = excluded.full_name,
    work_email = excluded.work_email,
    entity_id = excluded.entity_id,
    role_title = excluded.role_title,
    department = excluded.department,
    status = excluded.status,
    start_date = coalesce(public.os_hris_employees.start_date, excluded.start_date),
    offer_accepted_at = coalesce(public.os_hris_employees.offer_accepted_at, excluded.offer_accepted_at),
    onboarding_status = case
      when public.os_hris_employees.onboarding_status = 'complete' then 'complete'
      else 'in_progress'
    end,
    recruit_assignment = excluded.recruit_assignment,
    notes = excluded.notes,
    updated_at = now()
  returning id into v_emp_id;

  select id into v_tmpl_id from public.os_hris_process_templates
  where slug = 'r619-onboarding-v1';

  if v_emp_id is null or v_tmpl_id is null then
    raise exception 'Dennis seed missing employee or template';
  end if;

  -- Prefer existing open onboarding run
  select id into v_run_id
  from public.os_hris_process_runs
  where employee_id = v_emp_id and kind = 'onboarding'
    and status in ('open', 'in_progress', 'blocked')
  order by created_at desc
  limit 1;

  if v_run_id is null then
    insert into public.os_hris_process_runs (
      run_key, employee_id, template_id, kind, status,
      offer_accepted_at, start_date, notes
    ) values (
      'ONB-dennis-r619-v1',
      v_emp_id,
      v_tmpl_id,
      'onboarding',
      'in_progress',
      coalesce((select offer_accepted_at from public.os_hris_employees where id = v_emp_id), v_offer),
      coalesce((select start_date from public.os_hris_employees where id = v_emp_id), v_start),
      'Seeded Dennis onboarding run from r619-onboarding-v1'
    )
    on conflict (run_key) do update set
      status = case
        when public.os_hris_process_runs.status = 'complete' then 'complete'
        else 'in_progress'
      end,
      start_date = coalesce(public.os_hris_process_runs.start_date, excluded.start_date),
      offer_accepted_at = coalesce(public.os_hris_process_runs.offer_accepted_at, excluded.offer_accepted_at),
      updated_at = now()
    returning id into v_run_id;
  end if;

  if v_run_id is null then
    select id into v_run_id from public.os_hris_process_runs
    where run_key = 'ONB-dennis-r619-v1';
  end if;

  for r in
    select ts.*,
      case ts.timing_anchor
        when 'offer_accepted' then
          coalesce(
            (select offer_accepted_at from public.os_hris_process_runs where id = v_run_id),
            v_offer
          ) + ts.offset_days
        when 'end_date' then
          coalesce(
            (select end_date from public.os_hris_process_runs where id = v_run_id),
            v_start
          ) + ts.offset_days
        else
          coalesce(
            (select start_date from public.os_hris_process_runs where id = v_run_id),
            v_start
          ) + ts.offset_days
      end as due_calc
    from public.os_hris_process_template_steps ts
    where ts.template_id = v_tmpl_id
    order by ts.sort_order
  loop
    insert into public.os_hris_process_steps (
      run_id, template_step_id, step_key, title, category, sort_order,
      owner_role, timing_anchor, offset_days, due_at, status,
      evidence_required, automation, destructive, optional_for_audience, system_hook
    ) values (
      v_run_id, r.id, r.step_key, r.title, r.category, r.sort_order,
      r.owner_role, r.timing_anchor, r.offset_days, r.due_calc,
      case when r.step_key = 'bs.hris_enter' then 'done' else 'pending' end,
      r.evidence_required, r.automation, r.destructive, r.optional_for_audience, r.system_hook
    )
    on conflict (run_id, step_key) do update set
      title = excluded.title,
      category = excluded.category,
      sort_order = excluded.sort_order,
      owner_role = excluded.owner_role,
      due_at = coalesce(public.os_hris_process_steps.due_at, excluded.due_at),
      evidence_required = excluded.evidence_required,
      automation = excluded.automation,
      destructive = excluded.destructive,
      optional_for_audience = excluded.optional_for_audience,
      system_hook = excluded.system_hook,
      updated_at = now();
  end loop;

  select round(
    100.0 * count(*) filter (where status in ('done', 'waived', 'na'))
    / nullif(count(*), 0), 1
  ) into v_pct
  from public.os_hris_process_steps where run_id = v_run_id;

  update public.os_hris_process_runs
  set completion_pct = coalesce(v_pct, 0), updated_at = now()
  where id = v_run_id;

  update public.os_hris_employees
  set onboarding_pct = coalesce(v_pct, 0),
      onboarding_status = 'in_progress',
      updated_at = now()
  where id = v_emp_id;

  insert into public.os_hris_employee_events (employee_id, event_kind, summary, detail)
  select v_emp_id, 'created', 'Dennis HRIS employee seeded for Recruit 619',
    jsonb_build_object('run_key', 'ONB-dennis-r619-v1', 'start_date', v_start)
  where not exists (
    select 1 from public.os_hris_employee_events
    where employee_id = v_emp_id and event_kind = 'created'
      and summary like 'Dennis HRIS%'
  );

  insert into public.os_hris_employee_events (employee_id, event_kind, summary, detail)
  select v_emp_id, 'run_started', 'Onboarding run started from r619-onboarding-v1',
    jsonb_build_object('run_id', v_run_id)
  where not exists (
    select 1 from public.os_hris_employee_events
    where employee_id = v_emp_id and event_kind = 'run_started'
  );
end $$;
