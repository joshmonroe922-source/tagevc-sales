-- Phase 97: Identity + Device Lifecycle (P0–P8 foundation)
-- Spreadsheet SoT: Technology Onboarding Process - Provisioning.xlsx
-- Extends HRIS (SS§12), Vendor Management, SS§9 IT assets, UDL FO§23.
-- Additive. Safe to re-run. No shadow people/asset stores.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Entities registry (FO §24 / multi-entity identity bootstrap)
-- ---------------------------------------------------------------------------
alter table public.entities
  add column if not exists entra_au_id text,
  add column if not exists intune_scope_tag text,
  add column if not exists email_domain text,
  add column if not exists abm_location_id text,
  add column if not exists default_usage_location text default 'US',
  add column if not exists byod_allowed boolean not null default true,
  add column if not exists identity_bootstrap_status text
    default 'not_started';

do $$ begin
  alter table public.entities
    drop constraint if exists entities_identity_bootstrap_status_check;
  alter table public.entities
    add constraint entities_identity_bootstrap_status_check
    check (
      identity_bootstrap_status is null
      or identity_bootstrap_status in (
        'not_started', 'in_progress', 'ready', 'needs_human', 'failed'
      )
    );
exception when others then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. HRIS employees — identity + dual device path (sheet 04 / 17)
-- ---------------------------------------------------------------------------
alter table public.os_hris_employees
  add column if not exists entra_object_id text,
  add column if not exists upn text,
  add column if not exists identity_status text not null default 'not_provisioned',
  add column if not exists primary_role_id text,
  add column if not exists secondary_role_ids text[] not null default '{}',
  add column if not exists device_preference text,
  add column if not exists device_ownership text not null default 'unset',
  add column if not exists byod_enforcement_level text,
  add column if not exists employment_type text not null default 'FTE',
  add column if not exists job_title text not null default '',
  add column if not exists cost_center text,
  add column if not exists legal_first_name text,
  add column if not exists legal_last_name text,
  add column if not exists preferred_name text,
  add column if not exists country text default 'US',
  add column if not exists vm_employee_id text;

do $$ begin
  alter table public.os_hris_employees
    drop constraint if exists os_hris_identity_status_check;
  alter table public.os_hris_employees
    add constraint os_hris_identity_status_check
    check (identity_status in (
      'not_provisioned', 'pending', 'enabled', 'disabled', 'pending_delete'
    ));

  alter table public.os_hris_employees
    drop constraint if exists os_hris_device_ownership_check;
  alter table public.os_hris_employees
    add constraint os_hris_device_ownership_check
    check (device_ownership in (
      'unset', 'company_owned', 'personal_byod'
    ));

  alter table public.os_hris_employees
    drop constraint if exists os_hris_device_preference_check;
  alter table public.os_hris_employees
    add constraint os_hris_device_preference_check
    check (
      device_preference is null
      or device_preference in ('windows', 'macos', 'ios', 'android', 'none')
    );

  alter table public.os_hris_employees
    drop constraint if exists os_hris_byod_enforcement_check;
  alter table public.os_hris_employees
    add constraint os_hris_byod_enforcement_check
    check (
      byod_enforcement_level is null
      or byod_enforcement_level in (
        'mam_only', 'mam_plus_optional_mdm', 'mdm_required_exception'
      )
    );

  alter table public.os_hris_employees
    drop constraint if exists os_hris_employment_type_check;
  alter table public.os_hris_employees
    add constraint os_hris_employment_type_check
    check (employment_type in ('FTE', 'intern', 'contractor'));
exception when others then null;
end $$;

create unique index if not exists os_hris_employees_entra_oid_uidx
  on public.os_hris_employees (entra_object_id)
  where entra_object_id is not null;

create index if not exists os_hris_employees_ownership_idx
  on public.os_hris_employees (entity_id, device_ownership, identity_status);

-- ---------------------------------------------------------------------------
-- 3. Vendor Management extensions (products / roles / birthright / cases)
-- ---------------------------------------------------------------------------
alter table public.vm_products
  add column if not exists supports_byod boolean not null default true,
  add column if not exists byod_method text,
  add column if not exists provision_method text not null default 'manual',
  add column if not exists scim_endpoint text,
  add column if not exists entra_group_id text,
  add column if not exists license_sku_id text;

do $$ begin
  alter table public.vm_products drop constraint if exists vm_products_byod_method_check;
  alter table public.vm_products
    add constraint vm_products_byod_method_check
    check (
      byod_method is null
      or byod_method in (
        'mam_app_protection', 'sso_only', 'intune_app_required', 'not_supported'
      )
    );
  alter table public.vm_products drop constraint if exists vm_products_provision_method_check;
  alter table public.vm_products
    add constraint vm_products_provision_method_check
    check (provision_method in (
      'manual', 'entra_group', 'scim', 'graph_license', 'webhook'
    ));
exception when others then null;
end $$;

alter table public.vm_roles
  add column if not exists byod_allowed boolean not null default true;

alter table public.vm_role_products
  add column if not exists entity_id text,
  add column if not exists priority int not null default 100,
  add column if not exists byod_allowed boolean not null default true;

alter table public.vm_entitlements
  add column if not exists entity_id text,
  add column if not exists correlation_id uuid,
  add column if not exists provision_status text not null default 'planned';

do $$ begin
  alter table public.vm_entitlements
    drop constraint if exists vm_entitlements_provision_status_check;
  alter table public.vm_entitlements
    add constraint vm_entitlements_provision_status_check
    check (provision_status in (
      'planned', 'queued', 'provisioned', 'failed', 'revoked'
    ));
exception when others then null;
end $$;

-- Expand lifecycle case event + identity columns (sheet 17 §3)
alter table public.vm_lifecycle_cases
  add column if not exists case_type text,
  add column if not exists correlation_id uuid,
  add column if not exists kit_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists it_offboard_gate text,
  add column if not exists device_path text,
  add column if not exists effective_at timestamptz,
  add column if not exists hris_employee_id uuid,
  add column if not exists hris_event_id uuid,
  add column if not exists steps jsonb not null default '[]'::jsonb,
  add column if not exists last_error text;

do $$ begin
  -- Widen event check to include identity case types (aliases map in app)
  alter table public.vm_lifecycle_cases drop constraint if exists vm_lifecycle_cases_event_check;
  alter table public.vm_lifecycle_cases
    add constraint vm_lifecycle_cases_event_check
    check (event in (
      'Onboard', 'Offboard', 'Transfer',
      'joiner', 'mover', 'leaver', 'device_recover', 'app_request', 'cancelled_hire'
    ));

  alter table public.vm_lifecycle_cases drop constraint if exists vm_lifecycle_cases_case_type_check;
  alter table public.vm_lifecycle_cases
    add constraint vm_lifecycle_cases_case_type_check
    check (
      case_type is null
      or case_type in (
        'joiner', 'mover', 'leaver', 'device_recover', 'app_request', 'cancelled_hire'
      )
    );

  alter table public.vm_lifecycle_cases drop constraint if exists vm_lifecycle_cases_gate_check;
  alter table public.vm_lifecycle_cases
    add constraint vm_lifecycle_cases_gate_check
    check (
      it_offboard_gate is null
      or it_offboard_gate in ('pending', 'passed', 'held')
    );

  alter table public.vm_lifecycle_cases drop constraint if exists vm_lifecycle_cases_device_path_check;
  alter table public.vm_lifecycle_cases
    add constraint vm_lifecycle_cases_device_path_check
    check (
      device_path is null
      or device_path in ('company_mdm', 'byod_mam', 'byod_mam_mdm', 'none')
    );

  alter table public.vm_lifecycle_cases drop constraint if exists vm_lifecycle_cases_status_check;
  alter table public.vm_lifecycle_cases
    add constraint vm_lifecycle_cases_status_check
    check (status in (
      'Planned', 'In Progress', 'Complete',
      'needs_human', 'failed', 'cancelled'
    ));
exception when others then null;
end $$;

create index if not exists vm_lifecycle_cases_corr_idx
  on public.vm_lifecycle_cases (correlation_id)
  where correlation_id is not null;
create index if not exists vm_lifecycle_cases_hris_idx
  on public.vm_lifecycle_cases (hris_employee_id)
  where hris_employee_id is not null;
create index if not exists vm_lifecycle_cases_entity_status_idx
  on public.vm_lifecycle_cases (entity_id, status, created_at desc);

-- Identity step child table (sheet 17)
create table if not exists public.vm_lifecycle_case_steps (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references public.vm_lifecycle_cases(id) on delete cascade,
  entity_id text not null references public.entities(entity_id),
  step_key text not null,
  status text not null default 'pending'
    check (status in (
      'pending', 'queued', 'running', 'succeeded', 'failed',
      'skipped', 'needs_human', 'blocked'
    )),
  attempts int not null default 0,
  last_error text,
  idempotency_key text,
  worker text,
  started_at timestamptz,
  finished_at timestamptz,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (case_id, step_key)
);

create index if not exists vm_lifecycle_case_steps_status_idx
  on public.vm_lifecycle_case_steps (entity_id, status, updated_at desc);

alter table public.vm_lifecycle_case_steps enable row level security;

drop policy if exists vm_lifecycle_case_steps_select on public.vm_lifecycle_case_steps;
create policy vm_lifecycle_case_steps_select on public.vm_lifecycle_case_steps
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

drop policy if exists vm_lifecycle_case_steps_write on public.vm_lifecycle_case_steps;
create policy vm_lifecycle_case_steps_write on public.vm_lifecycle_case_steps
  for all to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  )
  with check (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

revoke all on public.vm_lifecycle_case_steps from public, anon;
grant select, insert, update on public.vm_lifecycle_case_steps to authenticated;

-- ---------------------------------------------------------------------------
-- 4. SS§9 hardware — company-owned path only (sheet 06 / 17)
-- ---------------------------------------------------------------------------
alter table public.os_it_hardware_assets
  add column if not exists device_ownership text not null default 'company_owned',
  add column if not exists enrollment_type text,
  add column if not exists autopilot_profile_id text,
  add column if not exists ade_profile_id text,
  add column if not exists intune_device_id text,
  add column if not exists entra_device_id text,
  add column if not exists compliance_state text,
  add column if not exists hris_employee_id uuid,
  add column if not exists correlation_id uuid;

do $$ begin
  alter table public.os_it_hardware_assets
    drop constraint if exists os_it_hw_device_ownership_check;
  alter table public.os_it_hardware_assets
    add constraint os_it_hw_device_ownership_check
    check (device_ownership in ('company_owned'));

  alter table public.os_it_hardware_assets
    drop constraint if exists os_it_hw_enrollment_type_check;
  alter table public.os_it_hardware_assets
    add constraint os_it_hw_enrollment_type_check
    check (
      enrollment_type is null
      or enrollment_type in (
        'autopilot', 'ade', 'manual_mdm', 'company_portal', 'unknown'
      )
    );
exception when others then null;
end $$;

create table if not exists public.os_it_asset_assignments (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities(entity_id),
  asset_id text not null,
  hris_employee_id uuid,
  profile_user_id uuid,
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  correlation_id uuid,
  reason text,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists os_it_asset_assignments_entity_idx
  on public.os_it_asset_assignments (entity_id, assigned_at desc);
create index if not exists os_it_asset_assignments_emp_idx
  on public.os_it_asset_assignments (hris_employee_id)
  where hris_employee_id is not null;

alter table public.os_it_asset_assignments enable row level security;

drop policy if exists os_it_asset_assignments_select on public.os_it_asset_assignments;
create policy os_it_asset_assignments_select on public.os_it_asset_assignments
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

drop policy if exists os_it_asset_assignments_write on public.os_it_asset_assignments;
create policy os_it_asset_assignments_write on public.os_it_asset_assignments
  for all to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  )
  with check (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

revoke all on public.os_it_asset_assignments from public, anon;
grant select, insert, update on public.os_it_asset_assignments to authenticated;

-- ---------------------------------------------------------------------------
-- 5. BYOD registrations (sheet 07b / 17) — NOT hardware assets
-- ---------------------------------------------------------------------------
create table if not exists public.byod_registrations (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities(entity_id),
  employee_id uuid not null
    references public.os_hris_employees(id) on delete cascade,
  platform text
    check (
      platform is null
      or platform in ('windows', 'macos', 'ios', 'android', 'unknown')
    ),
  enrollment_type text not null default 'mam_only'
    check (enrollment_type in (
      'mam_only', 'company_portal_personal', 'mdm_required_exception'
    )),
  intune_device_id text,
  app_protection_status text not null default 'unknown'
    check (app_protection_status in (
      'unknown', 'pending', 'protected', 'unprotected', 'wiped', 'error'
    )),
  status text not null default 'pending_first_sign_in'
    check (status in (
      'pending_first_sign_in', 'protected', 'mdm_enrolled',
      'wipe_pending', 'wiped_company_data', 'retired'
    )),
  last_sync_at timestamptz,
  correlation_id uuid,
  case_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists byod_registrations_entity_idx
  on public.byod_registrations (entity_id, status);
create index if not exists byod_registrations_employee_idx
  on public.byod_registrations (employee_id, created_at desc);
create index if not exists byod_registrations_corr_idx
  on public.byod_registrations (correlation_id)
  where correlation_id is not null;

alter table public.byod_registrations enable row level security;

drop policy if exists byod_registrations_select on public.byod_registrations;
create policy byod_registrations_select on public.byod_registrations
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

drop policy if exists byod_registrations_write on public.byod_registrations;
create policy byod_registrations_write on public.byod_registrations
  for all to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  )
  with check (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

revoke all on public.byod_registrations from public, anon;
grant select, insert, update on public.byod_registrations to authenticated;

create or replace function public.set_byod_registrations_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists byod_registrations_updated_at on public.byod_registrations;
create trigger byod_registrations_updated_at
  before update on public.byod_registrations
  for each row execute function public.set_byod_registrations_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Day-1 kit policies (sheet 09)
-- ---------------------------------------------------------------------------
create table if not exists public.day1_kit_policies (
  id uuid primary key default gen_random_uuid(),
  entity_id text references public.entities(entity_id),
  role_id text,
  device_ownership text not null default 'company_owned'
    check (device_ownership in ('company_owned', 'personal_byod', 'any')),
  device_preference text
    check (
      device_preference is null
      or device_preference in ('windows', 'macos', 'ios', 'android', 'none', 'any')
    ),
  byod_enforcement_level text
    check (
      byod_enforcement_level is null
      or byod_enforcement_level in (
        'mam_only', 'mam_plus_optional_mdm', 'mdm_required_exception'
      )
    ),
  kit jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  priority int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists day1_kit_policies_lookup_idx
  on public.day1_kit_policies (entity_id, role_id, device_ownership, active);

alter table public.day1_kit_policies enable row level security;

drop policy if exists day1_kit_policies_select on public.day1_kit_policies;
create policy day1_kit_policies_select on public.day1_kit_policies
  for select to authenticated
  using (
    entity_id is null
    or public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

drop policy if exists day1_kit_policies_write on public.day1_kit_policies;
create policy day1_kit_policies_write on public.day1_kit_policies
  for all to authenticated
  using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  )
  with check (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );

revoke all on public.day1_kit_policies from public, anon;
grant select, insert, update on public.day1_kit_policies to authenticated;

insert into public.day1_kit_policies
  (entity_id, role_id, device_ownership, byod_enforcement_level, kit, priority)
values
  (null, null, 'company_owned', null,
   '{"path":"company_mdm","hardware":true,"welcome":"company"}'::jsonb, 1000),
  (null, null, 'personal_byod', 'mam_only',
   '{"path":"byod_mam","hardware":false,"welcome":"byod"}'::jsonb, 1000)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 7. Integration idempotency + job queue (sheet 18)
-- ---------------------------------------------------------------------------
create table if not exists public.integration_idempotency (
  idempotency_key text primary key,
  request_hash text,
  response_ref jsonb,
  entity_id text not null references public.entities(entity_id),
  correlation_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index if not exists integration_idempotency_entity_idx
  on public.integration_idempotency (entity_id, created_at desc);

alter table public.integration_idempotency enable row level security;

drop policy if exists integration_idempotency_select on public.integration_idempotency;
create policy integration_idempotency_select on public.integration_idempotency
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

revoke all on public.integration_idempotency from public, anon;
grant select, insert, update on public.integration_idempotency to authenticated;

-- HRIS → bus outbox (events only; Technology never invents hire/term)
create table if not exists public.identity_hris_outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique,
  event_type text not null
    check (event_type in (
      'hris.employee.hired',
      'hris.employee.updated',
      'hris.employee.role_changed',
      'hris.employee.terminated',
      'hris.employee.rehire',
      'hris.employee.cancelled_hire'
    )),
  event_time timestamptz not null default now(),
  correlation_id uuid not null,
  entity_id text not null references public.entities(entity_id),
  producer text not null default 'hris',
  schema_version text not null default '1.0.0',
  idempotency_key text not null unique,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in (
      'pending', 'processing', 'completed', 'failed', 'dead_letter'
    )),
  attempts int not null default 0,
  last_error text,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists identity_hris_outbox_drain_idx
  on public.identity_hris_outbox (status, available_at)
  where status in ('pending', 'failed');

alter table public.identity_hris_outbox enable row level security;

drop policy if exists identity_hris_outbox_select on public.identity_hris_outbox;
create policy identity_hris_outbox_select on public.identity_hris_outbox
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

drop policy if exists identity_hris_outbox_write on public.identity_hris_outbox;
create policy identity_hris_outbox_write on public.identity_hris_outbox
  for all to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  )
  with check (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

revoke all on public.identity_hris_outbox from public, anon;
grant select, insert, update on public.identity_hris_outbox to authenticated;

-- Worker command queue
create table if not exists public.identity_worker_jobs (
  id uuid primary key default gen_random_uuid(),
  command text not null,
  entity_id text not null references public.entities(entity_id),
  employee_id uuid,
  case_id text,
  correlation_id uuid not null,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  priority int not null default 100,
  status text not null default 'queued'
    check (status in (
      'queued', 'leased', 'succeeded', 'failed', 'dead_letter', 'blocked'
    )),
  attempts int not null default 0,
  max_attempts int not null default 7,
  lease_owner text,
  lease_until timestamptz,
  last_error text,
  result jsonb,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists identity_worker_jobs_drain_idx
  on public.identity_worker_jobs (status, priority, available_at)
  where status in ('queued', 'failed');
create index if not exists identity_worker_jobs_corr_idx
  on public.identity_worker_jobs (correlation_id);

alter table public.identity_worker_jobs enable row level security;

drop policy if exists identity_worker_jobs_select on public.identity_worker_jobs;
create policy identity_worker_jobs_select on public.identity_worker_jobs
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

revoke all on public.identity_worker_jobs from public, anon;
grant select, insert, update on public.identity_worker_jobs to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Identity metrics + activity (sheet 13 / 15)
-- ---------------------------------------------------------------------------
create table if not exists public.identity_metrics (
  id uuid primary key default gen_random_uuid(),
  metric_name text not null,
  metric_value_num numeric,
  metric_value_json jsonb,
  entity_id text not null references public.entities(entity_id),
  employee_id uuid,
  case_id text,
  recorded_at timestamptz not null default now()
);

create index if not exists identity_metrics_entity_idx
  on public.identity_metrics (entity_id, metric_name, recorded_at desc);

alter table public.identity_metrics enable row level security;

drop policy if exists identity_metrics_select on public.identity_metrics;
create policy identity_metrics_select on public.identity_metrics
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

revoke all on public.identity_metrics from public, anon;
grant select, insert on public.identity_metrics to authenticated;

create table if not exists public.identity_activity_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid,
  worker text not null,
  duration_ms int,
  graph_request_id text,
  retry_count int not null default 0,
  entity_id text not null references public.entities(entity_id),
  correlation_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists identity_activity_events_corr_idx
  on public.identity_activity_events (correlation_id, created_at desc);

alter table public.identity_activity_events enable row level security;

drop policy if exists identity_activity_events_select on public.identity_activity_events;
create policy identity_activity_events_select on public.identity_activity_events
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

revoke all on public.identity_activity_events from public, anon;
grant select, insert on public.identity_activity_events to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Audit extensions (sheet 13) — columns on os_audit_events via metadata
--    Plus dedicated identity_audit_events for worker-correlated append log
-- ---------------------------------------------------------------------------
alter table public.os_audit_events
  add column if not exists employee_id uuid,
  add column if not exists correlation_id uuid,
  add column if not exists case_id text,
  add column if not exists result text,
  add column if not exists source_system text,
  add column if not exists error_code text,
  add column if not exists before_json jsonb,
  add column if not exists after_json jsonb;

create index if not exists os_audit_events_corr_idx
  on public.os_audit_events (correlation_id)
  where correlation_id is not null;
create index if not exists os_audit_events_employee_idx
  on public.os_audit_events (employee_id, created_at desc)
  where employee_id is not null;

-- ---------------------------------------------------------------------------
-- 10. Remote Help sessions — attended only (sheet 12)
-- ---------------------------------------------------------------------------
create table if not exists public.identity_remote_help_sessions (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities(entity_id),
  employee_id uuid,
  helper_profile_id uuid,
  device_ref text,
  mode text not null default 'attended'
    check (mode = 'attended'),
  consent_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  status text not null default 'requested'
    check (status in (
      'requested', 'consent_pending', 'active', 'ended', 'cancelled', 'denied'
    )),
  notes text,
  correlation_id uuid,
  created_at timestamptz not null default now()
);

alter table public.identity_remote_help_sessions enable row level security;

drop policy if exists identity_rh_select on public.identity_remote_help_sessions;
create policy identity_rh_select on public.identity_remote_help_sessions
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

drop policy if exists identity_rh_write on public.identity_remote_help_sessions;
create policy identity_rh_write on public.identity_remote_help_sessions
  for all to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  )
  with check (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

revoke all on public.identity_remote_help_sessions from public, anon;
grant select, insert, update on public.identity_remote_help_sessions to authenticated;

-- ---------------------------------------------------------------------------
-- 11. FO §24 new-entity identity bootstrap checklist
-- ---------------------------------------------------------------------------
create table if not exists public.identity_entity_bootstrap_tasks (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities(entity_id),
  fo24_phase text not null
    check (fo24_phase in ('4', '5', '7', '8')),
  task_key text not null,
  title text not null,
  status text not null default 'pending'
    check (status in (
      'pending', 'in_progress', 'done', 'needs_human', 'skipped', 'failed'
    )),
  detail jsonb not null default '{}'::jsonb,
  correlation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, task_key)
);

alter table public.identity_entity_bootstrap_tasks enable row level security;

drop policy if exists identity_bootstrap_select on public.identity_entity_bootstrap_tasks;
create policy identity_bootstrap_select on public.identity_entity_bootstrap_tasks
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

drop policy if exists identity_bootstrap_write on public.identity_entity_bootstrap_tasks;
create policy identity_bootstrap_write on public.identity_entity_bootstrap_tasks
  for all to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  )
  with check (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

revoke all on public.identity_entity_bootstrap_tasks from public, anon;
grant select, insert, update on public.identity_entity_bootstrap_tasks to authenticated;

-- ---------------------------------------------------------------------------
-- 12. RPCs: claim jobs, wipe guard helper, control center
-- ---------------------------------------------------------------------------
create or replace function public.claim_identity_worker_jobs(
  p_worker_id text,
  p_commands text[] default null,
  p_limit int default 5,
  p_lease_seconds int default 60
)
returns setof public.identity_worker_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with cte as (
    select j.id
    from public.identity_worker_jobs j
    where j.status in ('queued', 'failed')
      and j.available_at <= now()
      and j.attempts < j.max_attempts
      and (p_commands is null or j.command = any(p_commands))
    order by j.priority asc, j.available_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 5), 25))
  )
  update public.identity_worker_jobs j
  set status = 'leased',
      lease_owner = p_worker_id,
      lease_until = now() + make_interval(secs => greatest(15, least(coalesce(p_lease_seconds, 60), 300))),
      attempts = j.attempts + 1,
      updated_at = now()
  from cte
  where j.id = cte.id
  returning j.*;
end;
$$;

create or replace function public.finish_identity_worker_job(
  p_job_id uuid,
  p_worker_id text,
  p_ok boolean,
  p_result jsonb default null,
  p_error text default null,
  p_dead_letter boolean default false
)
returns public.identity_worker_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.identity_worker_jobs;
begin
  update public.identity_worker_jobs
  set status = case
        when p_ok then 'succeeded'
        when p_dead_letter or attempts >= max_attempts then 'dead_letter'
        else 'failed'
      end,
      result = coalesce(p_result, result),
      last_error = case when p_ok then null else coalesce(p_error, last_error) end,
      lease_owner = null,
      lease_until = null,
      available_at = case
        when p_ok then available_at
        else now() + make_interval(secs => least(900, (2 ^ least(attempts, 6)) * 5))
      end,
      updated_at = now()
  where id = p_job_id
    and lease_owner = p_worker_id
  returning * into v_row;

  return v_row;
end;
$$;

-- Hard wipe guard (sheet 07b G-BYOD-WIPE) — callable from workers
create or replace function public.identity_assert_wipe_allowed(
  p_employee_id uuid,
  p_enrollment_type text default null,
  p_device_ownership text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ownership text;
  v_enrollment text := p_enrollment_type;
begin
  if p_device_ownership is not null then
    v_ownership := p_device_ownership;
  elsif p_employee_id is not null then
    select device_ownership into v_ownership
    from public.os_hris_employees
    where id = p_employee_id;
  end if;

  if v_ownership = 'personal_byod'
     or v_enrollment in ('mam_only', 'company_portal_personal') then
    return jsonb_build_object(
      'allowed', false,
      'code', 'byod_wipe_blocked',
      'reason', 'Full wipe forbidden for personal_byod / MAM enrollment'
    );
  end if;

  return jsonb_build_object('allowed', true, 'code', 'ok');
end;
$$;

create or replace function public.list_identity_lifecycle_control_center(
  p_limit int default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  return jsonb_build_object(
    'ok', true,
    'contract_version', 'identity-device-v1',
    'money_auto_approve', false,
    'open_cases', (
      select count(*) from public.vm_lifecycle_cases
      where status in ('Planned', 'In Progress', 'needs_human')
    ),
    'byod_wipe_blocks', (
      select count(*) from public.os_audit_events
      where action = 'byod_wipe_blocked'
    ),
    'queued_jobs', (
      select count(*) from public.identity_worker_jobs
      where status in ('queued', 'failed')
    ),
    'dead_letter', (
      select count(*) from public.identity_worker_jobs
      where status = 'dead_letter'
    ),
    'cases', coalesce((
      select jsonb_agg(row_to_json(c)::jsonb order by c.created_at desc)
      from (
        select id, emp_id, event, case_type, entity_id, status,
               correlation_id, device_path, it_offboard_gate,
               hris_employee_id, effective_at, created_at, last_error
        from public.vm_lifecycle_cases
        order by created_at desc
        limit v_limit
      ) c
    ), '[]'::jsonb),
    'byod_registrations', coalesce((
      select jsonb_agg(row_to_json(b)::jsonb order by b.created_at desc)
      from (
        select id, entity_id, employee_id, platform, enrollment_type,
               status, app_protection_status, correlation_id, created_at
        from public.byod_registrations
        order by created_at desc
        limit v_limit
      ) b
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.claim_identity_worker_jobs(text, text[], int, int)
  to authenticated, service_role;
grant execute on function public.finish_identity_worker_job(uuid, text, boolean, jsonb, text, boolean)
  to authenticated, service_role;
grant execute on function public.identity_assert_wipe_allowed(uuid, text, text)
  to authenticated, service_role;
grant execute on function public.list_identity_lifecycle_control_center(int)
  to authenticated, service_role;

-- Widen template event check for identity case-type aliases
do $$ begin
  alter table public.vm_lifecycle_templates
    drop constraint if exists vm_lifecycle_templates_event_check;
  alter table public.vm_lifecycle_templates
    add constraint vm_lifecycle_templates_event_check
    check (event in (
      'Onboard', 'Offboard', 'Transfer',
      'joiner', 'mover', 'leaver', 'device_recover', 'app_request', 'cancelled_hire'
    ));
exception when others then null;
end $$;

-- Allow lifecycle cases to reference HRIS employees projected as vm_employees text ids
-- (orchestrator upserts vm_employees before insert). Keep FK when present.
do $$ begin
  alter table public.vm_lifecycle_cases
    drop constraint if exists vm_lifecycle_cases_emp_id_fkey;
exception when others then null;
end $$;

-- Widen template event check, then seed identity templates (dual-path aware)
do $$ begin
  alter table public.vm_lifecycle_templates
    drop constraint if exists vm_lifecycle_templates_event_check;
  alter table public.vm_lifecycle_templates
    add constraint vm_lifecycle_templates_event_check
    check (event in (
      'Onboard', 'Offboard', 'Transfer',
      'joiner', 'mover', 'leaver', 'device_recover', 'app_request', 'cancelled_hire'
    ));
exception when others then null;
end $$;

insert into public.vm_lifecycle_templates
  (id, event, phase, task, owner_role, sla_hours, sort_order)
values
  ('T-ID-J01', 'joiner', 'Pre-day1', 'Resolve device path + kit snapshot', 'AR-IT', 4, 1),
  ('T-ID-J02', 'joiner', 'Pre-day1', 'Entra user upsert + groups', 'AR-IT', 8, 2),
  ('T-ID-J03', 'joiner', 'Pre-day1', 'Materialize birthright entitlements', 'AR-IT', 8, 3),
  ('T-ID-J04', 'joiner', 'Pre-day1', 'Company device reserve OR BYOD MAM target', 'AR-IT', 48, 4),
  ('T-ID-J05', 'joiner', 'Pre-day1', 'Welcome / BYOD privacy notify', 'AR-IT', 4, 5),
  ('T-ID-J06', 'joiner', 'Day1', 'Verify productive access', 'AR-IT', 8, 6),
  ('T-ID-L01', 'leaver', 'Day0', 'Disable Entra + revoke sessions', 'AR-IT', 1, 1),
  ('T-ID-L02', 'leaver', 'Day0', 'Zero entitlements', 'AR-IT', 2, 2),
  ('T-ID-L03', 'leaver', 'Day0', 'Company wipe/recover OR BYOD selective wipe', 'AR-IT', 24, 3),
  ('T-ID-L04', 'leaver', 'Day0', 'IT offboard gate', 'AR-IT', 4, 4),
  ('T-ID-M01', 'mover', 'Day0', 'Birthright delta + group sync', 'AR-IT', 8, 1)
on conflict (id) do update set
  event = excluded.event,
  phase = excluded.phase,
  task = excluded.task,
  owner_role = excluded.owner_role,
  sla_hours = excluded.sla_hours,
  sort_order = excluded.sort_order;

-- Alert rules (sheet 19) — additive into vm_alert_rules when present
insert into public.vm_alert_rules
  (id, name, category, condition_logic, threshold, severity, channel, audience, enabled)
values
  ('ID_LEAVER_DISABLE_FAIL', 'Leaver disable SLA', 'Identity',
   'leaver disable not success within 10m of effective_at', 10, 'Critical', 'Pager',
   'Tech SS on-call + Security', true),
  ('ID_JOINER_BLOCKED', 'Joiner blocked', 'Identity',
   'joiner step failed >3 or age >24h pre-start', 24, 'High', 'Email+Slack',
   'Tech SS', true),
  ('ID_BYOD_WIPE_BLOCKED', 'BYOD full wipe blocked', 'Identity',
   'full wipe attempted on personal_byod', 1, 'Critical', 'Pager',
   'Security + Tech SS', true),
  ('ID_OWNERSHIP_MISSING', 'Missing device_ownership', 'Identity',
   'joiner without device_ownership', 1, 'High', 'Email+Slack',
   'HR + Tech SS', true),
  ('ID_DLQ_DEPTH', 'Identity DLQ depth', 'Identity',
   'DLQ count >0 for identity.* aged >30m', 30, 'High', 'Slack',
   'Tech SS', true),
  ('ID_BREAKGLASS_SIGNIN', 'Break-glass sign-in', 'Identity',
   'any break-glass sign-in', 1, 'Critical', 'Pager',
   'Security + CISO', true)
on conflict (id) do nothing;

-- FO §24 bootstrap task seed helper
create or replace function public.identity_seed_entity_bootstrap(p_entity_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_entity_id is null or p_entity_id !~ '^ENT-[A-Z0-9-]{1,32}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid entity_id');
  end if;

  insert into public.identity_entity_bootstrap_tasks
    (entity_id, fo24_phase, task_key, title, status)
  values
    (p_entity_id, '4', 'P4-ID-01', 'Register entity in UDL', 'done'),
    (p_entity_id, '4', 'P4-ID-02', 'Entra Administrative Unit', 'pending'),
    (p_entity_id, '4', 'P4-ID-04', 'Dynamic groups bootstrap', 'pending'),
    (p_entity_id, '4', 'P4-ID-05', 'Intune scope tag', 'pending'),
    (p_entity_id, '4', 'P4-ID-06', 'Autopilot/ADE profiles', 'pending'),
    (p_entity_id, '4', 'P4-ID-07', 'Email domain / DNS', 'pending'),
    (p_entity_id, '4', 'P4-ID-08', 'RLS enable + deny cross-read', 'pending'),
    (p_entity_id, '4', 'P4-BYOD-01', 'BYOD groups', 'pending'),
    (p_entity_id, '4', 'P4-BYOD-02', 'APP + CA BYOD', 'needs_human'),
    (p_entity_id, '5', 'P5-ID-01', 'Seed roles for entity', 'pending'),
    (p_entity_id, '5', 'P5-ID-02', 'Birthright matrix', 'pending'),
    (p_entity_id, '5', 'P5-ID-03', 'day1_kit_policies', 'pending'),
    (p_entity_id, '5', 'P5-ID-04', 'First hire dry-run', 'pending'),
    (p_entity_id, '5', 'P5-ID-05', 'Offboard dry-run', 'pending'),
    (p_entity_id, '5', 'P5-BYOD-01', 'Role byod_allowed', 'pending'),
    (p_entity_id, '5', 'P5-BYOD-02', 'BYOD dry-run', 'pending'),
    (p_entity_id, '7', 'P7-ID-01', 'Connect HRIS entity partition', 'pending'),
    (p_entity_id, '7', 'P7-BYOD-01', 'HRIS device_ownership required', 'pending'),
    (p_entity_id, '8', 'H-ID-01', 'All P4/P5/P7 ID tasks evidenced', 'pending'),
    (p_entity_id, '8', 'H-BYOD-01', 'BYOD privacy notice + wipe guard', 'pending')
  on conflict (entity_id, task_key) do nothing;

  update public.entities
  set identity_bootstrap_status = 'in_progress'
  where entity_id = p_entity_id
    and coalesce(identity_bootstrap_status, 'not_started') = 'not_started';

  return jsonb_build_object(
    'ok', true,
    'entity_id', p_entity_id,
    'tasks', (
      select count(*) from public.identity_entity_bootstrap_tasks
      where entity_id = p_entity_id
    )
  );
end;
$$;

grant execute on function public.identity_seed_entity_bootstrap(text)
  to authenticated, service_role;
