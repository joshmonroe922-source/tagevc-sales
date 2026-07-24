-- Phase 67: SSC cadence automation (additive on Phase 66).
-- Scheduled period generation, trend snapshots, completion packages,
-- durable SSC ops alerts. Safe to re-run. No snapshot retirement mutation.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Cadence worker run log (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_ssc_cadence_runs (
  run_id uuid primary key default gen_random_uuid(),
  run_kind text not null
    check (run_kind in ('full','generate','escalate','sync','trends')),
  trigger_source text not null default 'cron'
    check (trigger_source in ('cron','manual','hub','api')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean not null default true,
  periods_generated integer not null default 0 check (periods_generated >= 0),
  escalations_created integer not null default 0 check (escalations_created >= 0),
  notifications_written integer not null default 0 check (notifications_written >= 0),
  packages_captured integer not null default 0 check (packages_captured >= 0),
  trends_written integer not null default 0 check (trends_written >= 0),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid
);

create index if not exists os_ssc_cadence_runs_started_idx
  on public.os_ssc_cadence_runs (started_at desc);

alter table public.os_ssc_cadence_runs enable row level security;

drop policy if exists os_ssc_cadence_runs_select on public.os_ssc_cadence_runs;
create policy os_ssc_cadence_runs_select on public.os_ssc_cadence_runs
  for select to authenticated
  using (public.is_firm_wide_access());

revoke all on public.os_ssc_cadence_runs from public, anon;
grant select, insert, update on public.os_ssc_cadence_runs to authenticated;

create or replace function public.reject_ssc_cadence_run_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'SSC cadence runs are append-only (no delete)';
end;
$$;

drop trigger if exists os_ssc_cadence_runs_no_delete on public.os_ssc_cadence_runs;
create trigger os_ssc_cadence_runs_no_delete
  before delete on public.os_ssc_cadence_runs
  for each row execute function public.reject_ssc_cadence_run_delete();

-- ---------------------------------------------------------------------------
-- Period trend snapshots (for sparkline / period-over-period)
-- ---------------------------------------------------------------------------
create table if not exists public.os_ssc_period_trends (
  id uuid primary key default gen_random_uuid(),
  function_key text not null
    check (function_key in ('finance','hr','it','marketing','legal','all')),
  period_type text not null
    check (period_type in ('weekly','as_needed','monthly','quarterly','annual')),
  period_key text not null
    check (period_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$'),
  scope_mode text not null
    check (scope_mode in ('parent','parent_subs','subs','single')),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  completion_pct numeric not null default 0
    check (completion_pct >= 0 and completion_pct <= 100),
  overdue_count integer not null default 0 check (overdue_count >= 0),
  blocked_count integer not null default 0 check (blocked_count >= 0),
  total_tasks integer not null default 0 check (total_tasks >= 0),
  done_tasks integer not null default 0 check (done_tasks >= 0),
  captured_at timestamptz not null default now()
);

create unique index if not exists os_ssc_period_trends_uniq
  on public.os_ssc_period_trends (
    function_key,
    period_type,
    period_key,
    scope_mode,
    coalesce(entity_id, '')
  );

create index if not exists os_ssc_period_trends_lookup_idx
  on public.os_ssc_period_trends (period_type, scope_mode, function_key, period_key);

alter table public.os_ssc_period_trends enable row level security;

drop policy if exists os_ssc_period_trends_select on public.os_ssc_period_trends;
create policy os_ssc_period_trends_select on public.os_ssc_period_trends
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );

drop policy if exists os_ssc_period_trends_write on public.os_ssc_period_trends;
create policy os_ssc_period_trends_write on public.os_ssc_period_trends
  for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

revoke all on public.os_ssc_period_trends from public, anon;
grant select, insert, update on public.os_ssc_period_trends to authenticated;

-- ---------------------------------------------------------------------------
-- Subsidiary completion packages (Tage intake; no sub UI)
-- ---------------------------------------------------------------------------
create table if not exists public.os_ssc_completion_packages (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  package_key text not null
    check (package_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  period_key text not null default 'current'
    check (period_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$'),
  status text not null default 'ok'
    check (status in ('ok','partial','missing','stale','error')),
  freshness_at timestamptz,
  captured_at timestamptz not null default now(),
  highlights jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  notes text
);

create unique index if not exists os_ssc_completion_packages_uniq
  on public.os_ssc_completion_packages (entity_id, package_key, period_key);

create index if not exists os_ssc_completion_packages_entity_idx
  on public.os_ssc_completion_packages (entity_id, captured_at desc);

alter table public.os_ssc_completion_packages enable row level security;

drop policy if exists os_ssc_completion_packages_select
  on public.os_ssc_completion_packages;
create policy os_ssc_completion_packages_select
  on public.os_ssc_completion_packages
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

drop policy if exists os_ssc_completion_packages_write
  on public.os_ssc_completion_packages;
create policy os_ssc_completion_packages_write
  on public.os_ssc_completion_packages
  for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

revoke all on public.os_ssc_completion_packages from public, anon;
grant select, insert, update on public.os_ssc_completion_packages to authenticated;

-- ---------------------------------------------------------------------------
-- Durable SSC ops alerts (compatible shape we control; service-role friendly)
-- ---------------------------------------------------------------------------
create table if not exists public.os_ssc_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  alert_kind text not null default 'ssc_overdue_escalation'
    check (alert_kind in (
      'ssc_overdue_escalation','ssc_cadence_failed','ssc_audit_open','ssc_sync_stale'
    )),
  severity text not null default 'warning'
    check (severity in ('info','warning','critical')),
  title text not null,
  body text,
  href text,
  ticket_id text,
  task_id uuid,
  window_key text not null
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (window_key)
);

create index if not exists os_ssc_ops_alerts_created_idx
  on public.os_ssc_ops_alerts (created_at desc);
create index if not exists os_ssc_ops_alerts_entity_idx
  on public.os_ssc_ops_alerts (entity_id, created_at desc);

alter table public.os_ssc_ops_alerts enable row level security;

drop policy if exists os_ssc_ops_alerts_select on public.os_ssc_ops_alerts;
create policy os_ssc_ops_alerts_select on public.os_ssc_ops_alerts
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );

drop policy if exists os_ssc_ops_alerts_insert on public.os_ssc_ops_alerts;
create policy os_ssc_ops_alerts_insert on public.os_ssc_ops_alerts
  for insert to authenticated
  with check (true);

revoke all on public.os_ssc_ops_alerts from public, anon;
grant select, insert on public.os_ssc_ops_alerts to authenticated;

create or replace function public.reject_ssc_ops_alert_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'SSC ops alerts are append-only';
end;
$$;

drop trigger if exists os_ssc_ops_alerts_immutable on public.os_ssc_ops_alerts;
create trigger os_ssc_ops_alerts_immutable
  before update or delete on public.os_ssc_ops_alerts
  for each row execute function public.reject_ssc_ops_alert_mutation();
