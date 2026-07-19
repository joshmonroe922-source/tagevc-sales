-- Finance & Accounting audit matrix (parent + subsidiaries)
-- Source: docs/finance/Finance and Accounting Functions and Audit.docx
-- Intuit Enterprise Suite–aligned controls. Run after 0026 on hqmobgtnedmhzipusert.
-- Does NOT duplicate Legal-owned items (FEIN, formation, key-man, buy/sell insurance).

-- ---------------------------------------------------------------------------
-- Templates (catalog) — seed + auto-provision on new ops_entities
-- ---------------------------------------------------------------------------
create table if not exists public.finance_control_templates (
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
  owner_role           text not null default 'Finance',
  applies_to_parent    boolean not null default true,
  applies_to_entities  boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create or replace function public.set_finance_control_templates_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists finance_control_templates_updated_at on public.finance_control_templates;
create trigger finance_control_templates_updated_at
  before update on public.finance_control_templates
  for each row execute function public.set_finance_control_templates_updated_at();

-- ---------------------------------------------------------------------------
-- Controls (matrix rows): entity_id null = parent company
-- ---------------------------------------------------------------------------
create table if not exists public.finance_controls (
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
  owner_role           text not null default 'Finance',
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

create unique index if not exists finance_controls_key_scope_uidx
  on public.finance_controls (control_key, coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where control_key <> '' and active = true;

create index if not exists finance_controls_area_idx
  on public.finance_controls (area)
  where active = true;

create index if not exists finance_controls_status_idx
  on public.finance_controls (status)
  where active = true;

create index if not exists finance_controls_entity_idx
  on public.finance_controls (entity_id)
  where active = true;

create or replace function public.set_finance_controls_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists finance_controls_updated_at on public.finance_controls;
create trigger finance_controls_updated_at
  before update on public.finance_controls
  for each row execute function public.set_finance_controls_updated_at();

alter table public.finance_controls enable row level security;

drop policy if exists "Finance users manage finance controls" on public.finance_controls;
create policy "Finance users manage finance controls"
  on public.finance_controls for all
  using (public.is_active_sales_user() and public.user_has_portal('accounting-finance'))
  with check (public.is_active_sales_user() and public.user_has_portal('accounting-finance'));

alter table public.finance_control_templates enable row level security;

drop policy if exists "Finance users read finance templates" on public.finance_control_templates;
create policy "Finance users read finance templates"
  on public.finance_control_templates for select
  using (public.is_active_sales_user() and public.user_has_portal('accounting-finance'));

-- ---------------------------------------------------------------------------
-- Finance tasks linked to incomplete controls
-- ---------------------------------------------------------------------------
create table if not exists public.finance_tasks (
  id            uuid primary key default gen_random_uuid(),
  control_id    uuid not null references public.finance_controls (id) on delete cascade,
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

create unique index if not exists finance_tasks_open_control_uidx
  on public.finance_tasks (control_id)
  where status = 'open';

create index if not exists finance_tasks_status_idx
  on public.finance_tasks (status, due_at);

create or replace function public.set_finance_tasks_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists finance_tasks_updated_at on public.finance_tasks;
create trigger finance_tasks_updated_at
  before update on public.finance_tasks
  for each row execute function public.set_finance_tasks_updated_at();

alter table public.finance_tasks enable row level security;

drop policy if exists "Finance users manage finance tasks" on public.finance_tasks;
create policy "Finance users manage finance tasks"
  on public.finance_tasks for all
  using (public.is_active_sales_user() and public.user_has_portal('accounting-finance'))
  with check (public.is_active_sales_user() and public.user_has_portal('accounting-finance'));

-- ---------------------------------------------------------------------------
-- Provision helpers
-- ---------------------------------------------------------------------------
create or replace function public.provision_finance_controls_for_entity(p_entity_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  insert into public.finance_controls (
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
    'Auto-provisioned for new entity from finance control templates'
  from public.finance_control_templates t
  where t.applies_to_entities = true
    and not exists (
      select 1 from public.finance_controls c
      where c.control_key = t.control_key
        and c.entity_id = p_entity_id
        and c.active = true
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

create or replace function public.provision_finance_controls_for_parent()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  insert into public.finance_controls (
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
    'Seeded from Finance & Accounting Functions and Audit'
  from public.finance_control_templates t
  where t.applies_to_parent = true
    and not exists (
      select 1 from public.finance_controls c
      where c.control_key = t.control_key
        and c.entity_id is null
        and c.active = true
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

create or replace function public.trg_ops_entities_provision_finance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('active', 'forming', 'acquired') then
    perform public.provision_finance_controls_for_entity(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists ops_entities_provision_finance on public.ops_entities;
create trigger ops_entities_provision_finance
  after insert on public.ops_entities
  for each row execute function public.trg_ops_entities_provision_finance();

create or replace function public.trg_ops_entities_provision_finance_on_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and new.status in ('active', 'forming', 'acquired')
     and (old.status is null or old.status not in ('active', 'forming', 'acquired')) then
    perform public.provision_finance_controls_for_entity(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists ops_entities_provision_finance_on_status on public.ops_entities;
create trigger ops_entities_provision_finance_on_status
  after update of status on public.ops_entities
  for each row execute function public.trg_ops_entities_provision_finance_on_status();

create or replace function public.create_finance_tasks_for_incomplete(p_created_by uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  insert into public.finance_tasks (control_id, title, status, due_at, notes, created_by)
  select
    c.id,
    'Finance: ' || c.title,
    'open',
    c.next_due_at,
    coalesce(nullif(c.area, ''), 'Finance') || ' · ' || coalesce(nullif(c.control_key, ''), 'control'),
    p_created_by
  from public.finance_controls c
  where c.active = true
    and c.status in ('open', 'in_progress', 'gap')
    and not exists (
      select 1 from public.finance_tasks t
      where t.control_id = c.id and t.status = 'open'
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

grant execute on function public.provision_finance_controls_for_entity(uuid) to authenticated;
grant execute on function public.provision_finance_controls_for_parent() to authenticated;
grant execute on function public.create_finance_tasks_for_incomplete(uuid) to authenticated;

update public.sales_portals
set description = 'Accounting & finance audit, Intuit Enterprise Suite controls, and open finance tasks across parent + subsidiaries.'
where slug = 'accounting-finance';

insert into public.finance_control_templates (control_key, title, description, area, document_kind, evidence_expectation, source, cadence, owner_role, applies_to_parent, applies_to_entities) values
('setup-multi-entity-command-center','Multi-Entity Command Center setup','Configure entities, shared Chart of Accounts, intercompany relationships, and workflows in Intuit Enterprise Suite Multi-Entity Command Center.','Platform Setup','RECORDS','Command Center config screenshot / checklist','audit','one_time','Finance',true,false),
('setup-entity-company-profile','Company / entity profile in Suite','Create or configure this legal entity as a distinct entity in the Suite with own books.','Platform Setup','RECORDS','Entity profile in Multi-Entity Command Center','audit','one_time','Finance',true,true),
('setup-chart-of-accounts','Chart of Accounts (standardized / mapped)','Maintain standardized group Chart of Accounts with entity-specific mappings where needed (e.g. local GAAP).','Platform Setup','RECORDS','Mapped COA export or Command Center confirmation','audit','annual','Finance',true,true),
('setup-accounting-policies','Uniform accounting policies','Document uniform policies (revenue recognition, depreciation, etc.) and enforce via workflows/approvals.','Policies','POLICY','Policy pack + Suite workflow config','audit','annual','Finance',true,true),
('setup-intercompany-mappings','Intercompany relationships & mappings','Document intercompany relationships and mappings in the Command Center.','Platform Setup','RECORDS','IC relationship map in Command Center','audit','annual','Finance',true,true),
('setup-role-permissions','Role-based access & permissions','Group finance sees consolidated + entities; subsidiary teams see only their entity.','Controls','RECORDS','Permission matrix / role config','audit','annual','Finance / Admin',true,true),
('acct-ar-cycle','Accounts receivable / invoicing / collections','Full AR cycle per entity: invoices, payments, credit memos, aging, collections workflows.','Accounts Receivable','RECORDS','AR aging + sample invoices / collections workflow','audit','monthly','Finance',true,true),
('acct-ap-cycle','Accounts payable / bills / payments','Full AP cycle per entity: bills, payments, vendor management, aging.','Accounts Payable','RECORDS','AP aging + vendor list + sample bills','audit','monthly','Finance',true,true),
('acct-banking-reconciliations','Banking & cash management / reconciliations','Bank feeds, reconciliations, deposits, transfers — per entity (group oversight where applicable).','Banking','RECORDS','Latest bank reconciliations','audit','monthly','Finance',true,true),
('acct-payroll','Payroll integration & postings','Integrated Intuit Payroll or third-party sync; run per entity or allocate across entities.','Payroll','RECORDS','Payroll recon / integration confirmation','audit','monthly','Finance / HR',true,true),
('acct-inventory','Inventory tracking (if applicable)','Track inventory per entity; use classes/locations if needed; mark N/A when no inventory.','Inventory','RECORDS','Inventory report or N/A rationale','audit','monthly','Finance',true,true),
('acct-fixed-assets','Fixed assets & depreciation','Asset tracking and depreciation schedules configured per entity.','Fixed Assets','RECORDS','Fixed asset register + depreciation schedule','audit','quarterly','Finance',true,true),
('acct-gl-journal-entries','General ledger & journal entries','Daily postings, recurring templates, and allocations (incl. intercompany expense allocations).','General Ledger','RECORDS','JE log / recurring template list','audit','monthly','Finance',true,true),
('acct-bookkeeping-daily','Daily bookkeeping processes','Daily transaction entry cadence documented and followed within entity views.','Bookkeeping','RECORDS','Bookkeeping SOP / sample daily close notes','audit','monthly','Finance',true,true),
('acct-period-close-entity','Entity period-close checklist','Monthly reconciliations (bank, AR/AP, inventory) and entity close checklist completed.','Period Close','RECORDS','Completed entity close checklist','audit','monthly','Finance',true,true),
('acct-entity-financial-reporting','Entity financial reporting','Run P&L, Balance Sheet, Cash Flow, Trial Balance filtered by entity and retained.','Financial Reporting','RECORDS','Latest entity P&L / BS / CF / TB pack','audit','monthly','Finance',true,true),
('ic-transactions','Intercompany transactions recorded','Record bills, invoices, and journal entries between entities using Suite IC workflows.','Intercompany','RECORDS','Sample IC transactions + workflow status','audit','monthly','Finance',true,true),
('ic-icje-templates','Recurring Intercompany Journal Entry (ICJE) templates','Use recurring ICJE templates (2026+) for consistent allocations and IC postings.','Intercompany','RECORDS','ICJE template list','audit','quarterly','Finance',true,true),
('ic-automated-eliminations','Automated transaction-level eliminations','Enable and monitor automated eliminations at transaction recording (Suite 2026+).','Consolidation','RECORDS','Eliminations status / sample auto-elim evidence','audit','monthly','Finance',true,false),
('consol-process','Consolidation process','Aggregate entity data and run group consolidation via Multi-Entity tools.','Consolidation','RECORDS','Consolidation run log / checklist','audit','monthly','Finance',true,false),
('consol-nci','Non-controlling interest (NCI) handling','Handle NCI correctly when partial ownership exists; document N/A if 100% owned.','Consolidation','RECORDS','NCI schedule or N/A confirmation','audit','annual','Finance',true,false),
('consol-currency-translation','Currency translation','Apply currency translation for multi-currency entities; document N/A if single currency.','Consolidation','RECORDS','FX translation notes or N/A','audit','monthly','Finance',true,false),
('consol-statements','Consolidated financial statements','Generate consolidated P&L, Balance Sheet, and Cash Flow for the economic group.','Consolidation','RECORDS','Latest consolidated statements pack','audit','monthly','Finance',true,false),
('consol-saved-reports','Saved consolidated reports & schedules','Create and maintain saved consolidated reports / dashboards for ongoing group visibility.','Consolidation','RECORDS','Saved report list in Consolidated Reports','audit','quarterly','Finance',true,false),
('consol-elim-icje-review','Review eliminations & ICJEs for accuracy','Preparation checklist: review automated eliminations and ICJEs before external/internal close.','Audit Prep','RECORDS','Signed review note of elim/ICJE pack','audit','monthly','Finance',true,false),
('fin-budgeting-entity','Entity budgeting','Create entity-specific operating/capital budgets with variance reporting.','Budgeting & Forecasting','RECORDS','Entity budget + variance report','audit','annual','Finance',true,true),
('fin-cash-flow-forecast','Entity cash flow forecasting','Entity-level cash flow statements and forward projections.','Budgeting & Forecasting','RECORDS','Cash flow forecast','audit','monthly','Finance',true,true),
('fin-projections-3-5yr','3–5 year entity projections','Build multi-year forecasts per entity (revenue, expenses, P&L, balance sheet).','Budgeting & Forecasting','RECORDS','3–5 year projection model','audit','annual','Finance',true,true),
('fin-kpis-entity','Entity KPIs & dashboards','Track entity KPIs (gross margin, AR days, AP days, etc.) via custom dashboards.','KPIs & Dashboards','RECORDS','Entity KPI dashboard / export','audit','monthly','Finance',true,true),
('fin-working-capital','Working capital management','Manage AR collections, AP payments, and inventory turns per entity.','Working Capital','RECORDS','Working capital snapshot','audit','monthly','Finance',true,true),
('fin-consol-budgeting','Consolidated budgeting & forecasting','Roll up entity budgets into group views; run consolidated projections.','Budgeting & Forecasting','RECORDS','Consolidated budget pack','audit','annual','Finance',true,false),
('fin-group-treasury','Group treasury & cash visibility','Centralized cash visibility across entities; document intercompany transfers/allocations.','Treasury','RECORDS','Group cash dashboard / transfer log','audit','monthly','Finance',true,false),
('fin-capital-allocation','Group funding & capital allocation','Track overall group capital structure, funding, and capital allocation decisions.','Treasury','RECORDS','Capital structure / allocation schedule','audit','annual','Finance',true,false),
('fin-intercompany-loans-dividends','Intercompany loans & dividends','Track intercompany loans and dividends from subsidiaries to parent.','Intercompany','RECORDS','IC loan / dividend schedule','audit','quarterly','Finance',true,true),
('fin-risk-dashboards','Group risk management dashboards','Group dashboards for consolidated leverage, cash runway, and scenario planning.','Risk Management','RECORDS','Risk / runway dashboard','audit','monthly','Finance',true,false),
('fin-group-kpis','Group KPIs & entity contribution','Track consolidated metrics (EBITDA, net margin, debt ratios) and entity contribution reports.','KPIs & Dashboards','RECORDS','Group KPI + contribution report','audit','monthly','Finance',true,false),
('fin-break-even-sensitivity','Break-even & sensitivity analysis','Run break-even and sensitivity analysis at entity and/or group level.','Risk Management','RECORDS','Sensitivity / break-even pack','audit','quarterly','Finance',true,true),
('ctrl-monthly-recons','Monthly bank / AR / AP reconciliations control','Complete and retain monthly bank, AR, and AP reconciliations (entity self-audit).','Controls','RECORDS','Recon packet for latest close','audit','monthly','Finance',true,true),
('ctrl-segregation-of-duties','Segregation of duties','Segregation of duties via user permissions/roles (preparer vs approver).','Controls','RECORDS','SoD matrix / role assignments','audit','annual','Finance / Admin',true,true),
('ctrl-approval-workflows','Approval workflows (JE / allocations / close)','Workflow approvals enabled for journal entries, allocations, and close processes.','Controls','RECORDS','Approval workflow config + sample approvals','audit','annual','Finance',true,true),
('ctrl-audit-trails','Transaction audit trails enabled','Confirm native Suite audit trails are available and reviewed for critical processes.','Controls','RECORDS','Audit trail sample (IC / consolidation adjustments)','audit','annual','Finance',true,true),
('ctrl-entity-supporting-docs','Entity supporting documentation pack','Aging reports, fixed asset registers, payroll reconciliations prepared from Suite.','Audit Prep','RECORDS','Supporting docs pack for latest period','audit','monthly','Finance',true,true),
('ctrl-group-audit-prep','Group audit preparation (consolidated)','Consolidated reports + elimination audit trails ready for external auditors.','Audit Prep','RECORDS','Group audit prep binder / export','audit','annual','Finance',true,false),
('ctrl-statutory-entity-audit','Statutory / entity audit readiness','Entity-specific statements and reports available for any required local audits.','Audit Prep','RECORDS','Entity statutory pack or N/A','audit','annual','Finance',true,true),
('ctrl-tax-ready-reporting','Tax-ready reporting exports','Export/support 1099s, sales tax, and other tax-ready reports from Suite (coordinate with Legal/CPA on filings).','Tax Support','RECORDS','Tax export pack / calendar note','audit','annual','Finance',true,true),
('rec-sandbox-test-close','Sandbox / test company file for close changes','Test Multi-Entity / elimination / ICJE changes in a sandbox before production close.','Platform Setup','RECORDS','Sandbox test note','recommended','annual','Finance',true,false),
('rec-spreadsheet-sync','Spreadsheet Sync for deeper analysis','Use Spreadsheet Sync for Excel analysis of entity/group results when needed.','Financial Reporting','RECORDS','Sample synced workbook or N/A','recommended','quarterly','Finance',true,true),
('rec-close-calendar','Group close calendar published','Publish monthly/quarterly close calendar covering entity then group consolidation.','Period Close','POLICY','Published close calendar','recommended','annual','Finance',true,false),
('rec-bank-feed-health','Bank feed health check','Confirm bank feeds connected and exceptions cleared for each entity with bank accounts.','Banking','RECORDS','Bank feed status report','recommended','monthly','Finance',true,true),
('rec-vendor-customer-cleanup','Vendor & customer master data hygiene','Periodic cleanup of duplicate/inactive vendors and customers per entity.','Master Data','RECORDS','Cleanup log','recommended','quarterly','Finance',true,true)
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

select public.provision_finance_controls_for_parent();

do $$
declare
  r record;
begin
  for r in
    select id from public.ops_entities
    where status in ('active', 'forming', 'acquired')
  loop
    perform public.provision_finance_controls_for_entity(r.id);
  end loop;
end $$;

select public.create_finance_tasks_for_incomplete(null);
