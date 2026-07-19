-- HR talent acquisition + Signent/TAGE onboarding checklist templates
-- Source: docs/hr/TAGE Global - Onboarding Checklist - Signent.docx (+ designed talent-acquisition steps)
-- Run on project hqmobgtnedmhzipusert after 0034_finance_close_periods.sql

-- ---------------------------------------------------------------------------
-- Default new hires / candidates start as Prospect
-- ---------------------------------------------------------------------------
alter table public.hr_employees
  alter column employment_status set default 'prospect';

-- ---------------------------------------------------------------------------
-- Extend checklist kinds: talent_acquisition | onboarding | offboarding
-- ---------------------------------------------------------------------------
alter table public.hr_onboarding_checklists
  drop constraint if exists hr_onboarding_checklists_kind_check;

alter table public.hr_onboarding_checklists
  add constraint hr_onboarding_checklists_kind_check
  check (kind in ('talent_acquisition', 'onboarding', 'offboarding'));

-- ---------------------------------------------------------------------------
-- Template catalog (seed source of truth for new checklist instances)
-- ---------------------------------------------------------------------------
create table if not exists public.hr_checklist_templates (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  kind          text not null
                  check (kind in ('talent_acquisition', 'onboarding', 'offboarding')),
  title         text not null,
  description   text not null default '',
  source_doc    text not null default '',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.hr_checklist_template_items (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid not null references public.hr_checklist_templates (id) on delete cascade,
  title           text not null,
  category        text not null default 'General',
  sort_order      int not null default 100,
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
                        'manual',
                        'i9',
                        'handbook_ack',
                        'employment_contract',
                        'privacy_consent',
                        'job_description',
                        'compliance_ack'
                      )
                    ),
  assignee_hint   text not null default '',
  -- parent = Tage-wide; signent = Signent-specific tooling/roles; both = shared step
  scope           text not null default 'parent'
                    check (scope in ('parent', 'signent', 'both')),
  notes           text not null default '',
  created_at      timestamptz not null default now()
);

create index if not exists hr_checklist_template_items_template_idx
  on public.hr_checklist_template_items (template_id, sort_order);

alter table public.hr_checklist_templates enable row level security;
alter table public.hr_checklist_template_items enable row level security;

drop policy if exists "HR users read checklist templates" on public.hr_checklist_templates;
create policy "HR users read checklist templates"
  on public.hr_checklist_templates for select
  using (public.is_active_sales_user() and public.user_has_portal('human-resources'));

drop policy if exists "HR admins manage checklist templates" on public.hr_checklist_templates;
create policy "HR admins manage checklist templates"
  on public.hr_checklist_templates for all
  using (public.is_active_sales_user() and public.user_has_portal('human-resources'))
  with check (public.is_active_sales_user() and public.user_has_portal('human-resources'));

drop policy if exists "HR users read checklist template items" on public.hr_checklist_template_items;
create policy "HR users read checklist template items"
  on public.hr_checklist_template_items for select
  using (public.is_active_sales_user() and public.user_has_portal('human-resources'));

drop policy if exists "HR admins manage checklist template items" on public.hr_checklist_template_items;
create policy "HR admins manage checklist template items"
  on public.hr_checklist_template_items for all
  using (public.is_active_sales_user() and public.user_has_portal('human-resources'))
  with check (public.is_active_sales_user() and public.user_has_portal('human-resources'));

create or replace function public.set_hr_checklist_templates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists hr_checklist_templates_updated_at on public.hr_checklist_templates;
create trigger hr_checklist_templates_updated_at
  before update on public.hr_checklist_templates
  for each row execute function public.set_hr_checklist_templates_updated_at();

-- Optional scope note on instance items (copied from template when started)
alter table public.hr_checklist_items
  add column if not exists scope text not null default 'parent';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hr_checklist_items_scope_check'
  ) then
    alter table public.hr_checklist_items
      add constraint hr_checklist_items_scope_check
      check (scope in ('parent', 'signent', 'both'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Seed templates (idempotent by slug)
-- ---------------------------------------------------------------------------
insert into public.hr_checklist_templates (slug, kind, title, description, source_doc)
values
  (
    'talent-acquisition-v1',
    'talent_acquisition',
    'Talent acquisition',
    'Standard recruiting pipeline through offer accepted. Advance the prospect to onboarding when the final offer step is done.',
    'Designed standard recruiting steps (not fully covered as pipeline in Signent onboarding doc)'
  ),
  (
    'signent-onboarding-v1',
    'onboarding',
    'TAGE / Signent onboarding',
    'From TAGE Global Onboarding Checklist — Signent. Includes Pre-Employment through Before First Payroll. Mark Signent-scoped items N/A for parent-only hires when not applicable.',
    'TAGE Global - Onboarding Checklist - Signent.docx'
  ),
  (
    'audit-offboarding-v2',
    'offboarding',
    'Offboarding',
    'Audit-aligned exit checklist (access revoke, assets, payroll/benefits close).',
    'HR foundation + compliance audit hooks'
  )
on conflict (slug) do update set
  title = excluded.title,
  description = excluded.description,
  source_doc = excluded.source_doc,
  kind = excluded.kind,
  active = true,
  updated_at = now();

-- Replace items for these templates (clean re-seed)
delete from public.hr_checklist_template_items ti
using public.hr_checklist_templates t
where ti.template_id = t.id
  and t.slug in ('talent-acquisition-v1', 'signent-onboarding-v1', 'audit-offboarding-v2');


insert into public.hr_checklist_template_items
  (template_id, title, category, sort_order, system_hook, assignee_hint, scope)
select t.id, v.title, v.category, v.sort_order, v.system_hook::text, v.assignee_hint, v.scope
from public.hr_checklist_templates t
cross join (values
  ('Screen resume / application', 'Sourcing', 10, 'manual', 'Hiring Manager / Recruiter', 'parent'),
  ('Complete phone screen', 'Interview', 20, 'manual', 'Hiring Manager / Recruiter', 'parent'),
  ('Hiring manager interview(s)', 'Interview', 30, 'manual', 'Hiring Manager', 'parent'),
  ('Additional / panel interviews', 'Interview', 40, 'manual', 'Hiring Manager', 'parent'),
  ('Complete reference checks', 'Diligence', 50, 'manual', 'Hiring Manager / HR', 'parent'),
  ('Background check authorization & run', 'Diligence', 60, 'compliance_ack', 'Human Resources', 'parent'),
  ('Prepare and send offer letter (and NDA if needed)', 'Offer', 70, 'employment_contract', 'Human Resources', 'parent'),
  ('Offer accepted — ready to advance to onboarding', 'Offer', 80, 'manual', 'Human Resources', 'parent')
) as v(title, category, sort_order, system_hook, assignee_hint, scope)
where t.slug = 'talent-acquisition-v1';


insert into public.hr_checklist_template_items
  (template_id, title, category, sort_order, system_hook, assignee_hint, scope)
select t.id, v.title, v.category, v.sort_order, v.system_hook::text, v.assignee_hint, v.scope
from public.hr_checklist_templates t
cross join (values
  ('Verify application or resume', 'Pre-Employment', 10, 'manual', 'Hiring Manager', 'parent'),
  ('Provide HR offer details upon selection (name, personal email, phone, resume, position, start date, salary, comp plan)', 'Pre-Employment', 20, 'manual', 'Hiring Manager', 'parent'),
  ('Create and send offer letter & NDA if needed (copy manager)', 'Pre-Employment', 30, 'employment_contract', 'Human Resources', 'parent'),
  ('Confirm documents & create personnel file', 'Pre-Employment', 40, 'manual', 'Human Resources', 'parent'),
  ('File resume in personnel file', 'Pre-Employment', 50, 'manual', 'Human Resources', 'parent'),
  ('File signed offer letter / NDA', 'Pre-Employment', 60, 'employment_contract', 'Human Resources', 'parent'),
  ('Begin employment verification with authorization', 'Pre-Employment', 70, 'compliance_ack', 'Human Resources', 'parent'),
  ('Begin background check with authorization', 'Pre-Employment', 80, 'compliance_ack', 'Human Resources', 'parent'),
  ('Add start date to calendar (copy manager & CEO)', 'Pre-Employment', 90, 'manual', 'Human Resources', 'both'),
  ('Send internal team announcement', 'Before Start Date', 100, 'manual', 'CEO', 'signent'),
  ('Confirm computer availability', 'Before Start Date', 110, 'asset_audit', 'CEO', 'signent'),
  ('Order computer if necessary', 'Before Start Date', 120, 'asset_audit', 'CEO', 'signent'),
  ('Assign and tag equipment', 'Before Start Date', 130, 'asset_audit', 'CEO', 'signent'),
  ('Computer cleaned / set up / updated', 'Before Start Date', 140, 'it_provision', 'CEO', 'signent'),
  ('Notify IT for laptop provisioning & user setup', 'Before Start Date', 150, 'it_provision', 'CEO', 'both'),
  ('Create Microsoft email', 'Before Start Date', 160, 'it_provision', 'CEO', 'both'),
  ('Download Chrome, RingCentral, Teams, Outlook, Word', 'Before Start Date', 170, 'it_provision', 'CEO', 'signent'),
  ('Create RingCentral account and add extension (Chrome)', 'Before Start Date', 180, 'it_provision', 'Director of Operations Support', 'signent'),
  ('Create Salesforce account and connect to RingCentral', 'Before Start Date', 190, 'it_provision', 'CEO', 'signent'),
  ('Create training schedule', 'Before Start Date', 200, 'manual', 'Hiring Manager', 'parent'),
  ('Schedule all live training sessions', 'Before Start Date', 210, 'manual', 'Hiring Manager', 'parent'),
  ('Schedule welcome lunch (start date or after)', 'Before Start Date', 220, 'manual', 'Hiring Manager', 'parent'),
  ('Send welcome email with first day/week details (copy CEO & HR)', 'Before Start Date', 230, 'manual', 'Hiring Manager', 'both'),
  ('Enter employee into HRIS', 'Before Start Date', 240, 'manual', 'Human Resources', 'parent'),
  ('Email HRIS invite to new hire', 'Before Start Date', 250, 'manual', 'Human Resources', 'parent'),
  ('Assign HRIS training', 'Before Start Date', 260, 'manual', 'Human Resources', 'parent'),
  ('Complete Form I-9 via HRIS', 'Start Date', 270, 'i9', 'Human Resources', 'parent'),
  ('Collect copy of ID documents for I-9', 'Start Date', 280, 'i9', 'Human Resources', 'parent'),
  ('Ensure employee completed direct deposit & tax setup', 'Start Date', 290, 'payroll', 'Human Resources', 'parent'),
  ('Send benefit guide & enrollment application', 'Start Date', 300, 'benefits', 'Human Resources', 'parent'),
  ('Send employee handbook', 'Start Date', 310, 'handbook_ack', 'Human Resources', 'parent'),
  ('Review computer setup', 'Start Date', 320, 'it_provision', 'CEO', 'signent'),
  ('Review Zoom', 'Start Date', 330, 'manual', 'CEO', 'signent'),
  ('Company overview briefing', 'Start Date', 340, 'manual', 'CEO', 'both'),
  ('Review org chart', 'Start Date', 350, 'manual', 'CEO', 'parent'),
  ('Walk through new hire training schedule', 'Start Date', 360, 'manual', 'CEO / Hiring Manager', 'parent'),
  ('Set up calendars', 'Start Date', 370, 'manual', 'CEO / Hiring Manager', 'parent'),
  ('Configure email signature & Teams background', 'Start Date', 380, 'manual', 'CEO / Hiring Manager', 'both'),
  ('Add to location calendar / distribution email', 'Start Date', 390, 'manual', 'CEO', 'both'),
  ('Send all company meeting invites', 'Start Date', 400, 'manual', 'CEO', 'both'),
  ('Add to quarterly bonus calc spreadsheet', 'Start Date', 410, 'payroll', 'CEO', 'signent'),
  ('Schedule 30 / 60 / 90-day check-ins', 'Start Date', 420, 'manual', 'Hiring Manager', 'parent'),
  ('Notify HR of any monthly payroll reimbursements', 'Start Date', 430, 'payroll', 'CEO / Hiring Manager', 'parent'),
  ('Confirm all benefit / 401k deductions & earnings', 'Before First Payroll', 440, 'benefits', 'Human Resources', 'parent')
) as v(title, category, sort_order, system_hook, assignee_hint, scope)
where t.slug = 'signent-onboarding-v1';


insert into public.hr_checklist_template_items
  (template_id, title, category, sort_order, system_hook, assignee_hint, scope)
select t.id, v.title, v.category, v.sort_order, v.system_hook::text, v.assignee_hint, v.scope
from public.hr_checklist_templates t
cross join (values
  ('Confirm last day and transition owner', 'Exit', 10, 'manual', 'HR / Manager', 'parent'),
  ('Apply rules for dismissal / exit documentation', 'Compliance', 15, 'compliance_ack', 'HR / Legal', 'parent'),
  ('Prepare separation / termination agreement (when used)', 'Compliance', 16, 'compliance_ack', 'HR / Legal', 'parent'),
  ('Disable payroll / final pay (timing checklist)', 'Payroll', 20, 'payroll', 'HR / Finance', 'parent'),
  ('End benefits COBRA / portability notice', 'Benefits', 30, 'benefits', 'HR', 'parent'),
  ('Revoke SSO, email, and app access', 'Technology', 40, 'access_revoke', 'IT', 'parent'),
  ('Recover and audit technology assets', 'Technology', 50, 'asset_audit', 'IT', 'parent'),
  ('Collect badges / keys / facilities access', 'Facilities', 60, 'manual', 'Ops', 'parent'),
  ('File offboarding process record + exit interview', 'Exit', 70, 'manual', 'HR / Manager', 'parent')
) as v(title, category, sort_order, system_hook, assignee_hint, scope)
where t.slug = 'audit-offboarding-v2';


-- ---------------------------------------------------------------------------
-- Portal copy
-- ---------------------------------------------------------------------------
update public.sales_portals
set description =
  'Shared HR: prospects → talent acquisition → onboarding → employee files, plus company compliance (parent + portfolio).'
where slug = 'human-resources';
