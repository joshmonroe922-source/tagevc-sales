-- Phase 66: Shared Services Center checklist + audit engine (additive).
-- Cadence checklists, startup audits, annual compliance audits.
-- Safe to re-run. Never mutates snapshot retirement tables. No money movement.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Checklist period instances (one per function × period × scope key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_ssc_checklist_instances (
  id uuid primary key default gen_random_uuid(),
  function_key text not null
    check (function_key in ('finance','hr','it','marketing','legal')),
  period_type text not null
    check (period_type in ('weekly','as_needed','monthly','quarterly','annual')),
  period_key text not null
    check (period_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$'),
  scope_mode text not null
    check (scope_mode in ('parent','parent_subs','subs','single')),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  period_start date not null,
  period_end date not null,
  due_at date not null,
  status text not null default 'open'
    check (status in ('open','in_progress','complete','archived')),
  completion_pct numeric not null default 0
    check (completion_pct >= 0 and completion_pct <= 100),
  overdue_count integer not null default 0 check (overdue_count >= 0),
  blocked_count integer not null default 0 check (blocked_count >= 0),
  generated_by text not null default 'auto'
    check (generated_by in ('auto','manual','seed')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists os_ssc_checklist_inst_uniq
  on public.os_ssc_checklist_instances (
    function_key,
    period_type,
    period_key,
    scope_mode,
    coalesce(entity_id, '')
  );

create index if not exists os_ssc_checklist_inst_period_idx
  on public.os_ssc_checklist_instances (period_type, period_key, function_key);
create index if not exists os_ssc_checklist_inst_entity_idx
  on public.os_ssc_checklist_instances (entity_id, period_type, period_key);
create index if not exists os_ssc_checklist_inst_due_idx
  on public.os_ssc_checklist_instances (due_at, status);

alter table public.os_ssc_checklist_instances enable row level security;

drop policy if exists os_ssc_checklist_inst_select on public.os_ssc_checklist_instances;
create policy os_ssc_checklist_inst_select on public.os_ssc_checklist_instances
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );

drop policy if exists os_ssc_checklist_inst_write on public.os_ssc_checklist_instances;
create policy os_ssc_checklist_inst_write on public.os_ssc_checklist_instances
  for all to authenticated
  using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  )
  with check (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );

revoke all on public.os_ssc_checklist_instances from public, anon;
grant select, insert, update on public.os_ssc_checklist_instances to authenticated;

-- ---------------------------------------------------------------------------
-- Checklist tasks (library rows materialised onto an instance)
-- ---------------------------------------------------------------------------
create table if not exists public.os_ssc_checklist_tasks (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null
    references public.os_ssc_checklist_instances(id) on delete cascade,
  template_key text not null,
  title text not null,
  description text,
  function_key text not null
    check (function_key in ('finance','hr','it','marketing','legal')),
  period_type text not null
    check (period_type in ('weekly','as_needed','monthly','quarterly','annual')),
  owner_role text not null default 'service_lead',
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  status text not null default 'not_started'
    check (status in ('not_started','in_progress','done','blocked','waived')),
  due_date date,
  completed_at timestamptz,
  completed_by uuid,
  evidence_ticket_id text,
  evidence_url text,
  evidence_note text,
  automation_source text not null default 'manual'
    check (automation_source in ('manual','ai_assisted','auto')),
  risk_level text not null default 'normal'
    check (risk_level in ('low','normal','high','critical')),
  sort_order integer not null default 0,
  ai_suggestion text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists os_ssc_checklist_tasks_uniq
  on public.os_ssc_checklist_tasks (
    instance_id,
    template_key,
    coalesce(entity_id, '')
  );

create index if not exists os_ssc_checklist_tasks_inst_idx
  on public.os_ssc_checklist_tasks (instance_id, status);
create index if not exists os_ssc_checklist_tasks_entity_idx
  on public.os_ssc_checklist_tasks (entity_id, status, due_date);
create index if not exists os_ssc_checklist_tasks_owner_idx
  on public.os_ssc_checklist_tasks (owner_role, status);

alter table public.os_ssc_checklist_tasks enable row level security;

drop policy if exists os_ssc_checklist_tasks_select on public.os_ssc_checklist_tasks;
create policy os_ssc_checklist_tasks_select on public.os_ssc_checklist_tasks
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );

drop policy if exists os_ssc_checklist_tasks_write on public.os_ssc_checklist_tasks;
create policy os_ssc_checklist_tasks_write on public.os_ssc_checklist_tasks
  for all to authenticated
  using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  )
  with check (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );

revoke all on public.os_ssc_checklist_tasks from public, anon;
grant select, insert, update on public.os_ssc_checklist_tasks to authenticated;

-- ---------------------------------------------------------------------------
-- Append-only task events
-- ---------------------------------------------------------------------------
create table if not exists public.os_ssc_checklist_task_events (
  event_id uuid primary key default gen_random_uuid(),
  task_id uuid not null
    references public.os_ssc_checklist_tasks(id) on delete cascade,
  instance_id uuid not null
    references public.os_ssc_checklist_instances(id) on delete cascade,
  event_kind text not null
    check (event_kind in (
      'created','status_change','note','evidence','ai_suggestion','overdue_mark','waive'
    )),
  from_status text,
  to_status text,
  note text,
  actor_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists os_ssc_checklist_task_events_task_idx
  on public.os_ssc_checklist_task_events (task_id, created_at desc);

alter table public.os_ssc_checklist_task_events enable row level security;

drop policy if exists os_ssc_checklist_task_events_select
  on public.os_ssc_checklist_task_events;
create policy os_ssc_checklist_task_events_select
  on public.os_ssc_checklist_task_events
  for select to authenticated
  using (true);

drop policy if exists os_ssc_checklist_task_events_insert
  on public.os_ssc_checklist_task_events;
create policy os_ssc_checklist_task_events_insert
  on public.os_ssc_checklist_task_events
  for insert to authenticated
  with check (true);

revoke all on public.os_ssc_checklist_task_events from public, anon;
grant select, insert on public.os_ssc_checklist_task_events to authenticated;

create or replace function public.reject_ssc_checklist_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'SSC checklist task events are append-only';
end;
$$;

drop trigger if exists os_ssc_checklist_task_events_immutable
  on public.os_ssc_checklist_task_events;
create trigger os_ssc_checklist_task_events_immutable
  before update or delete on public.os_ssc_checklist_task_events
  for each row execute function public.reject_ssc_checklist_event_mutation();

-- ---------------------------------------------------------------------------
-- Audits (startup + annual)
-- ---------------------------------------------------------------------------
create table if not exists public.os_ssc_audits (
  id uuid primary key default gen_random_uuid(),
  audit_type text not null
    check (audit_type in ('startup','annual')),
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  period_key text not null
    check (period_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$'),
  title text not null,
  status text not null default 'open'
    check (status in ('open','in_progress','complete','waived')),
  completion_pct numeric not null default 0
    check (completion_pct >= 0 and completion_pct <= 100),
  open_item_count integer not null default 0 check (open_item_count >= 0),
  due_date date,
  generated_by text not null default 'auto'
    check (generated_by in ('auto','manual','seed','onboarding')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (audit_type, entity_id, period_key)
);

create index if not exists os_ssc_audits_entity_idx
  on public.os_ssc_audits (entity_id, audit_type, status);
create index if not exists os_ssc_audits_period_idx
  on public.os_ssc_audits (period_key, audit_type);

alter table public.os_ssc_audits enable row level security;

drop policy if exists os_ssc_audits_select on public.os_ssc_audits;
create policy os_ssc_audits_select on public.os_ssc_audits
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

drop policy if exists os_ssc_audits_write on public.os_ssc_audits;
create policy os_ssc_audits_write on public.os_ssc_audits
  for all to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  )
  with check (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

revoke all on public.os_ssc_audits from public, anon;
grant select, insert, update on public.os_ssc_audits to authenticated;

create table if not exists public.os_ssc_audit_items (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null
    references public.os_ssc_audits(id) on delete cascade,
  template_key text not null,
  function_key text not null
    check (function_key in ('finance','hr','it','marketing','legal','cross')),
  title text not null,
  description text,
  status text not null default 'not_started'
    check (status in ('not_started','in_progress','done','blocked','waived')),
  owner_role text not null default 'service_lead',
  risk_level text not null default 'normal'
    check (risk_level in ('low','normal','high','critical')),
  evidence_ticket_id text,
  evidence_url text,
  evidence_note text,
  ai_finding_draft text,
  completed_at timestamptz,
  completed_by uuid,
  sort_order integer not null default 0,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (audit_id, template_key)
);

create index if not exists os_ssc_audit_items_audit_idx
  on public.os_ssc_audit_items (audit_id, status);

alter table public.os_ssc_audit_items enable row level security;

drop policy if exists os_ssc_audit_items_select on public.os_ssc_audit_items;
create policy os_ssc_audit_items_select on public.os_ssc_audit_items
  for select to authenticated
  using (true);

drop policy if exists os_ssc_audit_items_write on public.os_ssc_audit_items;
create policy os_ssc_audit_items_write on public.os_ssc_audit_items
  for all to authenticated
  using (true)
  with check (true);

revoke all on public.os_ssc_audit_items from public, anon;
grant select, insert, update on public.os_ssc_audit_items to authenticated;

create table if not exists public.os_ssc_audit_events (
  event_id uuid primary key default gen_random_uuid(),
  audit_id uuid not null
    references public.os_ssc_audits(id) on delete cascade,
  item_id uuid references public.os_ssc_audit_items(id) on delete set null,
  event_kind text not null
    check (event_kind in (
      'created','status_change','note','evidence','ai_draft','complete'
    )),
  from_status text,
  to_status text,
  note text,
  actor_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists os_ssc_audit_events_audit_idx
  on public.os_ssc_audit_events (audit_id, created_at desc);

alter table public.os_ssc_audit_events enable row level security;

drop policy if exists os_ssc_audit_events_select on public.os_ssc_audit_events;
create policy os_ssc_audit_events_select on public.os_ssc_audit_events
  for select to authenticated using (true);

drop policy if exists os_ssc_audit_events_insert on public.os_ssc_audit_events;
create policy os_ssc_audit_events_insert on public.os_ssc_audit_events
  for insert to authenticated with check (true);

revoke all on public.os_ssc_audit_events from public, anon;
grant select, insert on public.os_ssc_audit_events to authenticated;

create or replace function public.reject_ssc_audit_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'SSC audit events are append-only';
end;
$$;

drop trigger if exists os_ssc_audit_events_immutable on public.os_ssc_audit_events;
create trigger os_ssc_audit_events_immutable
  before update or delete on public.os_ssc_audit_events
  for each row execute function public.reject_ssc_audit_event_mutation();

-- ---------------------------------------------------------------------------
-- Subsidiary sync snapshots (hooks into Tage; no subsidiary SSC UI)
-- ---------------------------------------------------------------------------
create table if not exists public.os_ssc_sync_snapshots (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  source_key text not null
    check (source_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  captured_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'ok'
    check (status in ('ok','partial','missing','error')),
  notes text
);

create index if not exists os_ssc_sync_snapshots_entity_idx
  on public.os_ssc_sync_snapshots (entity_id, source_key, captured_at desc);

alter table public.os_ssc_sync_snapshots enable row level security;

drop policy if exists os_ssc_sync_snapshots_select on public.os_ssc_sync_snapshots;
create policy os_ssc_sync_snapshots_select on public.os_ssc_sync_snapshots
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

drop policy if exists os_ssc_sync_snapshots_write on public.os_ssc_sync_snapshots;
create policy os_ssc_sync_snapshots_write on public.os_ssc_sync_snapshots
  for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

revoke all on public.os_ssc_sync_snapshots from public, anon;
grant select, insert on public.os_ssc_sync_snapshots to authenticated;
