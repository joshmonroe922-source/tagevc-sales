-- Technology plan & audit matrix (parent + subsidiaries)
-- Source: docs/technology/Technology Plan and Audit.docx
-- Run after 0028 on project hqmobgtnedmhzipusert (Marketing may own 0028)

-- ---------------------------------------------------------------------------
-- Templates (catalog) — used for seed + auto-provision on new ops_entities
-- ---------------------------------------------------------------------------
create table if not exists public.technology_control_templates (
  control_key          text primary key,
  title                text not null,
  description          text not null default '',
  area                 text not null default 'General',
  document_kind        text not null default 'RECORDS'
                         check (document_kind in ('POLICY', 'RECORDS')),
  evidence_expectation text not null default '',
  source               text not null default 'audit'
                         check (source in ('audit', 'recommended', 'manual')),
  cadence              text not null default 'annual'
                         check (cadence in ('annual', 'monthly', 'quarterly', 'one_time', 'custom')),
  owner_role           text not null default 'Technology',
  applies_to_parent    boolean not null default true,
  applies_to_entities  boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create or replace function public.set_technology_control_templates_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists technology_control_templates_updated_at on public.technology_control_templates;
create trigger technology_control_templates_updated_at
  before update on public.technology_control_templates
  for each row execute function public.set_technology_control_templates_updated_at();

-- ---------------------------------------------------------------------------
-- Controls (matrix rows): entity_id null = parent company
-- ---------------------------------------------------------------------------
create table if not exists public.technology_controls (
  id                   uuid primary key default gen_random_uuid(),
  entity_id            uuid references public.ops_entities (id) on delete cascade,
  control_key          text not null default '',
  title                text not null,
  description          text not null default '',
  area                 text not null default 'General',
  document_kind        text not null default 'RECORDS'
                         check (document_kind in ('POLICY', 'RECORDS')),
  evidence_expectation text not null default '',
  source               text not null default 'manual'
                         check (source in ('audit', 'recommended', 'manual')),
  applies_to_parent    boolean not null default true,
  applies_to_entities  boolean not null default true,
  cadence              text not null default 'annual'
                         check (cadence in ('annual', 'monthly', 'quarterly', 'one_time', 'custom')),
  owner_role           text not null default 'Technology',
  next_due_at          date,
  last_reviewed_at     date,
  status               text not null default 'open'
                         check (status in ('open', 'in_progress', 'compliant', 'gap', 'na')),
  evidence_url         text not null default '',
  evidence_notes       text not null default '',
  notes                text not null default '',
  active               boolean not null default true,
  created_by           uuid references public.sales_users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists technology_controls_key_scope_uidx
  on public.technology_controls (control_key, coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where control_key <> '' and active = true;

create index if not exists technology_controls_area_idx
  on public.technology_controls (area)
  where active = true;

create index if not exists technology_controls_status_idx
  on public.technology_controls (status)
  where active = true;

create index if not exists technology_controls_entity_idx
  on public.technology_controls (entity_id)
  where active = true;

create or replace function public.set_technology_controls_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists technology_controls_updated_at on public.technology_controls;
create trigger technology_controls_updated_at
  before update on public.technology_controls
  for each row execute function public.set_technology_controls_updated_at();

alter table public.technology_controls enable row level security;

drop policy if exists "Technology users manage technology controls" on public.technology_controls;
create policy "Technology users manage technology controls"
  on public.technology_controls for all
  using (public.is_active_sales_user() and public.user_has_portal('technology'))
  with check (public.is_active_sales_user() and public.user_has_portal('technology'));

alter table public.technology_control_templates enable row level security;

drop policy if exists "Technology users read technology templates" on public.technology_control_templates;
create policy "Technology users read technology templates"
  on public.technology_control_templates for select
  using (public.is_active_sales_user() and public.user_has_portal('technology'));

-- ---------------------------------------------------------------------------
-- Technology tasks linked to incomplete controls (optionally mirror to sales_tasks)
-- ---------------------------------------------------------------------------
create table if not exists public.technology_tasks (
  id            uuid primary key default gen_random_uuid(),
  control_id    uuid not null references public.technology_controls (id) on delete cascade,
  sales_task_id uuid references public.sales_tasks (id) on delete set null,
  title         text not null,
  status        text not null default 'open'
                  check (status in ('open', 'done', 'cancelled')),
  assigned_to   uuid references public.sales_users (id) on delete set null,
  due_at        date,
  notes         text not null default '',
  created_by    uuid references public.sales_users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists technology_tasks_open_control_uidx
  on public.technology_tasks (control_id)
  where status = 'open';

create index if not exists technology_tasks_status_idx
  on public.technology_tasks (status, due_at);

create or replace function public.set_technology_tasks_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists technology_tasks_updated_at on public.technology_tasks;
create trigger technology_tasks_updated_at
  before update on public.technology_tasks
  for each row execute function public.set_technology_tasks_updated_at();

alter table public.technology_tasks enable row level security;

drop policy if exists "Technology users manage technology tasks" on public.technology_tasks;
create policy "Technology users manage technology tasks"
  on public.technology_tasks for all
  using (public.is_active_sales_user() and public.user_has_portal('technology'))
  with check (public.is_active_sales_user() and public.user_has_portal('technology'));

-- ---------------------------------------------------------------------------
-- Provision helpers
-- ---------------------------------------------------------------------------
create or replace function public.provision_technology_controls_for_entity(p_entity_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  insert into public.technology_controls (
    entity_id, control_key, title, description, area, document_kind,
    evidence_expectation, source, cadence, owner_role,
    applies_to_parent, applies_to_entities, status, notes
  )
  select
    p_entity_id,
    t.control_key,
    t.title,
    t.description,
    t.area,
    t.document_kind,
    t.evidence_expectation,
    t.source,
    t.cadence,
    t.owner_role,
    t.applies_to_parent,
    t.applies_to_entities,
    'open',
    'Auto-provisioned for new entity from technology control templates'
  from public.technology_control_templates t
  where t.applies_to_entities = true
    and not exists (
      select 1 from public.technology_controls c
      where c.control_key = t.control_key
        and c.entity_id = p_entity_id
        and c.active = true
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

create or replace function public.provision_technology_controls_for_parent()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  insert into public.technology_controls (
    entity_id, control_key, title, description, area, document_kind,
    evidence_expectation, source, cadence, owner_role,
    applies_to_parent, applies_to_entities, status, notes
  )
  select
    null,
    t.control_key,
    t.title,
    t.description,
    t.area,
    t.document_kind,
    t.evidence_expectation,
    t.source,
    t.cadence,
    t.owner_role,
    t.applies_to_parent,
    t.applies_to_entities,
    'open',
    'Seeded from Technology Plan and Audit'
  from public.technology_control_templates t
  where t.applies_to_parent = true
    and not exists (
      select 1 from public.technology_controls c
      where c.control_key = t.control_key
        and c.entity_id is null
        and c.active = true
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

create or replace function public.trg_ops_entities_provision_technology()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('active', 'forming', 'acquired') then
    perform public.provision_technology_controls_for_entity(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists ops_entities_provision_technology on public.ops_entities;
create trigger ops_entities_provision_technology
  after insert on public.ops_entities
  for each row execute function public.trg_ops_entities_provision_technology();

create or replace function public.trg_ops_entities_provision_technology_on_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and new.status in ('active', 'forming', 'acquired')
     and (old.status is null or old.status not in ('active', 'forming', 'acquired')) then
    perform public.provision_technology_controls_for_entity(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists ops_entities_provision_technology_on_status on public.ops_entities;
create trigger ops_entities_provision_technology_on_status
  after update of status on public.ops_entities
  for each row execute function public.trg_ops_entities_provision_technology_on_status();

create or replace function public.create_technology_tasks_for_incomplete(p_created_by uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  insert into public.technology_tasks (control_id, title, status, due_at, notes, created_by)
  select
    c.id,
    'Technology: ' || c.title,
    'open',
    c.next_due_at,
    coalesce(nullif(c.area, ''), 'Technology') || ' · ' || coalesce(nullif(c.control_key, ''), 'control'),
    p_created_by
  from public.technology_controls c
  where c.active = true
    and c.status in ('open', 'in_progress', 'gap')
    and not exists (
      select 1 from public.technology_tasks t
      where t.control_id = c.id and t.status = 'open'
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

grant execute on function public.provision_technology_controls_for_entity(uuid) to authenticated;
grant execute on function public.provision_technology_controls_for_parent() to authenticated;
grant execute on function public.create_technology_tasks_for_incomplete(uuid) to authenticated;

update public.sales_portals
set description = 'Technology plan & audit across parent + subsidiaries (hybrid IT, Suite integrations, security).'
where slug = 'technology';

insert into public.technology_control_templates (control_key, title, description, area, document_kind, evidence_expectation, source, cadence, owner_role, applies_to_parent, applies_to_entities) values
('strat-entity-roadmap','Entity technology roadmap','Develop technology roadmaps aligned with each subsidiary’s business goals (local systems, specific software needs).','Strategy & Governance','RECORDS','Current entity tech roadmap','audit','annual','Technology',true,true),
('strat-entity-ops','Entity day-to-day IT operations','Manage day-to-day IT operations, local vendors, and quick decision-making for entity-specific requirements.','Strategy & Governance','RECORDS','Vendor list + ops runbook','audit','annual','Technology',true,true),
('strat-group-strategy','Group Technology Strategy & 3–5 year roadmap','Create a unified Group Technology Strategy and 3–5 year roadmap supporting digital transformation and portfolio synergies.','Strategy & Governance','POLICY','Approved group strategy + roadmap','audit','annual','Technology',true,false),
('strat-group-governance','IT Governance Framework','Establish IT Governance Framework (policies, standards, decision rights) managed centrally with input from subsidiaries.','Strategy & Governance','POLICY','Governance framework document','audit','annual','Technology',true,false),
('strat-group-steering','Technology Steering Committee / IT Governance Board','Form a Technology Steering Committee or IT Governance Board with representatives from key entities.','Strategy & Governance','RECORDS','Charter + meeting cadence / minutes','audit','quarterly','Technology',true,false),
('strat-group-architecture','Architecture principles','Define architecture principles (cloud-first, security-by-design, data standards).','Strategy & Governance','POLICY','Published architecture principles','audit','annual','Technology',true,false),
('infra-entity-local','Local infrastructure needs','Document and manage local infrastructure (on-prem, connectivity, hybrid setups for regulation/latency).','Infrastructure & Cloud','RECORDS','Entity infra inventory / diagram','audit','annual','Technology',true,true),
('infra-group-cloud','Cloud-first / hybrid cloud strategy','Adopt cloud-first or hybrid cloud strategy (Azure, AWS, GCP) with centralized management.','Infrastructure & Cloud','POLICY','Cloud strategy decision record','audit','annual','Technology',true,false),
('infra-group-shared-services','Shared infrastructure services','Shared identity management (Entra ID), networking, backup, and disaster recovery services.','Infrastructure & Cloud','RECORDS','Shared services catalog + owners','audit','annual','Technology',true,false),
('infra-group-virtualization','Virtualization & containerization standards','Virtualization and containerization standards for scalability.','Infrastructure & Cloud','POLICY','Standards doc / reference architecture','audit','annual','Technology',true,false),
('infra-suite-cloud','Intuit Enterprise Suite cloud capabilities','Leverage Intuit Enterprise Suite’s cloud capabilities as part of core infrastructure.','Infrastructure & Cloud','RECORDS','Suite environment map / access model','audit','annual','Technology / Finance',true,true),
('apps-entity-specific','Subsidiary-specific applications','Select and manage subsidiary-specific applications (CRM, marketing, industry, HR, etc.).','Applications & Systems','RECORDS','Entity application inventory','audit','annual','Technology',true,true),
('apps-entity-customization','Local customization & integration needs','Document local customization and integration needs for entity systems.','Applications & Systems','RECORDS','Customization / integration backlog','audit','annual','Technology',true,true),
('apps-group-suite-erp','Intuit Enterprise Suite as core ERP','Intuit Enterprise Suite as central multi-entity ERP/finance platform for accounting, consolidation, IC, and group reporting.','Applications & Systems','RECORDS','Suite multi-entity config evidence','audit','annual','Technology / Finance',true,true),
('apps-group-shared-enterprise','Shared / recommended enterprise applications','Shared or recommended enterprise applications (centralized CRM, HRIS) with entity views.','Applications & Systems','RECORDS','Enterprise app catalog','audit','annual','Technology',true,false),
('apps-group-portfolio-mgmt','Application portfolio management','Rationalize redundant tools across entities for cost savings.','Applications & Systems','RECORDS','Portfolio review / rationalization log','audit','annual','Technology',true,false),
('apps-group-integration-layer','Integration layer / iPaaS','Middleware, APIs, or iPaaS (Zapier, Boomi, Power Automate) connecting systems and feeding Intuit Suite.','Applications & Systems','RECORDS','Integration architecture + active flows','audit','annual','Technology',true,false),
('apps-group-lowcode','Low-code / no-code platform governance','Low-code/no-code platforms for rapid entity needs while maintaining governance.','Applications & Systems','POLICY','Low-code policy + approved platforms','audit','annual','Technology',true,false),
('data-entity-local','Local data collection & reporting','Local data collection, storage, and basic reporting per subsidiary.','Data & Analytics','RECORDS','Entity reporting pack / data map','audit','quarterly','Technology',true,true),
('data-group-mdm','Centralized data strategy & MDM','Master data management (customers, products, vendors), data governance policies, and quality standards.','Data & Analytics','POLICY','Data strategy / MDM standards','audit','annual','Technology',true,false),
('data-group-warehouse','Data lake / warehouse / analytics platform','Data lake/warehouse or analytics platform for consolidated insights.','Data & Analytics','RECORDS','Platform inventory + access','audit','annual','Technology',true,false),
('data-group-dashboards','Group dashboards (Suite + systems)','Group dashboards/reporting pulling from Intuit Enterprise Suite and other systems.','Data & Analytics','RECORDS','Dashboard catalog / sample exports','audit','monthly','Technology / Finance',true,false),
('data-group-ai-ml','Advanced analytics / AI / ML','Shared predictive analytics, automation, and AI/ML capabilities across the group.','Data & Analytics','RECORDS','AI/ML initiative register','audit','annual','Technology',true,false),
('data-group-privacy-residency','Data privacy & residency compliance','Data privacy and residency compliance across jurisdictions.','Data & Analytics','POLICY','Privacy/residency matrix + controls','audit','annual','Technology / Legal',true,true),
('data-suite-flows','Clean operational data flows into Suite','Ensure clean data flows from operational systems into Intuit Enterprise Suite for consolidation and ROI analysis.','Data & Analytics','RECORDS','Data flow diagram + sample reconciliations','audit','quarterly','Technology / Finance',true,true),
('sec-entity-basic','Basic local security measures','Basic local security measures for the entity office/team.','Cybersecurity','RECORDS','Local security checklist','audit','annual','Technology',true,true),
('sec-entity-local-regs','Entity-specific security regulations','Compliance with entity-specific security/regulatory requirements.','Cybersecurity','RECORDS','Local compliance checklist or counsel note','audit','annual','Technology / Legal',true,true),
('sec-group-zerotrust','Unified Cybersecurity Framework (Zero Trust)','Unified cybersecurity framework with Zero Trust architecture recommended.','Cybersecurity','POLICY','Cybersecurity framework document','audit','annual','Technology',true,false),
('sec-group-central-tools','Centralized security tooling','Endpoint protection, firewall, SIEM, vulnerability management, and threat intelligence.','Cybersecurity','RECORDS','Tool roster + coverage report','audit','quarterly','Technology',true,false),
('sec-group-iam','Identity & Access Management (all entities)','IAM across all entities (centralized identity).','Cybersecurity','RECORDS','IAM architecture + access reviews','audit','quarterly','Technology',true,false),
('sec-group-pen-test-training-ir','Pen test, awareness training & incident response','Regular penetration testing, security awareness training (group-wide), and incident response plan.','Cybersecurity','RECORDS','Latest pen test + training log + IR plan','audit','annual','Technology',true,false),
('sec-group-compliance','Group security compliance (GDPR/CCPA/SOC 2)','Compliance management (GDPR, CCPA, SOC 2, industry standards) with group policies.','Cybersecurity','POLICY','Compliance program evidence pack','audit','annual','Technology / Legal',true,false),
('sec-group-vendor-risk','Vendor risk management (shared tools)','Vendor risk management for shared tools and critical SaaS.','Cybersecurity','RECORDS','Vendor risk register / DPAs','audit','annual','Technology',true,false),
('sec-suite-rbac-audit','Intuit Suite security, RBAC & audit trails','Leverage Suite built-in security, role-based access controls, and audit trails in group security posture.','Cybersecurity','RECORDS','Suite access review + audit trail sample','audit','quarterly','Technology / Finance',true,true),
('euc-entity-local-network','Local network, Wi-Fi & device management','Local network setup, Wi-Fi, and device management for subsidiary offices/teams.','Network & End-User Computing','RECORDS','Site network diagram + device inventory','audit','annual','Technology',true,true),
('euc-group-remote-access','Standardized networking & secure remote access','Standardized networking policies and secure remote access (VPN / Zero Trust Network Access).','Network & End-User Computing','POLICY','Remote access policy + config evidence','audit','annual','Technology',true,false),
('euc-group-mdm','MDM / EDM across entities','Device management (MDM/EDM) for laptops, mobiles, and endpoints across entities.','Network & End-User Computing','RECORDS','MDM enrollment report','audit','quarterly','Technology',true,false),
('euc-group-collab-licensing','Collaboration tools & centralized licensing','Microsoft 365 or Google Workspace with centralized licensing and governance.','Network & End-User Computing','RECORDS','License inventory + admin governance','audit','annual','Technology',true,false),
('support-entity-helpdesk','Local / outsourced helpdesk','Local or outsourced helpdesk for day-to-day user support.','Support & Operations','RECORDS','Helpdesk SLA + ticket metrics','audit','quarterly','Technology',true,true),
('support-group-tiered','Tiered support model (L1/L2/L3)','Tiered support: Level 1 local or shared desk; Level 2/3 centralized or specialist teams.','Support & Operations','POLICY','Support model + escalation paths','audit','annual','Technology',true,false),
('support-group-itsm','ITSM platform (ITIL-aligned)','IT Service Management platform (e.g. ServiceNow) with standardized ITIL-aligned processes.','Support & Operations','RECORDS','ITSM config + process catalog','audit','annual','Technology',true,false),
('support-group-observability','Monitoring & observability','Monitoring and observability tools for proactive issue detection across the group.','Support & Operations','RECORDS','Observability stack + sample alerts','audit','quarterly','Technology',true,false),
('eng-entity-custom','Entity custom / low-code solutions','Custom development or low-code solutions for subsidiary-specific needs.','Software Development & Innovation','RECORDS','Solution inventory + owners','audit','annual','Technology',true,true),
('eng-group-innovation','Innovation lab / digital transformation office','Centralized innovation lab or digital transformation office.','Software Development & Innovation','RECORDS','Charter + initiative pipeline','audit','annual','Technology',true,false),
('eng-group-devops','Secure coding, DevOps & CI/CD standards','Standards for development (secure coding, DevOps, CI/CD pipelines).','Software Development & Innovation','POLICY','SDL / DevOps standards + pipeline examples','audit','annual','Technology',true,false),
('eng-group-shared-platforms','Shared platforms for internal/customer tools','Shared platforms for internal tools or customer-facing digital products.','Software Development & Innovation','RECORDS','Platform catalog','audit','annual','Technology',true,false),
('eng-group-ai-automation','Group-wide AI & automation initiatives','AI and automation initiatives rolled out group-wide where beneficial.','Software Development & Innovation','RECORDS','Initiative register + ROI notes','audit','annual','Technology',true,false),
('int-group-architecture','Central integration architecture (Suite core)','Central integration architecture connecting marketing, CRM, ops, HR with Intuit Enterprise Suite as financial core.','Integrations & APIs','POLICY','Integration architecture diagram','audit','annual','Technology',true,false),
('int-group-api-mgmt','API management & governance','API management and governance practices.','Integrations & APIs','POLICY','API catalog + governance policy','audit','annual','Technology',true,false),
('int-group-event-driven','Event-driven real-time data flows','Event-driven architecture for real-time flows (e.g. sales/orders updating finance).','Integrations & APIs','RECORDS','Event map + sample flow evidence','audit','annual','Technology',true,false),
('budget-entity-tech','Entity technology budgets & procurement','Entity-specific technology budgets and procurement.','Budgeting & ROI','RECORDS','Entity tech budget + PO samples','audit','annual','Technology / Finance',true,true),
('budget-group-central','Centralized tech budgeting & procurement','Centralized or coordinated technology budgeting and procurement for scale discounts and standardization.','Budgeting & ROI','RECORDS','Group budget + preferred vendor list','audit','annual','Technology / Finance',true,false),
('budget-group-roi','Technology ROI tracking via Suite','Link IT investments to business outcomes using data from Intuit Enterprise Suite.','Budgeting & ROI','RECORDS','ROI analysis pack','audit','quarterly','Technology / Finance',true,true),
('budget-group-tco','TCO analysis (incl. Suite licensing)','Total Cost of Ownership analysis for major systems including Intuit Enterprise Suite licensing across entities.','Budgeting & ROI','RECORDS','TCO workbook / memo','audit','annual','Technology / Finance',true,false),
('team-entity-staff','Local IT staff or MSP','Local IT staff or managed service providers for subsidiary operations.','Team & Resources','RECORDS','Staffing / MSP roster + SOW','audit','annual','Technology',true,true),
('team-group-hybrid','Hybrid central IT organization','Central IT for strategy, architecture, security, core systems (Suite admin), and shared services.','Team & Resources','RECORDS','Org chart + responsibility map','audit','annual','Technology',true,false),
('team-group-business-partners','IT Business Partners for entities','Entity IT teams or IT Business Partners for local execution and requirements gathering.','Team & Resources','RECORDS','IBP assignments','audit','annual','Technology',true,false),
('team-group-skills','Skills development & talent sharing','Skills development and talent sharing across the group.','Team & Resources','RECORDS','Training plan / share sessions','audit','quarterly','Technology',true,true),
('team-group-raci','RACI for technology decisions','Clear RACI matrix for technology decisions.','Team & Resources','POLICY','Published RACI','audit','annual','Technology',true,false),
('bcdr-group-plans','Group BCDR plans','Group-level Business Continuity and Disaster Recovery plans with centralized backup, failover, and testing.','Disaster Recovery & BCDR','POLICY','BCDR plan set','audit','annual','Technology',true,false),
('bcdr-group-drills-suite','BCDR drills & Suite recovery alignment','Regular drills and alignment with Intuit Enterprise Suite recovery capabilities.','Disaster Recovery & BCDR','RECORDS','Drill report + Suite RTO/RPO notes','audit','annual','Technology / Finance',true,true),
('review-portfolio','Technology portfolio reviews & rationalization','Regular technology portfolio reviews and rationalization.','Review & Audit','RECORDS','Latest portfolio review pack','audit','quarterly','Technology',true,false),
('review-performance','Performance monitoring & continuous improvement','Performance monitoring, benchmarking, and continuous improvement.','Review & Audit','RECORDS','Benchmark / improvement log','audit','quarterly','Technology',true,true),
('review-annual-strategy','Annual technology strategy refresh','Annual technology strategy refresh.','Review & Audit','RECORDS','Refreshed strategy + approval','audit','annual','Technology',true,false),
('review-security-compliance-audit','Security & compliance audits','Security and compliance audits (internal and external).','Review & Audit','RECORDS','Audit reports + remediation tracker','audit','annual','Technology',true,true),
('review-post-impl','Post-implementation reviews','Post-implementation reviews for major projects (e.g. Intuit Suite rollout/upgrades).','Review & Audit','RECORDS','PIR document for recent major project','audit','annual','Technology',true,true),
('rec-suite-multi-entity-admin','Suite multi-entity admin readiness','Document Intuit Enterprise Suite multi-entity admin ownership, environments, and change control.','Platform Integration','RECORDS','Admin RACI + change log','recommended','quarterly','Technology / Finance',true,true),
('rec-command-center-tech','Multi-Entity Command Center technology visibility','Use Multi-Entity Command Center for group visibility into systems spend and operational health where applicable.','Platform Integration','RECORDS','Command Center view / export','recommended','quarterly','Technology / Finance',true,false),
('rec-entra-m365-governance','Entra ID / Microsoft 365 governance','Entra ID conditional access, group licensing, and M365 admin governance aligned to Zero Trust.','Platform Integration','RECORDS','Conditional access + license governance snapshot','recommended','quarterly','Technology',true,false),
('rec-integration-runbook','Critical integration runbooks','Runbooks for critical integrations into Intuit Enterprise Suite (failure/alert/owner).','Integrations & APIs','RECORDS','Runbook set for top integrations','recommended','annual','Technology',true,true),
('rec-sbom-vuln-hygiene','Software inventory / vulnerability hygiene','Maintain software inventory and vulnerability remediation SLAs for shared and entity stacks.','Cybersecurity','RECORDS','Inventory export + SLA metrics','recommended','quarterly','Technology',true,true)
on conflict (control_key) do update set
  title = excluded.title,
  description = excluded.description,
  area = excluded.area,
  document_kind = excluded.document_kind,
  evidence_expectation = excluded.evidence_expectation,
  source = excluded.source,
  cadence = excluded.cadence,
  owner_role = excluded.owner_role,
  applies_to_parent = excluded.applies_to_parent,
  applies_to_entities = excluded.applies_to_entities,
  updated_at = now();

select public.provision_technology_controls_for_parent();

do $$
declare
  r record;
begin
  for r in
    select id from public.ops_entities
    where status in ('active', 'forming', 'acquired')
  loop
    perform public.provision_technology_controls_for_entity(r.id);
  end loop;
end $$;

select public.create_technology_tasks_for_incomplete(null);
