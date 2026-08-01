-- Phase 90: Shared Services Vendor Management spine (workbook SSOT).
-- Extends Phase 89 partner spine — does not duplicate partner catalog.
-- Multi-entity: ENT-FIRM / ENT-R619 / ENT-SIGNENT / ENT-INDA + future via provision.
-- Safe to re-run. No vendor API credentials invented.

-- ---------------------------------------------------------------------------
-- Entity code aliases (workbook TAGE/R619/SHR/INDA ↔ OS entity_id)
-- ---------------------------------------------------------------------------
create table if not exists public.vm_entity_codes (
  code text primary key,
  entity_id text not null references public.entities(entity_id),
  legal_name text not null,
  entity_type text not null default 'Subsidiary'
    check (entity_type in ('Parent', 'Subsidiary')),
  parent_code text references public.vm_entity_codes(code),
  status text not null default 'Active'
    check (status in ('Active', 'Inactive')),
  currency text not null default 'USD',
  fy_start_month int not null default 1 check (fy_start_month between 1 and 12),
  shared_services_pct numeric(6,4) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.vm_entity_codes
  (code, entity_id, legal_name, entity_type, parent_code, status, currency, shared_services_pct, notes)
values
  ('TAGE', 'ENT-FIRM', 'Tage Venture Capital', 'Parent', null, 'Active', 'USD', 1.0000,
   'VC parent; shared G&A and platform spine'),
  ('R619', 'ENT-R619', 'Recruit 619', 'Subsidiary', 'TAGE', 'Active', 'USD', 0.2500,
   'Recruiting / staffing'),
  ('SHR', 'ENT-SIGNENT', 'Signent HR', 'Subsidiary', 'TAGE', 'Active', 'USD', 0.2500,
   'HR services'),
  ('INDA', 'ENT-INDA', 'Instant NDA', 'Subsidiary', 'TAGE', 'Active', 'USD', 0.2500,
   'NDA / legal tech product')
on conflict (code) do update set
  entity_id = excluded.entity_id,
  legal_name = excluded.legal_name,
  entity_type = excluded.entity_type,
  parent_code = excluded.parent_code,
  status = excluded.status,
  currency = excluded.currency,
  shared_services_pct = excluded.shared_services_pct,
  notes = excluded.notes,
  updated_at = now();

-- New OS entities inherit Vendor Management when provisioned
create table if not exists public.vm_entity_module_enablement (
  entity_id text primary key references public.entities(entity_id),
  enabled boolean not null default true,
  code text,
  provisioned_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

insert into public.vm_entity_module_enablement (entity_id, enabled, code)
select e.entity_id, true, c.code
from public.vm_entity_codes c
join public.entities e on e.entity_id = c.entity_id
on conflict (entity_id) do update set
  enabled = true,
  code = excluded.code;

-- ---------------------------------------------------------------------------
-- Settings + FX
-- ---------------------------------------------------------------------------
create table if not exists public.vm_settings (
  id text primary key default 'default',
  scenario text not null default 'Base' check (scenario in ('Base', 'Bear', 'Bull')),
  as_of_date date not null default current_date,
  currency text not null default 'USD',
  burden_pct numeric(8,4) not null default 0.28,
  benefits_monthly numeric(12,2) not null default 450,
  recruiting_pct numeric(8,4) not null default 0.15,
  equipment_onetime numeric(12,2) not null default 2500,
  training_90d numeric(12,2) not null default 1500,
  facilities_monthly numeric(12,2) not null default 200,
  mgmt_overhead_pct numeric(8,4) not null default 0.08,
  hc_growth_bear numeric(8,4) not null default 0,
  hc_growth_base numeric(8,4) not null default 0.10,
  hc_growth_bull numeric(8,4) not null default 0.25,
  rev_growth_bear numeric(8,4) not null default -0.05,
  rev_growth_base numeric(8,4) not null default 0.15,
  rev_growth_bull numeric(8,4) not null default 0.35,
  seat_inflation_bear numeric(8,4) not null default 0.08,
  seat_inflation_base numeric(8,4) not null default 0.05,
  seat_inflation_bull numeric(8,4) not null default 0.03,
  updated_at timestamptz not null default now()
);

insert into public.vm_settings (id) values ('default')
on conflict (id) do nothing;

create table if not exists public.vm_fx_rates (
  currency text primary key,
  rate_to_usd numeric(18,8) not null,
  as_of_date date not null default current_date,
  source text,
  active boolean not null default true,
  notes text,
  updated_at timestamptz not null default now()
);

insert into public.vm_fx_rates (currency, rate_to_usd, source, notes) values
  ('USD', 1, 'Spot', 'Reporting currency'),
  ('EUR', 1.08, 'ECB/ref', 'Sample'),
  ('GBP', 1.27, 'BoE/ref', 'Sample'),
  ('CAD', 0.74, 'BoC/ref', 'Sample'),
  ('MXN', 0.049, 'Banxico/ref', 'Sample')
on conflict (currency) do update set
  rate_to_usd = excluded.rate_to_usd,
  source = excluded.source,
  active = true,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Cost centers
-- ---------------------------------------------------------------------------
create table if not exists public.vm_cost_centers (
  id text primary key,
  name text not null,
  entity_id text not null references public.entities(entity_id),
  dept_code text,
  cc_type text,
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  owner_emp_id text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vm_cost_centers_entity_idx
  on public.vm_cost_centers (entity_id, status);

-- ---------------------------------------------------------------------------
-- Vendors (current) + profiles + history
-- ---------------------------------------------------------------------------
create table if not exists public.vm_vendors (
  id text primary key,
  name text not null,
  entity_id text not null references public.entities(entity_id),
  category text,
  product text,
  pricing_model text not null default 'Fixed'
    check (pricing_model in ('Per User', 'Fixed', 'Usage', 'Hybrid')),
  billing_cadence text not null default 'Monthly'
    check (billing_cadence in ('Monthly', 'Quarterly', 'Semi-Annual', 'Annual')),
  invoice_amount numeric(14,2) not null default 0,
  currency text not null default 'USD',
  seats_contracted int,
  seats_active int,
  unit_price numeric(14,4),
  contract_start date,
  contract_end date,
  auto_renew boolean not null default false,
  status text not null default 'Active'
    check (status in ('Active', 'Ended', 'Replaced')),
  owner text,
  notes text,
  partner_key text,
  cost_center_id text references public.vm_cost_centers(id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vm_vendors_entity_idx
  on public.vm_vendors (entity_id, status)
  where archived_at is null;

create index if not exists vm_vendors_contract_end_idx
  on public.vm_vendors (contract_end)
  where archived_at is null and contract_end is not null;

create table if not exists public.vm_vendor_profiles (
  vendor_id text primary key references public.vm_vendors(id) on delete cascade,
  legal_name text,
  entity_id text not null references public.entities(entity_id),
  category text,
  primary_contact text,
  email text,
  phone text,
  support_url text,
  sla_tier text,
  security_review text not null default 'Review Due'
    check (security_review in ('Approved', 'Review Due', 'Rejected')),
  dpa boolean not null default false,
  contract_url text,
  renewal_notice_days int not null default 90,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vm_vendors_history (
  id uuid primary key default gen_random_uuid(),
  vendor_id text,
  name text not null,
  entity_id text not null references public.entities(entity_id),
  category text,
  product text,
  pricing_model text,
  billing_cadence text,
  invoice_amount numeric(14,2),
  currency text,
  seats_contracted int,
  unit_price numeric(14,4),
  contract_start date,
  contract_end date,
  status text,
  owner text,
  notes text,
  snapshot_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Products, roles, birthright, employees, entitlements
-- ---------------------------------------------------------------------------
create table if not exists public.vm_products (
  id text primary key,
  name text not null,
  vendor_id text references public.vm_vendors(id) on delete set null,
  entity_scope text not null default 'ALL',
  license_type text,
  cost_seat_mo numeric(14,4) not null default 0,
  fixed_cost_mo numeric(14,4) not null default 0,
  requires_sso boolean not null default false,
  sensitivity text,
  offboard_action text not null default 'Revoke'
    check (offboard_action in ('Revoke', 'Keep org')),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vm_roles (
  id text primary key,
  name text not null,
  entity_id text not null references public.entities(entity_id),
  dept text,
  level text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vm_role_products (
  role_id text not null references public.vm_roles(id) on delete cascade,
  product_id text not null references public.vm_products(id) on delete cascade,
  is_birthright boolean not null default true,
  primary key (role_id, product_id)
);

create table if not exists public.vm_employees (
  id text primary key,
  name text not null,
  entity_id text not null references public.entities(entity_id),
  role_id text references public.vm_roles(id) on delete set null,
  dept text,
  status text not null default 'Active'
    check (status in ('Active', 'Terminated')),
  fte numeric(6,3) not null default 1,
  base_salary_annual numeric(14,2) not null default 0,
  commission_target_annual numeric(14,2) not null default 0,
  start_date date,
  work_location text,
  manager_emp_id text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vm_employees_entity_idx
  on public.vm_employees (entity_id, status)
  where archived_at is null;

create table if not exists public.vm_entitlements (
  emp_id text not null references public.vm_employees(id) on delete cascade,
  product_id text not null references public.vm_products(id) on delete cascade,
  assigned boolean not null default true,
  source text not null default 'birthright'
    check (source in ('birthright', 'request', 'exception')),
  updated_at timestamptz not null default now(),
  primary key (emp_id, product_id)
);

create table if not exists public.vm_comp_bands (
  id text primary key,
  role_id text not null references public.vm_roles(id) on delete cascade,
  level text,
  entity_id text not null references public.entities(entity_id),
  base_min numeric(14,2),
  base_mid numeric(14,2),
  base_max numeric(14,2),
  comm_target_mid numeric(14,2),
  equity_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Access requests, renewals, budgets
-- ---------------------------------------------------------------------------
create table if not exists public.vm_access_requests (
  id text primary key,
  emp_id text not null references public.vm_employees(id) on delete cascade,
  product_id text not null references public.vm_products(id) on delete cascade,
  request_date date not null default current_date,
  needed_until date,
  status text not null default 'Pending'
    check (status in ('Pending', 'Approved', 'Rejected', 'Expired')),
  approver text,
  decision_date date,
  business_justification text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vm_renewals (
  id text primary key,
  vendor_id text not null references public.vm_vendors(id) on delete cascade,
  entity_id text not null references public.entities(entity_id),
  contract_end date not null,
  notice_days int not null default 90,
  proposed_annual numeric(14,2),
  status text not null default 'Draft'
    check (status in (
      'Draft', 'Watch', 'In Review', 'Pending Approval',
      'Pending Finance', 'Approved', 'Rejected', 'At Risk'
    )),
  approver_admin_id text,
  approval_date date,
  decision text check (decision is null or decision in ('Approve', 'Reject', 'Renegotiate')),
  owner_emp_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vm_renewals_entity_idx
  on public.vm_renewals (entity_id, status, contract_end);

create table if not exists public.vm_budgets (
  id text primary key,
  entity_id text not null references public.entities(entity_id),
  category text not null,
  fy int not null,
  annual_budget numeric(14,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, category, fy)
);

-- ---------------------------------------------------------------------------
-- Lifecycle templates / cases
-- ---------------------------------------------------------------------------
create table if not exists public.vm_lifecycle_templates (
  id text primary key,
  event text not null check (event in ('Onboard', 'Offboard', 'Transfer')),
  phase text not null,
  task text not null,
  owner_role text,
  sla_hours int not null default 24,
  sort_order int not null default 0
);

insert into public.vm_lifecycle_templates
  (id, event, phase, task, owner_role, sla_hours, sort_order)
values
  ('T-ON-01', 'Onboard', 'Pre-day1', 'Create IdP account + MFA enroll', 'AR-IT', 24, 1),
  ('T-ON-02', 'Onboard', 'Pre-day1', 'Assign birthright licenses from Role_ID', 'AR-IT', 24, 2),
  ('T-ON-03', 'Onboard', 'Pre-day1', 'Order/ship laptop + MDM enroll', 'AR-IT', 72, 3),
  ('T-ON-04', 'Onboard', 'Day1', 'Add to Slack + core channels', 'AR-IT', 4, 4),
  ('T-ON-05', 'Onboard', 'Day1', 'HRIS profile complete + handbook', 'AR-HR', 8, 5),
  ('T-ON-06', 'Onboard', 'Day1', 'Manager 30-60-90 + tool walkthrough', 'Manager', 8, 6),
  ('T-ON-07', 'Onboard', 'Week1', 'Security training complete', 'AR-IT', 40, 7),
  ('T-ON-08', 'Onboard', 'Week1', 'Verify all birthright apps login OK', 'AR-IT', 40, 8),
  ('T-OFF-01', 'Offboard', 'Day0', 'Disable IdP SSO (kill switch)', 'AR-IT', 1, 1),
  ('T-OFF-02', 'Offboard', 'Day0', 'Revoke all named-user licenses', 'AR-IT', 2, 2),
  ('T-OFF-03', 'Offboard', 'Day0', 'MDM wipe / recover device', 'AR-IT', 24, 3),
  ('T-OFF-04', 'Offboard', 'Day0', 'Transfer Drive/email ownership', 'AR-IT', 8, 4),
  ('T-OFF-05', 'Offboard', 'Day0', 'Remove from Slack / groups', 'AR-IT', 2, 5),
  ('T-OFF-06', 'Offboard', 'Day0', 'HRIS status Terminated + payroll end', 'AR-HR', 4, 6),
  ('T-OFF-07', 'Offboard', 'Day1', 'Revoke portal admin if any', 'AR-SUPER', 4, 7),
  ('T-OFF-08', 'Offboard', 'Week1', 'Collect badges/keys / exit interview', 'AR-HR', 40, 8),
  ('T-TR-01', 'Transfer', 'Day0', 'Recalc birthright delta old→new role', 'AR-IT', 8, 1),
  ('T-TR-02', 'Transfer', 'Day0', 'Provision added apps / revoke removed', 'AR-IT', 8, 2),
  ('T-TR-03', 'Transfer', 'Week1', 'Access certification by new manager', 'Manager', 40, 3)
on conflict (id) do update set
  event = excluded.event,
  phase = excluded.phase,
  task = excluded.task,
  owner_role = excluded.owner_role,
  sla_hours = excluded.sla_hours,
  sort_order = excluded.sort_order;

create table if not exists public.vm_lifecycle_cases (
  id text primary key,
  emp_id text not null references public.vm_employees(id) on delete cascade,
  event text not null check (event in ('Onboard', 'Offboard', 'Transfer')),
  role_id text,
  entity_id text not null references public.entities(entity_id),
  start_date date not null default current_date,
  target_complete date,
  status text not null default 'Planned'
    check (status in ('Planned', 'In Progress', 'Complete')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vm_lifecycle_case_tasks (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references public.vm_lifecycle_cases(id) on delete cascade,
  template_id text references public.vm_lifecycle_templates(id),
  task text not null,
  owner_role text,
  sla_hours int,
  sort_order int not null default 0,
  done boolean not null default false,
  completed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Usage, chargeback, revenue, alerts, integrations, admin, audit
-- ---------------------------------------------------------------------------
create table if not exists public.vm_usage_signals (
  id uuid primary key default gen_random_uuid(),
  emp_id text not null references public.vm_employees(id) on delete cascade,
  product_id text not null references public.vm_products(id) on delete cascade,
  assigned boolean not null default true,
  last_active date,
  threshold_days int not null default 30,
  action text,
  updated_at timestamptz not null default now(),
  unique (emp_id, product_id)
);

create table if not exists public.vm_chargeback_rules (
  id text primary key,
  vendor_id text not null references public.vm_vendors(id) on delete cascade,
  method text not null default 'Fixed %'
    check (method in ('Seats', 'Fixed %')),
  pct_tage numeric(8,4) not null default 0,
  pct_r619 numeric(8,4) not null default 0,
  pct_shr numeric(8,4) not null default 0,
  pct_inda numeric(8,4) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vm_chargeback_pct_sum check (
    method = 'Seats'
    or abs((pct_tage + pct_r619 + pct_shr + pct_inda) - 1.0) < 0.0001
  )
);

create table if not exists public.vm_revenue_inputs (
  entity_id text primary key references public.entities(entity_id),
  ttm_revenue numeric(16,2) not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.vm_revenue_inputs (entity_id, ttm_revenue)
select e.entity_id, 0
from (select unnest(array['ENT-FIRM', 'ENT-R619', 'ENT-SIGNENT', 'ENT-INDA']) as entity_id) e
where exists (select 1 from public.entities ent where ent.entity_id = e.entity_id)
on conflict (entity_id) do nothing;

create table if not exists public.vm_alert_rules (
  id text primary key,
  name text not null,
  category text not null,
  condition_logic text not null,
  threshold numeric(14,4),
  severity text not null default 'Medium'
    check (severity in ('Low', 'Medium', 'High', 'Critical')),
  channel text not null default 'Email+Slack',
  audience text,
  enabled boolean not null default true,
  last_eval_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.vm_alert_rules
  (id, name, category, condition_logic, threshold, severity, channel, audience, enabled)
values
  ('AL-01', 'Renewal 90-day', 'Renewals',
   'Days_to_End <= 90 AND status not Approved', 90, 'Medium', 'Email+Slack',
   'Vendor Admin + Owner', true),
  ('AL-02', 'Renewal 30-day', 'Renewals',
   'Days_to_End <= 30 AND status not Approved', 30, 'High', 'Email+Slack+Pager',
   'Finance + Vendor Admin', true),
  ('AL-03', 'Renewal expired', 'Renewals',
   'Days_to_End < 0', 0, 'Critical', 'Email+Slack', 'Super + Finance', true),
  ('AL-04', 'Budget overrun', 'Budgets',
   'Variance $ < 0', 0, 'High', 'Email', 'Finance Admin + Entity Owner', true),
  ('AL-05', 'License waste', 'Spend',
   'Waste $/mo > threshold', 500, 'Medium', 'Slack', 'IT Admin', true),
  ('AL-06', 'Reclaim candidates', 'Usage',
   'Status = RECLAIM CANDIDATE count > 0', 1, 'Low', 'Slack', 'IT Admin', true),
  ('AL-07', 'Pending access requests', 'Access',
   'Pending requests > 0 aging > 3d', 3, 'Medium', 'Slack', 'IT Admin', true),
  ('AL-08', 'Admin coverage gap', 'Portal',
   'Entity vendor coverage = Gap', null, 'High', 'Email', 'Super Admin', true),
  ('AL-09', 'Security review due', 'Vendor',
   'Security Review <> Approved', null, 'High', 'Email', 'IT Admin', true),
  ('AL-10', 'Integration error', 'Integrations',
   'Status = Error', null, 'Critical', 'Pager', 'IT Admin', true),
  ('AL-11', 'Offboard SLA breach', 'Lifecycle',
   'Open offboard task past SLA', null, 'Critical', 'Pager', 'IT + HR', true),
  ('AL-12', 'Hire above band', 'Comp',
   'Proposed base > band max', null, 'Medium', 'Email', 'Finance + Hiring Mgr', true)
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  condition_logic = excluded.condition_logic,
  threshold = excluded.threshold,
  severity = excluded.severity,
  channel = excluded.channel,
  audience = excluded.audience,
  enabled = excluded.enabled,
  updated_at = now();

create table if not exists public.vm_alert_events (
  id uuid primary key default gen_random_uuid(),
  rule_id text not null references public.vm_alert_rules(id) on delete cascade,
  entity_id text references public.entities(entity_id),
  object_type text,
  object_id text,
  message text not null,
  severity text not null,
  triggered_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  meta jsonb not null default '{}'::jsonb
);

create table if not exists public.vm_integrations (
  id text primary key,
  system_name text not null,
  category text,
  direction text,
  entities text,
  auth_type text,
  status text not null default 'Planned'
    check (status in ('Planned', 'Live', 'Paused', 'Error')),
  sync_cadence text,
  owner_emp_id text,
  primary_objects text,
  env text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vm_admin_roles (
  id text primary key,
  name text not null,
  scope_level text not null,
  description text,
  mfa_required boolean not null default true,
  sso_required boolean not null default true
);

insert into public.vm_admin_roles (id, name, scope_level, description) values
  ('AR-SUPER', 'Super Admin', 'Group (all entities)',
   'Full portal control: users, vendors, billing, roles, audit export'),
  ('AR-VEND', 'Vendor Admin', 'Assigned entities',
   'CRUD vendors/contracts, renewals, seat counts; no user admin'),
  ('AR-FIN', 'Finance Admin', 'Assigned entities',
   'View spend, approve renewals > threshold, export finance'),
  ('AR-IT', 'IT License Admin', 'Assigned entities',
   'Manage products, seat assignment, offboard reclaim; no contract $ edit'),
  ('AR-HR', 'HR Lifecycle Admin', 'Assigned entities',
   'Trigger onboard/offboard license packs; read-only vendors'),
  ('AR-VIEW', 'Read-Only Viewer', 'Assigned entities',
   'Dashboards & reports only; no edits'),
  ('AR-ENT', 'Entity Owner', 'Single entity',
   'Full vendor+people ops for one sub')
on conflict (id) do update set
  name = excluded.name,
  scope_level = excluded.scope_level,
  description = excluded.description;

create table if not exists public.vm_admin_permissions (
  admin_role_id text not null references public.vm_admin_roles(id) on delete cascade,
  permission_key text not null,
  allowed boolean not null default false,
  primary key (admin_role_id, permission_key)
);

insert into public.vm_admin_permissions (admin_role_id, permission_key, allowed)
select r.id, p.key, (p.bits ->> r.id)::boolean
from public.vm_admin_roles r
cross join (
  values
    ('login_portal', '{"AR-SUPER":true,"AR-VEND":true,"AR-FIN":true,"AR-IT":true,"AR-HR":true,"AR-VIEW":true,"AR-ENT":true}'::jsonb),
    ('view_vendors', '{"AR-SUPER":true,"AR-VEND":true,"AR-FIN":true,"AR-IT":true,"AR-HR":true,"AR-VIEW":true,"AR-ENT":true}'::jsonb),
    ('create_vendor', '{"AR-SUPER":true,"AR-VEND":true,"AR-FIN":false,"AR-IT":false,"AR-HR":false,"AR-VIEW":false,"AR-ENT":true}'::jsonb),
    ('edit_vendor', '{"AR-SUPER":true,"AR-VEND":true,"AR-FIN":false,"AR-IT":true,"AR-HR":false,"AR-VIEW":false,"AR-ENT":true}'::jsonb),
    ('archive_vendor', '{"AR-SUPER":true,"AR-VEND":true,"AR-FIN":false,"AR-IT":false,"AR-HR":false,"AR-VIEW":false,"AR-ENT":true}'::jsonb),
    ('edit_contracts', '{"AR-SUPER":true,"AR-VEND":true,"AR-FIN":true,"AR-IT":false,"AR-HR":false,"AR-VIEW":false,"AR-ENT":true}'::jsonb),
    ('manage_seats', '{"AR-SUPER":true,"AR-VEND":true,"AR-FIN":false,"AR-IT":true,"AR-HR":true,"AR-VIEW":false,"AR-ENT":true}'::jsonb),
    ('approve_renewal', '{"AR-SUPER":true,"AR-VEND":false,"AR-FIN":true,"AR-IT":false,"AR-HR":false,"AR-VIEW":false,"AR-ENT":true}'::jsonb),
    ('manage_products', '{"AR-SUPER":true,"AR-VEND":true,"AR-FIN":false,"AR-IT":true,"AR-HR":false,"AR-VIEW":false,"AR-ENT":true}'::jsonb),
    ('manage_role_rules', '{"AR-SUPER":true,"AR-VEND":false,"AR-FIN":false,"AR-IT":true,"AR-HR":false,"AR-VIEW":false,"AR-ENT":true}'::jsonb),
    ('manage_employees', '{"AR-SUPER":true,"AR-VEND":false,"AR-FIN":false,"AR-IT":false,"AR-HR":true,"AR-VIEW":false,"AR-ENT":true}'::jsonb),
    ('manage_admins', '{"AR-SUPER":true,"AR-VEND":false,"AR-FIN":false,"AR-IT":false,"AR-HR":false,"AR-VIEW":false,"AR-ENT":false}'::jsonb),
    ('view_audit_log', '{"AR-SUPER":true,"AR-VEND":true,"AR-FIN":true,"AR-IT":true,"AR-HR":true,"AR-VIEW":false,"AR-ENT":true}'::jsonb),
    ('export_data', '{"AR-SUPER":true,"AR-VEND":true,"AR-FIN":true,"AR-IT":true,"AR-HR":false,"AR-VIEW":true,"AR-ENT":true}'::jsonb)
) as p(key, bits)
on conflict (admin_role_id, permission_key) do update set
  allowed = excluded.allowed;

create table if not exists public.vm_admin_users (
  id text primary key,
  display_name text not null,
  email text not null unique,
  emp_id text references public.vm_employees(id) on delete set null,
  admin_role_id text not null references public.vm_admin_roles(id),
  entity_scope text not null default 'ALL',
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  mfa_enrolled boolean not null default false,
  last_login_at timestamptz,
  notes text,
  os_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vm_audit_events (
  id uuid primary key default gen_random_uuid(),
  ts_utc timestamptz not null default now(),
  actor_admin_id text,
  actor_email text,
  action text not null,
  entity_id text,
  object_type text not null,
  object_id text,
  field text,
  old_value text,
  new_value text,
  ip_hash text,
  prev_hash text,
  event_hash text
);

create index if not exists vm_audit_events_ts_idx
  on public.vm_audit_events (ts_utc desc);

-- ---------------------------------------------------------------------------
-- RLS helpers + policies
-- ---------------------------------------------------------------------------
alter table public.vm_entity_codes enable row level security;
alter table public.vm_entity_module_enablement enable row level security;
alter table public.vm_settings enable row level security;
alter table public.vm_fx_rates enable row level security;
alter table public.vm_cost_centers enable row level security;
alter table public.vm_vendors enable row level security;
alter table public.vm_vendor_profiles enable row level security;
alter table public.vm_vendors_history enable row level security;
alter table public.vm_products enable row level security;
alter table public.vm_roles enable row level security;
alter table public.vm_role_products enable row level security;
alter table public.vm_employees enable row level security;
alter table public.vm_entitlements enable row level security;
alter table public.vm_comp_bands enable row level security;
alter table public.vm_access_requests enable row level security;
alter table public.vm_renewals enable row level security;
alter table public.vm_budgets enable row level security;
alter table public.vm_lifecycle_templates enable row level security;
alter table public.vm_lifecycle_cases enable row level security;
alter table public.vm_lifecycle_case_tasks enable row level security;
alter table public.vm_usage_signals enable row level security;
alter table public.vm_chargeback_rules enable row level security;
alter table public.vm_revenue_inputs enable row level security;
alter table public.vm_alert_rules enable row level security;
alter table public.vm_alert_events enable row level security;
alter table public.vm_integrations enable row level security;
alter table public.vm_admin_roles enable row level security;
alter table public.vm_admin_permissions enable row level security;
alter table public.vm_admin_users enable row level security;
alter table public.vm_audit_events enable row level security;

-- Catalog / settings: authenticated read
do $$
declare
  t text;
begin
  foreach t in array array[
    'vm_entity_codes', 'vm_settings', 'vm_fx_rates', 'vm_lifecycle_templates',
    'vm_alert_rules', 'vm_admin_roles', 'vm_admin_permissions'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_select', t
    );
  end loop;
end $$;

-- Entity-scoped tables
do $$
declare
  t text;
begin
  foreach t in array array[
    'vm_entity_module_enablement', 'vm_cost_centers', 'vm_vendors',
    'vm_vendor_profiles', 'vm_vendors_history', 'vm_roles', 'vm_employees',
    'vm_comp_bands', 'vm_renewals', 'vm_budgets', 'vm_lifecycle_cases',
    'vm_revenue_inputs', 'vm_alert_events'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (
         public.is_firm_wide_access() or public.can_access_entity(entity_id)
       )',
      t || '_select', t
    );
    execute format(
      'create policy %I on public.%I for all to authenticated using (
         public.is_firm_wide_access()
       ) with check (
         public.is_firm_wide_access()
       )',
      t || '_write', t
    );
  end loop;
end $$;

-- Products: scope via entity_scope text ALL|entity_id
drop policy if exists vm_products_select on public.vm_products;
drop policy if exists vm_products_write on public.vm_products;
create policy vm_products_select on public.vm_products for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_scope = 'ALL'
    or public.can_access_entity(entity_scope)
  );
create policy vm_products_write on public.vm_products for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

drop policy if exists vm_role_products_select on public.vm_role_products;
drop policy if exists vm_role_products_write on public.vm_role_products;
create policy vm_role_products_select on public.vm_role_products for select to authenticated
  using (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.vm_roles r
      where r.id = role_id and public.can_access_entity(r.entity_id)
    )
  );
create policy vm_role_products_write on public.vm_role_products for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

drop policy if exists vm_entitlements_select on public.vm_entitlements;
drop policy if exists vm_entitlements_write on public.vm_entitlements;
create policy vm_entitlements_select on public.vm_entitlements for select to authenticated
  using (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.vm_employees e
      where e.id = emp_id and public.can_access_entity(e.entity_id)
    )
  );
create policy vm_entitlements_write on public.vm_entitlements for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

drop policy if exists vm_access_requests_select on public.vm_access_requests;
drop policy if exists vm_access_requests_write on public.vm_access_requests;
create policy vm_access_requests_select on public.vm_access_requests for select to authenticated
  using (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.vm_employees e
      where e.id = emp_id and public.can_access_entity(e.entity_id)
    )
  );
create policy vm_access_requests_write on public.vm_access_requests for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

drop policy if exists vm_lifecycle_case_tasks_select on public.vm_lifecycle_case_tasks;
drop policy if exists vm_lifecycle_case_tasks_write on public.vm_lifecycle_case_tasks;
create policy vm_lifecycle_case_tasks_select on public.vm_lifecycle_case_tasks for select to authenticated
  using (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.vm_lifecycle_cases c
      where c.id = case_id and public.can_access_entity(c.entity_id)
    )
  );
create policy vm_lifecycle_case_tasks_write on public.vm_lifecycle_case_tasks for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

drop policy if exists vm_usage_signals_select on public.vm_usage_signals;
drop policy if exists vm_usage_signals_write on public.vm_usage_signals;
create policy vm_usage_signals_select on public.vm_usage_signals for select to authenticated
  using (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.vm_employees e
      where e.id = emp_id and public.can_access_entity(e.entity_id)
    )
  );
create policy vm_usage_signals_write on public.vm_usage_signals for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

drop policy if exists vm_chargeback_rules_select on public.vm_chargeback_rules;
drop policy if exists vm_chargeback_rules_write on public.vm_chargeback_rules;
create policy vm_chargeback_rules_select on public.vm_chargeback_rules for select to authenticated
  using (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.vm_vendors v
      where v.id = vendor_id and public.can_access_entity(v.entity_id)
    )
  );
create policy vm_chargeback_rules_write on public.vm_chargeback_rules for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

drop policy if exists vm_integrations_select on public.vm_integrations;
drop policy if exists vm_integrations_write on public.vm_integrations;
create policy vm_integrations_select on public.vm_integrations for select to authenticated
  using (true);
create policy vm_integrations_write on public.vm_integrations for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

drop policy if exists vm_admin_users_select on public.vm_admin_users;
drop policy if exists vm_admin_users_write on public.vm_admin_users;
create policy vm_admin_users_select on public.vm_admin_users for select to authenticated
  using (public.is_firm_wide_access());
create policy vm_admin_users_write on public.vm_admin_users for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

drop policy if exists vm_audit_events_select on public.vm_audit_events;
create policy vm_audit_events_select on public.vm_audit_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
-- append-only via service role / persist client; no authenticated insert grant

grant select on public.vm_entity_codes to authenticated;
grant select on public.vm_settings to authenticated;
grant select on public.vm_fx_rates to authenticated;
grant select on public.vm_lifecycle_templates to authenticated;
grant select on public.vm_alert_rules to authenticated;
grant select on public.vm_admin_roles to authenticated;
grant select on public.vm_admin_permissions to authenticated;
grant select on public.vm_integrations to authenticated;

grant select, insert, update on public.vm_entity_module_enablement to authenticated;
grant select, insert, update on public.vm_cost_centers to authenticated;
grant select, insert, update on public.vm_vendors to authenticated;
grant select, insert, update on public.vm_vendor_profiles to authenticated;
grant select, insert on public.vm_vendors_history to authenticated;
grant select, insert, update on public.vm_products to authenticated;
grant select, insert, update on public.vm_roles to authenticated;
grant select, insert, update, delete on public.vm_role_products to authenticated;
grant select, insert, update on public.vm_employees to authenticated;
grant select, insert, update, delete on public.vm_entitlements to authenticated;
grant select, insert, update on public.vm_comp_bands to authenticated;
grant select, insert, update on public.vm_access_requests to authenticated;
grant select, insert, update on public.vm_renewals to authenticated;
grant select, insert, update on public.vm_budgets to authenticated;
grant select, insert, update on public.vm_lifecycle_cases to authenticated;
grant select, insert, update on public.vm_lifecycle_case_tasks to authenticated;
grant select, insert, update on public.vm_usage_signals to authenticated;
grant select, insert, update on public.vm_chargeback_rules to authenticated;
grant select, insert, update on public.vm_revenue_inputs to authenticated;
grant select, insert, update on public.vm_alert_events to authenticated;
grant select, insert, update on public.vm_admin_users to authenticated;
grant select on public.vm_audit_events to authenticated;
