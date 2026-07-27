-- Phase 80: Verified First screening spine (packages + orders + RLS).
-- Additive. Safe to re-run. Does NOT touch os_store_snapshots or SSC tables.
-- Consumers: HRIS internal hires · Recruit placements · Signent (scaffold).

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Permission helpers
-- Visionary + HR/recruiting roles by entity; Recruit users for ENT-R619
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_screening(p_entity_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and (
        p.role in (
          'visionary', 'admin', 'coo', 'service_lead', 'counsel_ops',
          'partner', 'sub_lead'
        )
        or (
          p_entity_id = 'ENT-R619'
          and p.role in (
            'visionary', 'admin', 'partner', 'coo', 'sub_lead',
            'service_lead', 'counsel_ops'
          )
        )
      )
  );
$$;

create or replace function public.can_view_screening(p_entity_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and (
        public.can_manage_screening(p_entity_id)
        or (
          -- Recruit desk may view ENT-R619 placement/candidate orders
          p_entity_id = 'ENT-R619'
          and p.role in (
            'visionary', 'admin', 'partner', 'coo', 'sub_lead',
            'service_lead', 'counsel_ops', 'associate', 're_sourcer'
          )
        )
        or p.role in ('visionary', 'admin', 'coo', 'service_lead', 'counsel_ops')
      )
  );
$$;

grant execute on function public.can_manage_screening(text) to authenticated;
grant execute on function public.can_view_screening(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Packages (vendor catalog)
-- ---------------------------------------------------------------------------
create table if not exists public.os_screening_packages (
  id uuid primary key default gen_random_uuid(),
  vendor text not null default 'verified_first'
    check (vendor in ('verified_first')),
  code text not null
    check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  name text not null,
  kind text not null check (kind in ('bg', 'drug', 'combo')),
  description text not null default '',
  vendor_package_id text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vendor, code)
);

create index if not exists os_screening_packages_active_idx
  on public.os_screening_packages (vendor, active, kind);

alter table public.os_screening_packages enable row level security;

drop policy if exists os_screening_packages_select on public.os_screening_packages;
create policy os_screening_packages_select on public.os_screening_packages
  for select to authenticated
  using (true);

drop policy if exists os_screening_packages_write on public.os_screening_packages;
create policy os_screening_packages_write on public.os_screening_packages
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active = true
        and p.role in ('visionary', 'admin', 'coo', 'service_lead', 'counsel_ops')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.active = true
        and p.role in ('visionary', 'admin', 'coo', 'service_lead', 'counsel_ops')
    )
  );

revoke all on public.os_screening_packages from public, anon;
grant select, insert, update, delete on public.os_screening_packages to authenticated;

create or replace function public.set_os_screening_packages_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists os_screening_packages_updated_at on public.os_screening_packages;
create trigger os_screening_packages_updated_at
  before update on public.os_screening_packages
  for each row execute function public.set_os_screening_packages_updated_at();

-- Seed default packages (idempotent)
insert into public.os_screening_packages (vendor, code, name, kind, description)
values
  ('verified_first', 'vf-basic-bg', 'Verified First Basic Background', 'bg',
   'Standard criminal + identity background package'),
  ('verified_first', 'vf-standard-bg', 'Verified First Standard Background', 'bg',
   'Expanded background for client placements'),
  ('verified_first', 'vf-drug-5', 'Verified First 5-Panel Drug Screen', 'drug',
   'Standard 5-panel drug screen'),
  ('verified_first', 'vf-drug-10', 'Verified First 10-Panel Drug Screen', 'drug',
   'Expanded 10-panel drug screen'),
  ('verified_first', 'vf-combo-bg-drug', 'Verified First BG + Drug Combo', 'combo',
   'Combined background and drug screen')
on conflict (vendor, code) do update
  set name = excluded.name,
      kind = excluded.kind,
      description = excluded.description,
      active = true,
      updated_at = now();

-- ---------------------------------------------------------------------------
-- Optional entity defaults (internal hire packages)
-- ---------------------------------------------------------------------------
create table if not exists public.os_screening_entity_defaults (
  entity_id text primary key
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  default_bg_package_id uuid references public.os_screening_packages (id),
  default_drug_package_id uuid references public.os_screening_packages (id),
  default_combo_package_id uuid references public.os_screening_packages (id),
  requires_bg boolean not null default false,
  requires_drug_screen boolean not null default false,
  notes text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.os_screening_entity_defaults enable row level security;

drop policy if exists os_screening_entity_defaults_select on public.os_screening_entity_defaults;
create policy os_screening_entity_defaults_select on public.os_screening_entity_defaults
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

drop policy if exists os_screening_entity_defaults_write on public.os_screening_entity_defaults;
create policy os_screening_entity_defaults_write on public.os_screening_entity_defaults
  for all to authenticated
  using (
    public.can_manage_screening(entity_id)
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  )
  with check (
    public.can_manage_screening(entity_id)
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  );

revoke all on public.os_screening_entity_defaults from public, anon;
grant select, insert, update, delete on public.os_screening_entity_defaults to authenticated;

-- ---------------------------------------------------------------------------
-- Orders (system of record for all consumers)
-- ---------------------------------------------------------------------------
create table if not exists public.os_screening_orders (
  id uuid primary key default gen_random_uuid(),
  vendor text not null default 'verified_first'
    check (vendor in ('verified_first')),
  external_order_id text,
  subject_type text not null
    check (subject_type in (
      'employee', 'placement', 'candidate', 'signent_client_employee'
    )),
  subject_id text not null,
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  package_id uuid references public.os_screening_packages (id),
  package_code text not null default '',
  kind text not null check (kind in ('bg', 'drug', 'combo')),
  status text not null default 'pending'
    check (status in (
      'pending', 'ordered', 'in_progress', 'clear', 'review',
      'failed', 'cancelled', 'waived'
    )),
  ordered_by uuid references public.profiles (id),
  ordered_at timestamptz,
  completed_at timestamptz,
  report_storage_path text,
  raw_status text,
  last_sync_at timestamptz,
  consumer_ref jsonb not null default '{}'::jsonb
    check (jsonb_typeof(consumer_ref) = 'object'),
  confirm_token text,
  confirmed_at timestamptz,
  waiver_reason text,
  waived_by uuid references public.profiles (id),
  waived_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists os_screening_orders_external_uidx
  on public.os_screening_orders (vendor, external_order_id)
  where external_order_id is not null;

create index if not exists os_screening_orders_entity_idx
  on public.os_screening_orders (entity_id, status, created_at desc);

create index if not exists os_screening_orders_subject_idx
  on public.os_screening_orders (subject_type, subject_id, created_at desc);

create index if not exists os_screening_orders_consumer_placement_idx
  on public.os_screening_orders ((consumer_ref->>'placement_id'))
  where consumer_ref ? 'placement_id';

create index if not exists os_screening_orders_consumer_app_idx
  on public.os_screening_orders ((consumer_ref->>'application_id'))
  where consumer_ref ? 'application_id';

alter table public.os_screening_orders enable row level security;

drop policy if exists os_screening_orders_select on public.os_screening_orders;
create policy os_screening_orders_select on public.os_screening_orders
  for select to authenticated
  using (
    public.can_view_screening(entity_id)
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  );

drop policy if exists os_screening_orders_insert on public.os_screening_orders;
create policy os_screening_orders_insert on public.os_screening_orders
  for insert to authenticated
  with check (
    public.can_manage_screening(entity_id)
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  );

drop policy if exists os_screening_orders_update on public.os_screening_orders;
create policy os_screening_orders_update on public.os_screening_orders
  for update to authenticated
  using (
    public.can_manage_screening(entity_id)
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  )
  with check (
    public.can_manage_screening(entity_id)
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  );

revoke all on public.os_screening_orders from public, anon;
grant select, insert, update on public.os_screening_orders to authenticated;

create or replace function public.set_os_screening_orders_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists os_screening_orders_updated_at on public.os_screening_orders;
create trigger os_screening_orders_updated_at
  before update on public.os_screening_orders
  for each row execute function public.set_os_screening_orders_updated_at();

-- ---------------------------------------------------------------------------
-- Storage: screening-private/{entity_id}/…
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('screening-private', 'screening-private', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "screening_private_select" on storage.objects;
create policy "screening_private_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'screening-private'
    and public.can_view_screening(split_part(name, '/', 1))
  );

drop policy if exists "screening_private_insert" on storage.objects;
create policy "screening_private_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'screening-private'
    and public.can_manage_screening(split_part(name, '/', 1))
  );

-- ---------------------------------------------------------------------------
-- HRIS: expand system_hook for verified_first screening step
-- ---------------------------------------------------------------------------
alter table public.os_hris_process_template_steps
  drop constraint if exists os_hris_process_template_steps_system_hook_check;

alter table public.os_hris_process_template_steps
  add constraint os_hris_process_template_steps_system_hook_check
  check (
    system_hook is null
    or system_hook in (
      'manual', 'payroll', 'it_provision', 'asset_audit', 'benefits',
      'access_revoke', 'i9', 'handbook_ack', 'employment_contract',
      'compliance_ack', 'messaging_revoke', 'portal_revoke', 'ticketing_revoke',
      'knowledge_handoff', 'exit_interview',
      'graph_provision', 'mailbox_grant', 'docusign_send', 'document_vault',
      'verified_first', 'screening'
    )
  );

-- Add screening step to parent + recruit onboarding templates when present
insert into public.os_hris_process_template_steps (
  template_id, step_key, title, category, sort_order, owner_role,
  timing_anchor, offset_days, evidence_required, automation, destructive,
  optional_for_audience, system_hook, notes
)
select
  t.id,
  'pre.verified_first_screen',
  'Verified First background / drug screen',
  'Before Start Date',
  145,
  'Human Resources',
  'start_date',
  -7,
  true,
  'assist',
  false,
  false,
  'verified_first',
  'Human-gated Verified First order. Step complete when clear|waived|not_required.'
from public.os_hris_process_templates t
where t.kind = 'onboarding'
  and t.active = true
  and t.slug in (
    'tage-onboarding-v1',
    'parent-onboarding-v1',
    'r619-onboarding-v1',
    'signent-onboarding-v1'
  )
on conflict (template_id, step_key) do update
  set system_hook = 'verified_first',
      automation = 'assist',
      evidence_required = true,
      notes = excluded.notes;

comment on table public.os_screening_packages is
  'Verified First package catalog (spine). Managed on Tage OS.';
comment on table public.os_screening_orders is
  'Screening orders system of record for HRIS, Recruit, Signent. Human-gated; VERIFIED_FIRST_LIVE fail-closed.';
comment on function public.can_manage_screening(text) is
  'Who may create/confirm/waive screening orders for an entity.';
comment on function public.can_view_screening(text) is
  'Who may view screening orders (includes Recruit desk for ENT-R619).';
