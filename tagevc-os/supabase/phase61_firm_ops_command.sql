-- Phase 61: Firm Ops Command Completeness.
-- Command Center polish: critical alerts across services, action queues for
-- Visionary/COO/Service Leads, stale-item and breach visibility, module
-- quick-nav. Reuses Phase 54–60 evidence (fail-soft probes). Entity-aware.
-- Apply after Phase 60. Safe to re-run.
-- Append-only evidence only. Never mutates snapshot retirement tables.
-- Never auto-approves money.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.os_sha256_hex(p_input text)
returns text
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  select encode(digest(convert_to(coalesce(p_input, ''), 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function public.phase61_firm_ops_safe_detail(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select
    p_detail is null
    or (
      jsonb_typeof(p_detail)='object'
      and pg_column_size(p_detail)<=8192
      and p_detail::text !~*
        '"[^"]*(payload|secret|token|password|authorization|cookie|body|bytes|base64)[^"]*"\s*:'
      and p_detail::text !~*
        '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://)'
    );
$$;

create or replace function public.reject_firm_ops_phase61_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Firm Ops command Phase 61 evidence is append-only';
end;
$$;

-- ---------------------------------------------------------------------------
-- Critical alerts board snapshots (cross-service).
-- ---------------------------------------------------------------------------
create table if not exists public.os_firm_ops_alert_phase61_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  critical_count integer not null default 0 check (critical_count >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  info_count integer not null default 0 check (info_count >= 0),
  by_service jsonb not null default '{}'::jsonb,
  board_status text not null default 'unknown'
    check (board_status in ('ok','partial','missing','unknown')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_firm_ops_alert_p61_by_service_check
    check (
      jsonb_typeof(by_service)='object'
      and pg_column_size(by_service)<=4096
      and public.phase61_firm_ops_safe_detail(by_service)
    ),
  constraint os_firm_ops_alert_p61_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=8192
      and public.phase61_firm_ops_safe_detail(detail)
      and coalesce((detail->>'money_auto_approve')::boolean,false)=false
    )
);

create index if not exists os_firm_ops_alert_p61_entity_created_idx
  on public.os_firm_ops_alert_phase61_snapshots(entity_id, created_at desc);
create index if not exists os_firm_ops_alert_p61_created_idx
  on public.os_firm_ops_alert_phase61_snapshots(created_at desc);

alter table public.os_firm_ops_alert_phase61_snapshots
  enable row level security;
drop policy if exists "os_firm_ops_alert_p61_select"
  on public.os_firm_ops_alert_phase61_snapshots;
create policy "os_firm_ops_alert_p61_select"
  on public.os_firm_ops_alert_phase61_snapshots for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_firm_ops_alert_phase61_snapshots
  from public, anon, authenticated;
grant select on public.os_firm_ops_alert_phase61_snapshots
  to authenticated;

drop trigger if exists os_firm_ops_alert_p61_immutable
  on public.os_firm_ops_alert_phase61_snapshots;
create trigger os_firm_ops_alert_p61_immutable
  before update or delete on public.os_firm_ops_alert_phase61_snapshots
  for each row execute function public.reject_firm_ops_phase61_mutation();
drop trigger if exists os_firm_ops_alert_p61_no_truncate
  on public.os_firm_ops_alert_phase61_snapshots;
create trigger os_firm_ops_alert_p61_no_truncate
  before truncate on public.os_firm_ops_alert_phase61_snapshots
  for each statement execute function public.reject_firm_ops_phase61_mutation();

-- ---------------------------------------------------------------------------
-- Action queue snapshots (Visionary / COO / Service Leads).
-- ---------------------------------------------------------------------------
create table if not exists public.os_firm_ops_queue_phase61_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  audience text not null
    check (audience in ('visionary','coo','service_lead')),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  open_count integer not null default 0 check (open_count >= 0),
  overdue_count integer not null default 0 check (overdue_count >= 0),
  queue_items jsonb not null default '[]'::jsonb,
  board_status text not null default 'unknown'
    check (board_status in ('ok','partial','missing','unknown')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_firm_ops_queue_p61_items_check
    check (
      jsonb_typeof(queue_items)='array'
      and pg_column_size(queue_items)<=8192
    ),
  constraint os_firm_ops_queue_p61_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase61_firm_ops_safe_detail(detail)
      and coalesce((detail->>'money_auto_approve')::boolean,false)=false
    )
);

create index if not exists os_firm_ops_queue_p61_entity_created_idx
  on public.os_firm_ops_queue_phase61_snapshots(entity_id, created_at desc);
create index if not exists os_firm_ops_queue_p61_audience_created_idx
  on public.os_firm_ops_queue_phase61_snapshots(audience, created_at desc);

alter table public.os_firm_ops_queue_phase61_snapshots
  enable row level security;
drop policy if exists "os_firm_ops_queue_p61_select"
  on public.os_firm_ops_queue_phase61_snapshots;
create policy "os_firm_ops_queue_p61_select"
  on public.os_firm_ops_queue_phase61_snapshots for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_firm_ops_queue_phase61_snapshots
  from public, anon, authenticated;
grant select on public.os_firm_ops_queue_phase61_snapshots
  to authenticated;

drop trigger if exists os_firm_ops_queue_p61_immutable
  on public.os_firm_ops_queue_phase61_snapshots;
create trigger os_firm_ops_queue_p61_immutable
  before update or delete on public.os_firm_ops_queue_phase61_snapshots
  for each row execute function public.reject_firm_ops_phase61_mutation();
drop trigger if exists os_firm_ops_queue_p61_no_truncate
  on public.os_firm_ops_queue_phase61_snapshots;
create trigger os_firm_ops_queue_p61_no_truncate
  before truncate on public.os_firm_ops_queue_phase61_snapshots
  for each statement execute function public.reject_firm_ops_phase61_mutation();

-- ---------------------------------------------------------------------------
-- Stale-item and breach visibility snapshots.
-- ---------------------------------------------------------------------------
create table if not exists public.os_firm_ops_stale_breach_phase61_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  stale_count integer not null default 0 check (stale_count >= 0),
  breach_count integer not null default 0 check (breach_count >= 0),
  by_domain jsonb not null default '{}'::jsonb,
  board_status text not null default 'unknown'
    check (board_status in ('ok','partial','missing','unknown')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_firm_ops_stale_p61_by_domain_check
    check (
      jsonb_typeof(by_domain)='object'
      and pg_column_size(by_domain)<=4096
      and public.phase61_firm_ops_safe_detail(by_domain)
    ),
  constraint os_firm_ops_stale_p61_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase61_firm_ops_safe_detail(detail)
      and coalesce((detail->>'money_auto_approve')::boolean,false)=false
    )
);

create index if not exists os_firm_ops_stale_p61_entity_created_idx
  on public.os_firm_ops_stale_breach_phase61_snapshots(
    entity_id, created_at desc
  );
create index if not exists os_firm_ops_stale_p61_created_idx
  on public.os_firm_ops_stale_breach_phase61_snapshots(created_at desc);

alter table public.os_firm_ops_stale_breach_phase61_snapshots
  enable row level security;
drop policy if exists "os_firm_ops_stale_p61_select"
  on public.os_firm_ops_stale_breach_phase61_snapshots;
create policy "os_firm_ops_stale_p61_select"
  on public.os_firm_ops_stale_breach_phase61_snapshots for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_firm_ops_stale_breach_phase61_snapshots
  from public, anon, authenticated;
grant select on public.os_firm_ops_stale_breach_phase61_snapshots
  to authenticated;

drop trigger if exists os_firm_ops_stale_p61_immutable
  on public.os_firm_ops_stale_breach_phase61_snapshots;
create trigger os_firm_ops_stale_p61_immutable
  before update or delete on public.os_firm_ops_stale_breach_phase61_snapshots
  for each row execute function public.reject_firm_ops_phase61_mutation();
drop trigger if exists os_firm_ops_stale_p61_no_truncate
  on public.os_firm_ops_stale_breach_phase61_snapshots;
create trigger os_firm_ops_stale_p61_no_truncate
  before truncate on public.os_firm_ops_stale_breach_phase61_snapshots
  for each statement execute function public.reject_firm_ops_phase61_mutation();

-- ---------------------------------------------------------------------------
-- Module quick-nav links (every major module).
-- ---------------------------------------------------------------------------
create table if not exists public.os_firm_ops_module_nav_phase61_links (
  link_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  module_key text not null
    check (module_key ~ '^[a-z][a-z0-9_]{1,47}$'),
  href text not null check (char_length(href) between 1 and 200),
  label text not null check (char_length(label) between 2 and 80),
  priority integer not null default 99 check (priority >= 1 and priority <= 99),
  link_status text not null default 'ok'
    check (link_status in ('ok','partial','missing','unknown')),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_firm_ops_nav_p61_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=2048
      and public.phase61_firm_ops_safe_detail(detail)
    )
);

create index if not exists os_firm_ops_nav_p61_priority_idx
  on public.os_firm_ops_module_nav_phase61_links(priority, created_at desc);
create index if not exists os_firm_ops_nav_p61_module_idx
  on public.os_firm_ops_module_nav_phase61_links(module_key, created_at desc);

alter table public.os_firm_ops_module_nav_phase61_links
  enable row level security;
drop policy if exists "os_firm_ops_nav_p61_select"
  on public.os_firm_ops_module_nav_phase61_links;
create policy "os_firm_ops_nav_p61_select"
  on public.os_firm_ops_module_nav_phase61_links for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_firm_ops_module_nav_phase61_links
  from public, anon, authenticated;
grant select on public.os_firm_ops_module_nav_phase61_links
  to authenticated;

drop trigger if exists os_firm_ops_nav_p61_immutable
  on public.os_firm_ops_module_nav_phase61_links;
create trigger os_firm_ops_nav_p61_immutable
  before update or delete on public.os_firm_ops_module_nav_phase61_links
  for each row execute function public.reject_firm_ops_phase61_mutation();
drop trigger if exists os_firm_ops_nav_p61_no_truncate
  on public.os_firm_ops_module_nav_phase61_links;
create trigger os_firm_ops_nav_p61_no_truncate
  before truncate on public.os_firm_ops_module_nav_phase61_links
  for each statement execute function public.reject_firm_ops_phase61_mutation();

-- ---------------------------------------------------------------------------
-- Ops visibility alerts.
-- ---------------------------------------------------------------------------
create table if not exists public.os_firm_ops_phase61_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  alert_kind text not null
    check (alert_kind in (
      'critical_cross_service','queue_overdue','stale_items','sla_breach',
      'feed_partial','refresh_failed','module_nav_gap'
    )),
  reference_id uuid,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null default 'warning'
    check (severity in ('info','warning','critical')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_firm_ops_ops_p61_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase61_firm_ops_safe_detail(detail)
      and coalesce((detail->>'money_auto_approve')::boolean,false)=false
    )
);

create index if not exists os_firm_ops_ops_p61_entity_created_idx
  on public.os_firm_ops_phase61_ops_alerts(entity_id, created_at desc);
create index if not exists os_firm_ops_ops_p61_kind_created_idx
  on public.os_firm_ops_phase61_ops_alerts(alert_kind, created_at desc);

alter table public.os_firm_ops_phase61_ops_alerts
  enable row level security;
drop policy if exists "os_firm_ops_ops_p61_select"
  on public.os_firm_ops_phase61_ops_alerts;
create policy "os_firm_ops_ops_p61_select"
  on public.os_firm_ops_phase61_ops_alerts for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_firm_ops_phase61_ops_alerts
  from public, anon, authenticated;
grant select on public.os_firm_ops_phase61_ops_alerts
  to authenticated;

drop trigger if exists os_firm_ops_ops_p61_immutable
  on public.os_firm_ops_phase61_ops_alerts;
create trigger os_firm_ops_ops_p61_immutable
  before update or delete on public.os_firm_ops_phase61_ops_alerts
  for each row execute function public.reject_firm_ops_phase61_mutation();
drop trigger if exists os_firm_ops_ops_p61_no_truncate
  on public.os_firm_ops_phase61_ops_alerts;
create trigger os_firm_ops_ops_p61_no_truncate
  before truncate on public.os_firm_ops_phase61_ops_alerts
  for each statement execute function public.reject_firm_ops_phase61_mutation();

-- ---------------------------------------------------------------------------
-- Refresh Firm Ops command board (observe + evidence only).
-- ---------------------------------------------------------------------------
create or replace function public.refresh_firm_ops_command_phase61(
  p_actor_id uuid default null,
  p_entity_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := nullif(trim(coalesce(p_entity_id,'')),'');
  v_ss_open integer := 0;
  v_ss_breached integer := 0;
  v_ss_due_soon integer := 0;
  v_ss_unassigned integer := 0;
  v_fin_crit integer := 0;
  v_fin_warn integer := 0;
  v_legal_crit integer := 0;
  v_hr_stale integer := 0;
  v_mkt_warn integer := 0;
  v_notif_crit integer := 0;
  v_port_attention integer := 0;
  v_port_critical integer := 0;
  v_critical integer := 0;
  v_warning integer := 0;
  v_info integer := 0;
  v_stale integer := 0;
  v_breach integer := 0;
  v_alert_board text := 'missing';
  v_stale_board text := 'missing';
  v_by_service jsonb := '{}'::jsonb;
  v_by_domain jsonb := '{}'::jsonb;
  v_has_ss boolean := false;
  v_has_fin boolean := false;
  v_has_legal boolean := false;
  v_has_hr boolean := false;
  v_has_mkt boolean := false;
  v_has_notif boolean := false;
  v_has_port boolean := false;
  v_sources_ok integer := 0;
  v_sources_total integer := 7;
  v_window text;
  v_hash text;
  v_alert_id uuid;
  v_stale_id uuid;
  v_q_vis uuid;
  v_q_coo uuid;
  v_q_svc uuid;
  v_day text := to_char(now() at time zone 'utc','YYYY-MM-DD');
  v_hour text := to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24');
begin
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 61 firm ops refresh';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 61 firm ops refresh';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is null then
    raise exception 'Firm-wide access or entity filter required for Phase 61 firm ops refresh';
  end if;

  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_ss_inbox_phase54_snapshots'
  ) into v_has_ss;
  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_finance_anomaly_phase55_alerts'
  ) into v_has_fin;
  select exists (
    select 1 from information_schema.tables
    where table_schema='public'
      and table_name='os_docusign_archive_integrity_phase56_alerts'
  ) into v_has_legal;
  select exists (
    select 1 from information_schema.tables
    where table_schema='public'
      and table_name='os_hr_it_exception_aging_phase57_alerts'
  ) into v_has_hr;
  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_marketing_phase58_ops_alerts'
  ) into v_has_mkt;
  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_notification_phase59_ops_alerts'
  ) into v_has_notif;
  select exists (
    select 1 from information_schema.tables
    where table_schema='public'
      and table_name='os_portfolio_health_phase60_snapshots'
  ) into v_has_port;

  -- Phase 54 Shared Services inbox
  if v_has_ss then
    begin
      execute
        'select
           coalesce(open_total,0)::integer,
           coalesce(breached_count,0)::integer,
           coalesce(due_soon_count,0)::integer,
           coalesce(unassigned_count,0)::integer
         from public.os_ss_inbox_phase54_snapshots s
         where ($1::text is null and s.entity_id is null)
            or ($1::text is not null and s.entity_id = $1)
         order by s.created_at desc
         limit 1'
      into v_ss_open, v_ss_breached, v_ss_due_soon, v_ss_unassigned
      using v_entity;
      v_sources_ok := v_sources_ok + 1;
    exception when others then
      v_ss_open := 0;
      v_ss_breached := 0;
      v_ss_due_soon := 0;
      v_ss_unassigned := 0;
    end;
  end if;

  -- Phase 55 Finance anomalies
  if v_has_fin then
    begin
      execute
        'select
           count(*) filter (where severity = ''critical'')::integer,
           count(*) filter (where severity = ''warning'')::integer
         from (
           select severity from public.os_finance_anomaly_phase55_alerts a
           where ($1::text is null or a.entity_id = $1 or a.entity_id is null)
             and a.created_at > now() - interval ''14 days''
           order by a.created_at desc
           limit 200
         ) x'
      into v_fin_crit, v_fin_warn
      using v_entity;
      v_sources_ok := v_sources_ok + 1;
    exception when others then
      v_fin_crit := 0;
      v_fin_warn := 0;
    end;
  end if;

  -- Phase 56 Legal / DocuSign archive integrity
  if v_has_legal then
    begin
      execute
        'select count(*) filter (where severity = ''critical'')::integer
         from (
           select severity
           from public.os_docusign_archive_integrity_phase56_alerts a
           where ($1::text is null or a.entity_id = $1 or a.entity_id is null)
             and a.created_at > now() - interval ''14 days''
           order by a.created_at desc
           limit 200
         ) x'
      into v_legal_crit
      using v_entity;
      v_sources_ok := v_sources_ok + 1;
    exception when others then
      v_legal_crit := 0;
    end;
  end if;

  -- Phase 57 HR/IT exception aging (stale)
  if v_has_hr then
    begin
      execute
        'select count(*)::integer
         from (
           select 1
           from public.os_hr_it_exception_aging_phase57_alerts a
           where ($1::text is null or a.entity_id = $1 or a.entity_id is null)
             and a.created_at > now() - interval ''14 days''
           order by a.created_at desc
           limit 200
         ) x'
      into v_hr_stale
      using v_entity;
      v_sources_ok := v_sources_ok + 1;
    exception when others then
      v_hr_stale := 0;
    end;
  end if;

  -- Phase 58 Marketing ops alerts
  if v_has_mkt then
    begin
      execute
        'select count(*) filter (
           where severity in (''warning'',''critical'')
         )::integer
         from (
           select severity from public.os_marketing_phase58_ops_alerts a
           where ($1::text is null or a.entity_id = $1 or a.entity_id is null)
             and a.created_at > now() - interval ''14 days''
           order by a.created_at desc
           limit 200
         ) x'
      into v_mkt_warn
      using v_entity;
      v_sources_ok := v_sources_ok + 1;
    exception when others then
      v_mkt_warn := 0;
    end;
  end if;

  -- Phase 59 Notification ops alerts
  if v_has_notif then
    begin
      execute
        'select count(*) filter (where severity = ''critical'')::integer
         from (
           select severity from public.os_notification_phase59_ops_alerts a
           where ($1::text is null or a.entity_id = $1 or a.entity_id is null)
             and a.created_at > now() - interval ''14 days''
           order by a.created_at desc
           limit 200
         ) x'
      into v_notif_crit
      using v_entity;
      v_sources_ok := v_sources_ok + 1;
    exception when others then
      v_notif_crit := 0;
    end;
  end if;

  -- Phase 60 Portfolio health attention
  if v_has_port then
    begin
      execute
        'select
           coalesce(attention_required,0)::integer,
           coalesce(critical_count,0)::integer
         from public.os_portfolio_health_phase60_snapshots s
         where ($1::text is null and s.entity_id is null)
            or ($1::text is not null and s.entity_id = $1)
         order by s.created_at desc
         limit 1'
      into v_port_attention, v_port_critical
      using v_entity;
      v_sources_ok := v_sources_ok + 1;
    exception when others then
      v_port_attention := 0;
      v_port_critical := 0;
    end;
  end if;

  v_critical := coalesce(v_fin_crit,0) + coalesce(v_legal_crit,0)
    + coalesce(v_notif_crit,0) + coalesce(v_port_critical,0)
    + coalesce(v_ss_breached,0);
  v_warning := coalesce(v_fin_warn,0) + coalesce(v_mkt_warn,0)
    + coalesce(v_ss_due_soon,0) + coalesce(v_port_attention,0);
  v_info := coalesce(v_ss_unassigned,0);
  v_breach := coalesce(v_ss_breached,0) + coalesce(v_legal_crit,0);
  v_stale := coalesce(v_hr_stale,0) + coalesce(v_ss_due_soon,0)
    + coalesce(v_mkt_warn,0);

  v_by_service := jsonb_build_object(
    'shared_services', coalesce(v_ss_breached,0) + coalesce(v_ss_due_soon,0),
    'finance', coalesce(v_fin_crit,0) + coalesce(v_fin_warn,0),
    'legal', coalesce(v_legal_crit,0),
    'hr_it', coalesce(v_hr_stale,0),
    'marketing', coalesce(v_mkt_warn,0),
    'notifications', coalesce(v_notif_crit,0),
    'portfolio', coalesce(v_port_attention,0) + coalesce(v_port_critical,0)
  );

  v_by_domain := jsonb_build_object(
    'shared_services_breach', coalesce(v_ss_breached,0),
    'shared_services_due_soon', coalesce(v_ss_due_soon,0),
    'hr_it_stale', coalesce(v_hr_stale,0),
    'legal_integrity', coalesce(v_legal_crit,0),
    'marketing_sla', coalesce(v_mkt_warn,0),
    'portfolio_attention', coalesce(v_port_attention,0)
  );

  if v_sources_ok = 0 then
    v_alert_board := 'missing';
    v_stale_board := 'missing';
  elsif coalesce(v_critical,0) > 0 or coalesce(v_breach,0) > 0 then
    v_alert_board := 'partial';
    v_stale_board := 'partial';
  elsif coalesce(v_warning,0) > 0 or coalesce(v_stale,0) > 0 then
    v_alert_board := 'partial';
    v_stale_board := 'partial';
  elsif v_sources_ok < v_sources_total then
    v_alert_board := 'partial';
    v_stale_board := 'partial';
  else
    v_alert_board := 'ok';
    v_stale_board := 'ok';
  end if;

  -- Critical alerts snapshot
  v_window := left(
    'phase61:alerts:' || coalesce(v_entity,'firm') || ':' || v_hour,
    200
  );
  v_hash := public.os_sha256_hex(
    coalesce(v_entity,'firm') || '|' || coalesce(v_critical,0)::text || '|'
    || coalesce(v_warning,0)::text || '|' || v_alert_board || '|' || v_window
  );

  insert into public.os_firm_ops_alert_phase61_snapshots (
    entity_id, window_key, critical_count, warning_count, info_count,
    by_service, board_status, metrics_sha256, detail, actor_id
  ) values (
    v_entity, v_window,
    coalesce(v_critical,0), coalesce(v_warning,0), coalesce(v_info,0),
    v_by_service, v_alert_board, v_hash,
    jsonb_build_object(
      'contract_version','phase61-v1',
      'source','refresh_firm_ops_command_phase61',
      'sources_ok', v_sources_ok,
      'sources_total', v_sources_total,
      'entity_filter_hint','ENT-R619',
      'money_auto_approve', false,
      'ss_open', coalesce(v_ss_open,0),
      'port_attention', coalesce(v_port_attention,0)
    ),
    p_actor_id
  )
  on conflict (window_key) do nothing
  returning snapshot_id into v_alert_id;

  if v_alert_id is null then
    select snapshot_id into v_alert_id
    from public.os_firm_ops_alert_phase61_snapshots
    where window_key = v_window;
  end if;

  -- Stale / breach snapshot
  v_window := left(
    'phase61:stale:' || coalesce(v_entity,'firm') || ':' || v_hour,
    200
  );
  v_hash := public.os_sha256_hex(
    coalesce(v_entity,'firm') || '|' || coalesce(v_stale,0)::text || '|'
    || coalesce(v_breach,0)::text || '|' || v_stale_board || '|' || v_window
  );

  insert into public.os_firm_ops_stale_breach_phase61_snapshots (
    entity_id, window_key, stale_count, breach_count, by_domain,
    board_status, metrics_sha256, detail, actor_id
  ) values (
    v_entity, v_window,
    coalesce(v_stale,0), coalesce(v_breach,0), v_by_domain,
    v_stale_board, v_hash,
    jsonb_build_object(
      'contract_version','phase61-v1',
      'money_auto_approve', false,
      'entity_filter_hint','ENT-R619'
    ),
    p_actor_id
  )
  on conflict (window_key) do nothing
  returning snapshot_id into v_stale_id;

  if v_stale_id is null then
    select snapshot_id into v_stale_id
    from public.os_firm_ops_stale_breach_phase61_snapshots
    where window_key = v_window;
  end if;

  -- Visionary queue
  v_window := left(
    'phase61:queue:visionary:' || coalesce(v_entity,'firm') || ':' || v_hour,
    200
  );
  v_hash := public.os_sha256_hex(
    'visionary|' || coalesce(v_entity,'firm') || '|' || v_window
  );
  insert into public.os_firm_ops_queue_phase61_snapshots (
    entity_id, audience, window_key, open_count, overdue_count, queue_items,
    board_status, metrics_sha256, detail, actor_id
  ) values (
    v_entity, 'visionary', v_window,
    coalesce(v_port_attention,0) + coalesce(v_fin_crit,0) + coalesce(v_critical,0),
    coalesce(v_breach,0) + coalesce(v_port_critical,0),
    jsonb_build_array(
      jsonb_build_object(
        'id','visionary-portfolio',
        'title','Portfolio attention items',
        'href','/portfolio',
        'count', coalesce(v_port_attention,0),
        'severity', case when coalesce(v_port_critical,0) > 0 then 'critical' else 'warning' end
      ),
      jsonb_build_object(
        'id','visionary-finance',
        'title','Finance critical anomalies',
        'href','/shared-services/finance',
        'count', coalesce(v_fin_crit,0),
        'severity', 'critical'
      ),
      jsonb_build_object(
        'id','visionary-firm',
        'title','Firm capital / governance',
        'href','/firm',
        'count', coalesce(v_info,0),
        'severity', 'info'
      )
    ),
    case
      when coalesce(v_critical,0) > 0 then 'partial'
      when coalesce(v_port_attention,0) > 0 then 'partial'
      when v_sources_ok = 0 then 'missing'
      else 'ok'
    end,
    v_hash,
    jsonb_build_object(
      'contract_version','phase61-v1',
      'money_auto_approve', false,
      'role_audience','visionary'
    ),
    p_actor_id
  )
  on conflict (window_key) do nothing
  returning snapshot_id into v_q_vis;

  -- COO queue
  v_window := left(
    'phase61:queue:coo:' || coalesce(v_entity,'firm') || ':' || v_hour,
    200
  );
  v_hash := public.os_sha256_hex(
    'coo|' || coalesce(v_entity,'firm') || '|' || v_window
  );
  insert into public.os_firm_ops_queue_phase61_snapshots (
    entity_id, audience, window_key, open_count, overdue_count, queue_items,
    board_status, metrics_sha256, detail, actor_id
  ) values (
    v_entity, 'coo', v_window,
    coalesce(v_ss_open,0) + coalesce(v_port_attention,0) + coalesce(v_hr_stale,0),
    coalesce(v_ss_breached,0) + coalesce(v_stale,0),
    jsonb_build_array(
      jsonb_build_object(
        'id','coo-ss-inbox',
        'title','Shared Services open / breached',
        'href','/shared-services#inbox',
        'count', coalesce(v_ss_open,0) + coalesce(v_ss_breached,0),
        'severity', case when coalesce(v_ss_breached,0) > 0 then 'critical' else 'warning' end
      ),
      jsonb_build_object(
        'id','coo-portfolio',
        'title','Portfolio operating cadence',
        'href','/portfolio',
        'count', coalesce(v_port_attention,0),
        'severity', 'warning'
      ),
      jsonb_build_object(
        'id','coo-hr-it',
        'title','HR/IT stale exceptions',
        'href','/shared-services',
        'count', coalesce(v_hr_stale,0),
        'severity', 'warning'
      )
    ),
    case
      when coalesce(v_ss_breached,0) > 0 then 'partial'
      when coalesce(v_ss_open,0) + coalesce(v_hr_stale,0) > 0 then 'partial'
      when v_sources_ok = 0 then 'missing'
      else 'ok'
    end,
    v_hash,
    jsonb_build_object(
      'contract_version','phase61-v1',
      'money_auto_approve', false,
      'role_audience','coo'
    ),
    p_actor_id
  )
  on conflict (window_key) do nothing
  returning snapshot_id into v_q_coo;

  -- Service Lead queue
  v_window := left(
    'phase61:queue:service_lead:' || coalesce(v_entity,'firm') || ':' || v_hour,
    200
  );
  v_hash := public.os_sha256_hex(
    'service_lead|' || coalesce(v_entity,'firm') || '|' || v_window
  );
  insert into public.os_firm_ops_queue_phase61_snapshots (
    entity_id, audience, window_key, open_count, overdue_count, queue_items,
    board_status, metrics_sha256, detail, actor_id
  ) values (
    v_entity, 'service_lead', v_window,
    coalesce(v_ss_open,0) + coalesce(v_ss_unassigned,0) + coalesce(v_mkt_warn,0),
    coalesce(v_ss_breached,0) + coalesce(v_ss_due_soon,0),
    jsonb_build_array(
      jsonb_build_object(
        'id','svc-breached',
        'title','SLA breached tickets',
        'href','/shared-services#inbox',
        'count', coalesce(v_ss_breached,0),
        'severity', 'critical'
      ),
      jsonb_build_object(
        'id','svc-unassigned',
        'title','Unassigned tickets',
        'href','/shared-services#inbox',
        'count', coalesce(v_ss_unassigned,0),
        'severity', 'warning'
      ),
      jsonb_build_object(
        'id','svc-marketing',
        'title','Marketing approval / publish SLA',
        'href','/shared-services/marketing',
        'count', coalesce(v_mkt_warn,0),
        'severity', 'warning'
      ),
      jsonb_build_object(
        'id','svc-legal',
        'title','Legal archive integrity',
        'href','/shared-services/legal/docusign',
        'count', coalesce(v_legal_crit,0),
        'severity', 'critical'
      )
    ),
    case
      when coalesce(v_ss_breached,0) > 0 then 'partial'
      when coalesce(v_ss_open,0) + coalesce(v_ss_unassigned,0) > 0 then 'partial'
      when v_sources_ok = 0 then 'missing'
      else 'ok'
    end,
    v_hash,
    jsonb_build_object(
      'contract_version','phase61-v1',
      'money_auto_approve', false,
      'role_audience','service_lead'
    ),
    p_actor_id
  )
  on conflict (window_key) do nothing
  returning snapshot_id into v_q_svc;

  -- Module quick-nav links (idempotent per day)
  insert into public.os_firm_ops_module_nav_phase61_links (
    entity_id, module_key, href, label, priority, link_status,
    window_key, metrics_sha256, detail
  ) values
    (v_entity, 'command_center', '/command-center', 'Command Center', 1, 'ok',
      left('phase61:nav:command_center:' || coalesce(v_entity,'firm') || ':' || v_day, 200),
      public.os_sha256_hex('nav|command_center|' || v_day),
      jsonb_build_object('contract_version','phase61-v1')),
    (v_entity, 'deal_flow', '/deal-flow', 'Deal Flow', 2, 'ok',
      left('phase61:nav:deal_flow:' || coalesce(v_entity,'firm') || ':' || v_day, 200),
      public.os_sha256_hex('nav|deal_flow|' || v_day),
      jsonb_build_object('contract_version','phase61-v1')),
    (v_entity, 'portfolio', '/portfolio', 'Portfolio', 3, 'ok',
      left('phase61:nav:portfolio:' || coalesce(v_entity,'firm') || ':' || v_day, 200),
      public.os_sha256_hex('nav|portfolio|' || v_day),
      jsonb_build_object('contract_version','phase61-v1')),
    (v_entity, 'shared_services', '/shared-services', 'Shared Services', 4, 'ok',
      left('phase61:nav:shared_services:' || coalesce(v_entity,'firm') || ':' || v_day, 200),
      public.os_sha256_hex('nav|shared_services|' || v_day),
      jsonb_build_object('contract_version','phase61-v1')),
    (v_entity, 'finance', '/shared-services/finance', 'Finance', 5, 'ok',
      left('phase61:nav:finance:' || coalesce(v_entity,'firm') || ':' || v_day, 200),
      public.os_sha256_hex('nav|finance|' || v_day),
      jsonb_build_object('contract_version','phase61-v1')),
    (v_entity, 'legal', '/shared-services/legal/docusign', 'Legal', 6, 'ok',
      left('phase61:nav:legal:' || coalesce(v_entity,'firm') || ':' || v_day, 200),
      public.os_sha256_hex('nav|legal|' || v_day),
      jsonb_build_object('contract_version','phase61-v1')),
    (v_entity, 'marketing', '/shared-services/marketing', 'Marketing', 7, 'ok',
      left('phase61:nav:marketing:' || coalesce(v_entity,'firm') || ':' || v_day, 200),
      public.os_sha256_hex('nav|marketing|' || v_day),
      jsonb_build_object('contract_version','phase61-v1')),
    (v_entity, 'firm', '/firm', 'Firm', 8, 'ok',
      left('phase61:nav:firm:' || coalesce(v_entity,'firm') || ':' || v_day, 200),
      public.os_sha256_hex('nav|firm|' || v_day),
      jsonb_build_object('contract_version','phase61-v1')),
    (v_entity, 'documents', '/documents', 'Documents', 9, 'ok',
      left('phase61:nav:documents:' || coalesce(v_entity,'firm') || ':' || v_day, 200),
      public.os_sha256_hex('nav|documents|' || v_day),
      jsonb_build_object('contract_version','phase61-v1')),
    (v_entity, 'entities', '/entities', 'Entities', 10, 'ok',
      left('phase61:nav:entities:' || coalesce(v_entity,'firm') || ':' || v_day, 200),
      public.os_sha256_hex('nav|entities|' || v_day),
      jsonb_build_object('contract_version','phase61-v1')),
    (v_entity, 'recruit619', '/entities/ENT-R619', 'Recruit 619', 11, 'ok',
      left('phase61:nav:recruit619:' || coalesce(v_entity,'firm') || ':' || v_day, 200),
      public.os_sha256_hex('nav|recruit619|' || v_day),
      jsonb_build_object('contract_version','phase61-v1','entity_id','ENT-R619')),
    (v_entity, 'activity', '/activity', 'Activity', 12, 'ok',
      left('phase61:nav:activity:' || coalesce(v_entity,'firm') || ':' || v_day, 200),
      public.os_sha256_hex('nav|activity|' || v_day),
      jsonb_build_object('contract_version','phase61-v1')),
    (v_entity, 'messages', '/messages', 'Messages', 13, 'ok',
      left('phase61:nav:messages:' || coalesce(v_entity,'firm') || ':' || v_day, 200),
      public.os_sha256_hex('nav|messages|' || v_day),
      jsonb_build_object('contract_version','phase61-v1')),
    (v_entity, 'settings', '/settings/notifications', 'Notification prefs', 14, 'ok',
      left('phase61:nav:settings:' || coalesce(v_entity,'firm') || ':' || v_day, 200),
      public.os_sha256_hex('nav|settings|' || v_day),
      jsonb_build_object('contract_version','phase61-v1'))
  on conflict (window_key) do nothing;

  -- Ops alerts when critical / breach / stale present
  if coalesce(v_critical,0) > 0 then
    insert into public.os_firm_ops_phase61_ops_alerts (
      entity_id, alert_kind, reference_id, window_key, severity,
      metrics_sha256, detail
    ) values (
      v_entity, 'critical_cross_service', v_alert_id,
      left(
        'phase61:alert:critical:' || coalesce(v_entity,'firm') || ':' || v_day,
        200
      ),
      'critical',
      public.os_sha256_hex('critical|' || coalesce(v_critical,0)::text),
      jsonb_build_object(
        'contract_version','phase61-v1',
        'critical_count', coalesce(v_critical,0),
        'money_auto_approve', false
      )
    ) on conflict (window_key) do nothing;
  end if;

  if coalesce(v_breach,0) > 0 then
    insert into public.os_firm_ops_phase61_ops_alerts (
      entity_id, alert_kind, reference_id, window_key, severity,
      metrics_sha256, detail
    ) values (
      v_entity, 'sla_breach', v_stale_id,
      left(
        'phase61:alert:breach:' || coalesce(v_entity,'firm') || ':' || v_day,
        200
      ),
      'critical',
      public.os_sha256_hex('breach|' || coalesce(v_breach,0)::text),
      jsonb_build_object(
        'contract_version','phase61-v1',
        'breach_count', coalesce(v_breach,0),
        'money_auto_approve', false
      )
    ) on conflict (window_key) do nothing;
  end if;

  if coalesce(v_stale,0) > 0 then
    insert into public.os_firm_ops_phase61_ops_alerts (
      entity_id, alert_kind, reference_id, window_key, severity,
      metrics_sha256, detail
    ) values (
      v_entity, 'stale_items', v_stale_id,
      left(
        'phase61:alert:stale:' || coalesce(v_entity,'firm') || ':' || v_day,
        200
      ),
      'warning',
      public.os_sha256_hex('stale|' || coalesce(v_stale,0)::text),
      jsonb_build_object(
        'contract_version','phase61-v1',
        'stale_count', coalesce(v_stale,0),
        'money_auto_approve', false
      )
    ) on conflict (window_key) do nothing;
  end if;

  if v_sources_ok > 0 and v_sources_ok < v_sources_total then
    insert into public.os_firm_ops_phase61_ops_alerts (
      entity_id, alert_kind, window_key, severity, metrics_sha256, detail
    ) values (
      v_entity, 'feed_partial',
      left(
        'phase61:alert:feed_partial:' || coalesce(v_entity,'firm') || ':' || v_day,
        200
      ),
      'info',
      public.os_sha256_hex('feed_partial|' || v_sources_ok::text),
      jsonb_build_object(
        'contract_version','phase61-v1',
        'sources_ok', v_sources_ok,
        'sources_total', v_sources_total,
        'todo', 'TODO: refresh Phase 54–60 boards so Firm Ops command has full feed coverage'
      )
    ) on conflict (window_key) do nothing;
  end if;

  return jsonb_build_object(
    'alert_snapshot_id', v_alert_id,
    'stale_snapshot_id', v_stale_id,
    'queue_visionary_id', v_q_vis,
    'queue_coo_id', v_q_coo,
    'queue_service_lead_id', v_q_svc,
    'entity_id', v_entity,
    'critical_count', coalesce(v_critical,0),
    'warning_count', coalesce(v_warning,0),
    'stale_count', coalesce(v_stale,0),
    'breach_count', coalesce(v_breach,0),
    'board_status', v_alert_board,
    'sources_ok', v_sources_ok,
    'sources_total', v_sources_total,
    'money_auto_approve', false,
    'contract_version', 'phase61-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Report: Firm Ops command board.
-- ---------------------------------------------------------------------------
create or replace function public.get_firm_ops_command_phase61_report(
  p_entity_id text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_entity text := nullif(trim(coalesce(p_entity_id,'')),'');
  v_alerts public.os_firm_ops_alert_phase61_snapshots%rowtype;
  v_stale public.os_firm_ops_stale_breach_phase61_snapshots%rowtype;
  v_queues jsonb := '[]'::jsonb;
  v_modules jsonb := '[]'::jsonb;
  v_ops_alerts jsonb := '[]'::jsonb;
  v_todo text;
begin
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 61 firm ops report';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 61 firm ops report';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is null then
    raise exception 'Firm-wide access or entity filter required for Phase 61 firm ops report';
  end if;

  select * into v_alerts
  from public.os_firm_ops_alert_phase61_snapshots s
  where (v_entity is null and s.entity_id is null)
     or (v_entity is not null and s.entity_id = v_entity)
  order by s.created_at desc
  limit 1;

  select * into v_stale
  from public.os_firm_ops_stale_breach_phase61_snapshots s
  where (v_entity is null and s.entity_id is null)
     or (v_entity is not null and s.entity_id = v_entity)
  order by s.created_at desc
  limit 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'snapshot_id', q.snapshot_id,
      'audience', q.audience,
      'open_count', q.open_count,
      'overdue_count', q.overdue_count,
      'queue_items', q.queue_items,
      'board_status', q.board_status,
      'created_at', q.created_at
    )
    order by
      case q.audience
        when 'visionary' then 1
        when 'coo' then 2
        else 3
      end,
      q.created_at desc
  ), '[]'::jsonb)
  into v_queues
  from (
    select distinct on (audience) *
    from public.os_firm_ops_queue_phase61_snapshots q
    where (v_entity is null and q.entity_id is null)
       or (v_entity is not null and q.entity_id = v_entity)
    order by audience, created_at desc
  ) q;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'module_key', n.module_key,
      'href', n.href,
      'label', n.label,
      'priority', n.priority,
      'link_status', n.link_status
    )
    order by n.priority asc
  ), '[]'::jsonb)
  into v_modules
  from (
    select distinct on (module_key) *
    from public.os_firm_ops_module_nav_phase61_links
    where (v_entity is null and entity_id is null)
       or (v_entity is not null and entity_id = v_entity)
       or entity_id is null
    order by module_key, created_at desc
  ) n;

  -- Default module nav when none captured yet
  if v_modules = '[]'::jsonb then
    v_modules := jsonb_build_array(
      jsonb_build_object('module_key','command_center','href','/command-center','label','Command Center','priority',1,'link_status','missing'),
      jsonb_build_object('module_key','deal_flow','href','/deal-flow','label','Deal Flow','priority',2,'link_status','missing'),
      jsonb_build_object('module_key','portfolio','href','/portfolio','label','Portfolio','priority',3,'link_status','missing'),
      jsonb_build_object('module_key','shared_services','href','/shared-services','label','Shared Services','priority',4,'link_status','missing'),
      jsonb_build_object('module_key','finance','href','/shared-services/finance','label','Finance','priority',5,'link_status','missing'),
      jsonb_build_object('module_key','legal','href','/shared-services/legal/docusign','label','Legal','priority',6,'link_status','missing'),
      jsonb_build_object('module_key','marketing','href','/shared-services/marketing','label','Marketing','priority',7,'link_status','missing'),
      jsonb_build_object('module_key','firm','href','/firm','label','Firm','priority',8,'link_status','missing'),
      jsonb_build_object('module_key','documents','href','/documents','label','Documents','priority',9,'link_status','missing'),
      jsonb_build_object('module_key','entities','href','/entities','label','Entities','priority',10,'link_status','missing'),
      jsonb_build_object('module_key','recruit619','href','/entities/ENT-R619','label','Recruit 619','priority',11,'link_status','missing'),
      jsonb_build_object('module_key','activity','href','/activity','label','Activity','priority',12,'link_status','missing'),
      jsonb_build_object('module_key','messages','href','/messages','label','Messages','priority',13,'link_status','missing'),
      jsonb_build_object('module_key','settings','href','/settings/notifications','label','Notification prefs','priority',14,'link_status','missing')
    );
  end if;

  select coalesce(jsonb_agg(to_jsonb(a) - 'metrics_sha256' order by a.created_at desc), '[]'::jsonb)
  into v_ops_alerts
  from (
    select *
    from public.os_firm_ops_phase61_ops_alerts o
    where (v_entity is null or o.entity_id = v_entity or o.entity_id is null)
    order by o.created_at desc
    limit 20
  ) a;

  if v_alerts.snapshot_id is null then
    v_todo := 'Refresh Firm Ops command board; clear critical alerts and SLA breaches; keep Visionary/COO/Service Lead queues current';
  else
    v_todo := 'Work critical alerts first, then stale/breach board, then role action queues';
  end if;

  return jsonb_build_object(
    'entity_id', v_entity,
    'critical_count', coalesce(v_alerts.critical_count, 0),
    'warning_count', coalesce(v_alerts.warning_count, 0),
    'info_count', coalesce(v_alerts.info_count, 0),
    'by_service', coalesce(v_alerts.by_service, '{}'::jsonb),
    'alert_board_status', coalesce(v_alerts.board_status, 'missing'),
    'stale_count', coalesce(v_stale.stale_count, 0),
    'breach_count', coalesce(v_stale.breach_count, 0),
    'by_domain', coalesce(v_stale.by_domain, '{}'::jsonb),
    'stale_board_status', coalesce(v_stale.board_status, 'missing'),
    'snapshot_id', v_alerts.snapshot_id,
    'captured_at', v_alerts.created_at,
    'queues', v_queues,
    'modules', v_modules,
    'recent_alerts', v_ops_alerts,
    'entity_filter_hint', 'ENT-R619',
    'todo', v_todo,
    'money_auto_approve', false,
    'firm_ops_command', true,
    'contract_version', 'phase61-v1'
  );
end;
$$;

revoke all on function public.refresh_firm_ops_command_phase61(uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_firm_ops_command_phase61_report(text)
  from public, anon, authenticated;

grant execute on function public.refresh_firm_ops_command_phase61(uuid, text)
  to authenticated, service_role;
grant execute on function public.get_firm_ops_command_phase61_report(text)
  to authenticated, service_role;
