-- Phase 60: Portfolio Operating Cadence.
-- Weekly Visionary/COO tools: company health board, risk/milestone tracking,
-- operating review packets, handoff completeness indicators, subsidiary
-- linkage (ENT-R619 first; ENT-INDA when present).
-- Apply after Phase 59. Safe to re-run.
-- Append-only evidence only. Never mutates snapshot retirement tables.

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

create or replace function public.phase60_portfolio_safe_detail(p_detail jsonb)
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

create or replace function public.reject_portfolio_phase60_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Portfolio operating cadence Phase 60 evidence is append-only';
end;
$$;

-- ---------------------------------------------------------------------------
-- Portfolio company health board snapshots.
-- ---------------------------------------------------------------------------
create table if not exists public.os_portfolio_health_phase60_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  company_count integer not null default 0 check (company_count >= 0),
  on_track_count integer not null default 0 check (on_track_count >= 0),
  watch_count integer not null default 0 check (watch_count >= 0),
  at_risk_count integer not null default 0 check (at_risk_count >= 0),
  critical_count integer not null default 0 check (critical_count >= 0),
  attention_required integer not null default 0 check (attention_required >= 0),
  missing_risk_count integer not null default 0 check (missing_risk_count >= 0),
  missing_milestone_count integer not null default 0
    check (missing_milestone_count >= 0),
  board_status text not null default 'unknown'
    check (board_status in ('ok','partial','missing','unknown')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_port_health_p60_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=8192
      and public.phase60_portfolio_safe_detail(detail)
    )
);

create index if not exists os_port_health_p60_entity_created_idx
  on public.os_portfolio_health_phase60_snapshots(entity_id, created_at desc);
create index if not exists os_port_health_p60_created_idx
  on public.os_portfolio_health_phase60_snapshots(created_at desc);

alter table public.os_portfolio_health_phase60_snapshots
  enable row level security;
drop policy if exists "os_port_health_p60_select"
  on public.os_portfolio_health_phase60_snapshots;
create policy "os_port_health_p60_select"
  on public.os_portfolio_health_phase60_snapshots for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_portfolio_health_phase60_snapshots
  from public, anon, authenticated;
grant select on public.os_portfolio_health_phase60_snapshots
  to authenticated;

drop trigger if exists os_port_health_p60_immutable
  on public.os_portfolio_health_phase60_snapshots;
create trigger os_port_health_p60_immutable
  before update or delete on public.os_portfolio_health_phase60_snapshots
  for each row execute function public.reject_portfolio_phase60_mutation();
drop trigger if exists os_port_health_p60_no_truncate
  on public.os_portfolio_health_phase60_snapshots;
create trigger os_port_health_p60_no_truncate
  before truncate on public.os_portfolio_health_phase60_snapshots
  for each statement execute function public.reject_portfolio_phase60_mutation();

-- ---------------------------------------------------------------------------
-- Risk / milestone tracking events.
-- ---------------------------------------------------------------------------
create table if not exists public.os_portfolio_risk_milestone_phase60_events (
  event_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  portfolio_id text,
  event_kind text not null
    check (event_kind in ('risk','milestone','both')),
  title text not null check (char_length(title) between 2 and 240),
  status text not null default 'open'
    check (status in ('open','watch','mitigating','done','slipped')),
  severity text not null default 'info'
    check (severity in ('info','warning','critical')),
  due_on date,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_port_rm_p60_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase60_portfolio_safe_detail(detail)
    )
);

create index if not exists os_port_rm_p60_entity_created_idx
  on public.os_portfolio_risk_milestone_phase60_events(
    entity_id, created_at desc
  );
create index if not exists os_port_rm_p60_kind_created_idx
  on public.os_portfolio_risk_milestone_phase60_events(
    event_kind, created_at desc
  );

alter table public.os_portfolio_risk_milestone_phase60_events
  enable row level security;
drop policy if exists "os_port_rm_p60_select"
  on public.os_portfolio_risk_milestone_phase60_events;
create policy "os_port_rm_p60_select"
  on public.os_portfolio_risk_milestone_phase60_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_portfolio_risk_milestone_phase60_events
  from public, anon, authenticated;
grant select on public.os_portfolio_risk_milestone_phase60_events
  to authenticated;

drop trigger if exists os_port_rm_p60_immutable
  on public.os_portfolio_risk_milestone_phase60_events;
create trigger os_port_rm_p60_immutable
  before update or delete on public.os_portfolio_risk_milestone_phase60_events
  for each row execute function public.reject_portfolio_phase60_mutation();
drop trigger if exists os_port_rm_p60_no_truncate
  on public.os_portfolio_risk_milestone_phase60_events;
create trigger os_port_rm_p60_no_truncate
  before truncate on public.os_portfolio_risk_milestone_phase60_events
  for each statement execute function public.reject_portfolio_phase60_mutation();

-- ---------------------------------------------------------------------------
-- Operating review packets.
-- ---------------------------------------------------------------------------
create table if not exists public.os_portfolio_review_packet_phase60_events (
  event_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  portfolio_id text,
  packet_kind text not null
    check (packet_kind in (
      'weekly_ops','monthly_board','ad_hoc','subsidiary_deep_dive'
    )),
  title text not null check (char_length(title) between 2 and 240),
  period_key text not null
    check (period_key ~ '^[0-9]{4}(-[0-9]{2})?(-W[0-9]{2})?$'),
  completeness_status text not null default 'draft'
    check (completeness_status in (
      'draft','partial','ready','delivered','stale'
    )),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_port_pkt_p60_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase60_portfolio_safe_detail(detail)
    )
);

create index if not exists os_port_pkt_p60_entity_created_idx
  on public.os_portfolio_review_packet_phase60_events(
    entity_id, created_at desc
  );
create index if not exists os_port_pkt_p60_period_idx
  on public.os_portfolio_review_packet_phase60_events(period_key, created_at desc);

alter table public.os_portfolio_review_packet_phase60_events
  enable row level security;
drop policy if exists "os_port_pkt_p60_select"
  on public.os_portfolio_review_packet_phase60_events;
create policy "os_port_pkt_p60_select"
  on public.os_portfolio_review_packet_phase60_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_portfolio_review_packet_phase60_events
  from public, anon, authenticated;
grant select on public.os_portfolio_review_packet_phase60_events
  to authenticated;

drop trigger if exists os_port_pkt_p60_immutable
  on public.os_portfolio_review_packet_phase60_events;
create trigger os_port_pkt_p60_immutable
  before update or delete on public.os_portfolio_review_packet_phase60_events
  for each row execute function public.reject_portfolio_phase60_mutation();
drop trigger if exists os_port_pkt_p60_no_truncate
  on public.os_portfolio_review_packet_phase60_events;
create trigger os_port_pkt_p60_no_truncate
  before truncate on public.os_portfolio_review_packet_phase60_events
  for each statement execute function public.reject_portfolio_phase60_mutation();

-- ---------------------------------------------------------------------------
-- Handoff completeness indicator snapshots.
-- ---------------------------------------------------------------------------
create table if not exists public.os_portfolio_handoff_phase60_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  handoff_total integer not null default 0 check (handoff_total >= 0),
  handoff_complete integer not null default 0 check (handoff_complete >= 0),
  handoff_open integer not null default 0 check (handoff_open >= 0),
  handoff_incomplete integer not null default 0 check (handoff_incomplete >= 0),
  linked_to_portfolio integer not null default 0 check (linked_to_portfolio >= 0),
  completeness_pct numeric(5,2)
    check (completeness_pct is null or (completeness_pct >= 0 and completeness_pct <= 100)),
  board_status text not null default 'unknown'
    check (board_status in ('ok','partial','missing','unknown')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_port_ho_p60_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=8192
      and public.phase60_portfolio_safe_detail(detail)
    )
);

create index if not exists os_port_ho_p60_entity_created_idx
  on public.os_portfolio_handoff_phase60_snapshots(entity_id, created_at desc);
create index if not exists os_port_ho_p60_created_idx
  on public.os_portfolio_handoff_phase60_snapshots(created_at desc);

alter table public.os_portfolio_handoff_phase60_snapshots
  enable row level security;
drop policy if exists "os_port_ho_p60_select"
  on public.os_portfolio_handoff_phase60_snapshots;
create policy "os_port_ho_p60_select"
  on public.os_portfolio_handoff_phase60_snapshots for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_portfolio_handoff_phase60_snapshots
  from public, anon, authenticated;
grant select on public.os_portfolio_handoff_phase60_snapshots
  to authenticated;

drop trigger if exists os_port_ho_p60_immutable
  on public.os_portfolio_handoff_phase60_snapshots;
create trigger os_port_ho_p60_immutable
  before update or delete on public.os_portfolio_handoff_phase60_snapshots
  for each row execute function public.reject_portfolio_phase60_mutation();
drop trigger if exists os_port_ho_p60_no_truncate
  on public.os_portfolio_handoff_phase60_snapshots;
create trigger os_port_ho_p60_no_truncate
  before truncate on public.os_portfolio_handoff_phase60_snapshots
  for each statement execute function public.reject_portfolio_phase60_mutation();

-- ---------------------------------------------------------------------------
-- Subsidiary linkage (ENT-R619 first; ENT-INDA when evidence exists).
-- ---------------------------------------------------------------------------
create table if not exists public.os_portfolio_subsidiary_phase60_links (
  link_id uuid primary key default gen_random_uuid(),
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  portfolio_id text,
  link_status text not null default 'missing'
    check (link_status in ('ok','partial','missing','unknown')),
  priority integer not null default 99 check (priority >= 1 and priority <= 99),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_port_sub_p60_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase60_portfolio_safe_detail(detail)
    )
);

create index if not exists os_port_sub_p60_entity_created_idx
  on public.os_portfolio_subsidiary_phase60_links(entity_id, created_at desc);
create index if not exists os_port_sub_p60_priority_idx
  on public.os_portfolio_subsidiary_phase60_links(priority, created_at desc);

alter table public.os_portfolio_subsidiary_phase60_links
  enable row level security;
drop policy if exists "os_port_sub_p60_select"
  on public.os_portfolio_subsidiary_phase60_links;
create policy "os_port_sub_p60_select"
  on public.os_portfolio_subsidiary_phase60_links for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_portfolio_subsidiary_phase60_links
  from public, anon, authenticated;
grant select on public.os_portfolio_subsidiary_phase60_links
  to authenticated;

drop trigger if exists os_port_sub_p60_immutable
  on public.os_portfolio_subsidiary_phase60_links;
create trigger os_port_sub_p60_immutable
  before update or delete on public.os_portfolio_subsidiary_phase60_links
  for each row execute function public.reject_portfolio_phase60_mutation();
drop trigger if exists os_port_sub_p60_no_truncate
  on public.os_portfolio_subsidiary_phase60_links;
create trigger os_port_sub_p60_no_truncate
  before truncate on public.os_portfolio_subsidiary_phase60_links
  for each statement execute function public.reject_portfolio_phase60_mutation();

-- ---------------------------------------------------------------------------
-- Ops alerts.
-- ---------------------------------------------------------------------------
create table if not exists public.os_portfolio_phase60_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  alert_kind text not null
    check (alert_kind in (
      'health_attention','missing_risk','missing_milestone',
      'handoff_incomplete','review_packet_stale','subsidiary_gap',
      'refresh_failed'
    )),
  reference_id uuid,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null default 'warning'
    check (severity in ('info','warning','critical')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_port_ops_p60_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase60_portfolio_safe_detail(detail)
    )
);

create index if not exists os_port_ops_p60_entity_created_idx
  on public.os_portfolio_phase60_ops_alerts(entity_id, created_at desc);
create index if not exists os_port_ops_p60_kind_created_idx
  on public.os_portfolio_phase60_ops_alerts(alert_kind, created_at desc);

alter table public.os_portfolio_phase60_ops_alerts
  enable row level security;
drop policy if exists "os_port_ops_p60_select"
  on public.os_portfolio_phase60_ops_alerts;
create policy "os_port_ops_p60_select"
  on public.os_portfolio_phase60_ops_alerts for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_portfolio_phase60_ops_alerts
  from public, anon, authenticated;
grant select on public.os_portfolio_phase60_ops_alerts
  to authenticated;

drop trigger if exists os_port_ops_p60_immutable
  on public.os_portfolio_phase60_ops_alerts;
create trigger os_port_ops_p60_immutable
  before update or delete on public.os_portfolio_phase60_ops_alerts
  for each row execute function public.reject_portfolio_phase60_mutation();
drop trigger if exists os_port_ops_p60_no_truncate
  on public.os_portfolio_phase60_ops_alerts;
create trigger os_port_ops_p60_no_truncate
  before truncate on public.os_portfolio_phase60_ops_alerts
  for each statement execute function public.reject_portfolio_phase60_mutation();

-- ---------------------------------------------------------------------------
-- Record risk / milestone tracking event.
-- ---------------------------------------------------------------------------
create or replace function public.record_portfolio_risk_milestone_phase60(
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := nullif(trim(coalesce(p_payload->>'entity_id','')),'');
  v_portfolio text := nullif(trim(coalesce(p_payload->>'portfolio_id','')),'');
  v_kind text := nullif(trim(coalesce(p_payload->>'event_kind','')),'');
  v_title text := nullif(trim(coalesce(p_payload->>'title','')),'');
  v_status text := nullif(trim(coalesce(p_payload->>'status','')),'');
  v_severity text := nullif(trim(coalesce(p_payload->>'severity','')),'');
  v_due date := nullif(p_payload->>'due_on','')::date;
  v_actor uuid := nullif(p_payload->>'actor_id','')::uuid;
  v_meta jsonb := coalesce(p_payload->'detail', '{}'::jsonb);
  v_window text;
  v_hash text;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Phase 60 risk/milestone payload must be a JSON object';
  end if;
  if v_kind is null then
    v_kind := 'risk';
  end if;
  if v_status is null then
    v_status := 'open';
  end if;
  if v_severity is null then
    v_severity := 'info';
  end if;
  if v_title is null
     or char_length(v_title) < 2
     or v_kind not in ('risk','milestone','both')
     or v_status not in ('open','watch','mitigating','done','slipped')
     or v_severity not in ('info','warning','critical')
     or (v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$')
     or not public.phase60_portfolio_safe_detail(v_meta) then
    raise exception 'Phase 60 risk/milestone contract is invalid or unsafe';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 60 risk/milestone';
  end if;

  v_window := left(
    'phase60:rm:' || coalesce(v_entity,'firm') || ':' || v_kind || ':'
      || substr(public.os_sha256_hex(v_title || '|' || coalesce(v_portfolio,'')), 1, 12)
      || ':' || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24MI'),
    200
  );
  v_hash := public.os_sha256_hex(
    coalesce(v_entity,'firm') || '|' || v_kind || '|' || v_title || '|' || v_window
  );

  insert into public.os_portfolio_risk_milestone_phase60_events (
    entity_id, portfolio_id, event_kind, title, status, severity, due_on,
    window_key, metrics_sha256, detail, actor_id
  ) values (
    v_entity, v_portfolio, v_kind, v_title, v_status, v_severity, v_due,
    v_window, v_hash,
    v_meta || jsonb_build_object('contract_version','phase60-v1'),
    v_actor
  )
  on conflict (window_key) do nothing
  returning event_id into v_id;

  if v_id is null then
    select event_id into v_id
    from public.os_portfolio_risk_milestone_phase60_events
    where window_key = v_window;
  end if;

  return jsonb_build_object(
    'event_id', v_id,
    'entity_id', v_entity,
    'event_kind', v_kind,
    'status', v_status,
    'contract_version', 'phase60-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record operating review packet.
-- ---------------------------------------------------------------------------
create or replace function public.record_portfolio_review_packet_phase60(
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := nullif(trim(coalesce(p_payload->>'entity_id','')),'');
  v_portfolio text := nullif(trim(coalesce(p_payload->>'portfolio_id','')),'');
  v_kind text := nullif(trim(coalesce(p_payload->>'packet_kind','')),'');
  v_title text := nullif(trim(coalesce(p_payload->>'title','')),'');
  v_period text := nullif(trim(coalesce(p_payload->>'period_key','')),'');
  v_status text := nullif(trim(coalesce(p_payload->>'completeness_status','')),'');
  v_actor uuid := nullif(p_payload->>'actor_id','')::uuid;
  v_meta jsonb := coalesce(p_payload->'detail', '{}'::jsonb);
  v_window text;
  v_hash text;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Phase 60 review packet payload must be a JSON object';
  end if;
  if v_kind is null then
    v_kind := 'weekly_ops';
  end if;
  if v_status is null then
    v_status := 'draft';
  end if;
  if v_period is null then
    v_period := to_char(now() at time zone 'utc','IYYY') || '-W'
      || lpad(to_char(now() at time zone 'utc','IW'), 2, '0');
  end if;
  if v_title is null
     or char_length(v_title) < 2
     or v_kind not in (
       'weekly_ops','monthly_board','ad_hoc','subsidiary_deep_dive'
     )
     or v_status not in ('draft','partial','ready','delivered','stale')
     or v_period !~ '^[0-9]{4}(-[0-9]{2})?(-W[0-9]{2})?$'
     or (v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$')
     or not public.phase60_portfolio_safe_detail(v_meta) then
    raise exception 'Phase 60 review packet contract is invalid or unsafe';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 60 review packet';
  end if;

  v_window := left(
    'phase60:pkt:' || coalesce(v_entity,'firm') || ':' || v_kind || ':'
      || v_period || ':'
      || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24'),
    200
  );
  v_hash := public.os_sha256_hex(
    coalesce(v_entity,'firm') || '|' || v_kind || '|' || v_period || '|' || v_window
  );

  insert into public.os_portfolio_review_packet_phase60_events (
    entity_id, portfolio_id, packet_kind, title, period_key,
    completeness_status, window_key, metrics_sha256, detail, actor_id
  ) values (
    v_entity, v_portfolio, v_kind, v_title, v_period, v_status,
    v_window, v_hash,
    v_meta || jsonb_build_object('contract_version','phase60-v1'),
    v_actor
  )
  on conflict (window_key) do nothing
  returning event_id into v_id;

  if v_id is null then
    select event_id into v_id
    from public.os_portfolio_review_packet_phase60_events
    where window_key = v_window;
  end if;

  if v_status = 'stale' then
    insert into public.os_portfolio_phase60_ops_alerts (
      entity_id, alert_kind, reference_id, window_key, severity,
      metrics_sha256, detail
    ) values (
      v_entity, 'review_packet_stale', v_id,
      left(
        'phase60:alert:pkt_stale:' || coalesce(v_entity,'firm') || ':'
          || v_period,
        200
      ),
      'warning', v_hash,
      jsonb_build_object(
        'contract_version','phase60-v1',
        'packet_kind', v_kind,
        'period_key', v_period
      )
    ) on conflict (window_key) do nothing;
  end if;

  return jsonb_build_object(
    'event_id', v_id,
    'entity_id', v_entity,
    'packet_kind', v_kind,
    'period_key', v_period,
    'completeness_status', v_status,
    'contract_version', 'phase60-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Refresh portfolio operating cadence board (observe + evidence only).
-- ---------------------------------------------------------------------------
create or replace function public.refresh_portfolio_operating_cadence_phase60(
  p_actor_id uuid default null,
  p_entity_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := nullif(trim(coalesce(p_entity_id,'')),'');
  v_company_count integer := 0;
  v_on_track integer := 0;
  v_watch integer := 0;
  v_at_risk integer := 0;
  v_critical integer := 0;
  v_attention integer := 0;
  v_missing_risk integer := 0;
  v_missing_ms integer := 0;
  v_board text := 'missing';
  v_ho_total integer := 0;
  v_ho_complete integer := 0;
  v_ho_open integer := 0;
  v_ho_incomplete integer := 0;
  v_ho_linked integer := 0;
  v_ho_pct numeric(5,2) := null;
  v_ho_board text := 'missing';
  v_has_portfolio boolean := false;
  v_has_handoffs boolean := false;
  v_has_entities boolean := false;
  v_r619_exists boolean := false;
  v_inda_exists boolean := false;
  v_r619_pf text := null;
  v_inda_pf text := null;
  v_r619_status text := 'missing';
  v_inda_status text := 'missing';
  v_window text;
  v_hash text;
  v_id uuid;
  v_ho_id uuid;
begin
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 60 portfolio refresh';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 60 portfolio refresh';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is null then
    raise exception 'Firm-wide access or entity filter required for Phase 60 portfolio refresh';
  end if;

  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='portfolio_companies'
  ) into v_has_portfolio;
  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_handoffs'
  ) into v_has_handoffs;
  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='entities'
  ) into v_has_entities;

  if v_has_portfolio then
    begin
      execute
        'select
           count(*)::integer,
           count(*) filter (where health = ''On Track'')::integer,
           count(*) filter (where health = ''Watch'')::integer,
           count(*) filter (where health = ''At Risk'')::integer,
           count(*) filter (where health = ''Critical'')::integer,
           count(*) filter (
             where top_risk is null or btrim(top_risk) = ''''
           )::integer,
           count(*) filter (
             where next_milestone is null or btrim(next_milestone) = ''''
           )::integer
         from public.portfolio_companies
         where ($1::text is null or entity_id = $1)'
      into v_company_count, v_on_track, v_watch, v_at_risk, v_critical,
           v_missing_risk, v_missing_ms
      using v_entity;
    exception when others then
      v_company_count := 0;
      v_on_track := 0;
      v_watch := 0;
      v_at_risk := 0;
      v_critical := 0;
      v_missing_risk := 0;
      v_missing_ms := 0;
    end;
  end if;

  v_attention := coalesce(v_at_risk,0) + coalesce(v_critical,0);

  if coalesce(v_company_count,0) = 0 then
    v_board := 'missing';
  elsif coalesce(v_critical,0) > 0 then
    v_board := 'partial';
  elsif coalesce(v_at_risk,0) > 0
        or coalesce(v_missing_risk,0) > 0
        or coalesce(v_missing_ms,0) > 0 then
    v_board := 'partial';
  else
    v_board := 'ok';
  end if;

  if v_has_handoffs then
    begin
      execute
        'select
           count(*)::integer,
           count(*) filter (
             where lower(status) in (
               ''complete'',''completed'',''done'',''closed'',''accepted''
             )
           )::integer,
           count(*) filter (
             where lower(status) in (
               ''open'',''in_progress'',''pending'',''draft''
             )
           )::integer,
           count(*) filter (
             where portfolio_id is not null and btrim(portfolio_id) <> ''''
           )::integer
         from public.os_handoffs
         where ($1::text is null or entity_id = $1 or entity_id is null)'
      into v_ho_total, v_ho_complete, v_ho_open, v_ho_linked
      using v_entity;
    exception when others then
      v_ho_total := 0;
      v_ho_complete := 0;
      v_ho_open := 0;
      v_ho_linked := 0;
    end;
  end if;

  v_ho_incomplete := greatest(
    coalesce(v_ho_total,0) - coalesce(v_ho_complete,0),
    0
  );

  if coalesce(v_ho_total,0) = 0 then
    v_ho_board := 'missing';
    v_ho_pct := null;
  else
    v_ho_pct := round(
      (100.0 * coalesce(v_ho_complete,0)::numeric)
        / nullif(v_ho_total,0)::numeric,
      2
    );
    if coalesce(v_ho_incomplete,0) = 0 then
      v_ho_board := 'ok';
    elsif coalesce(v_ho_complete,0) > 0 then
      v_ho_board := 'partial';
    else
      v_ho_board := 'partial';
    end if;
  end if;

  if v_has_entities then
    begin
      execute
        'select exists (
           select 1 from public.entities where entity_id = ''ENT-R619''
         ),
         exists (
           select 1 from public.entities where entity_id = ''ENT-INDA''
         )'
      into v_r619_exists, v_inda_exists;
    exception when others then
      v_r619_exists := false;
      v_inda_exists := false;
    end;
  end if;

  -- Recruit is always first-class for subsidiary linkage.
  v_r619_exists := true;

  if v_has_portfolio then
    begin
      execute
        'select portfolio_id
         from public.portfolio_companies
         where entity_id = ''ENT-R619''
         order by updated_at desc
         limit 1'
      into v_r619_pf;
    exception when others then
      v_r619_pf := null;
    end;
    begin
      execute
        'select portfolio_id
         from public.portfolio_companies
         where entity_id = ''ENT-INDA''
         order by updated_at desc
         limit 1'
      into v_inda_pf;
    exception when others then
      v_inda_pf := null;
    end;
  end if;

  if v_r619_pf is not null then
    v_r619_status := 'ok';
  else
    v_r619_status := 'missing';
  end if;

  if v_inda_exists and v_inda_pf is not null then
    v_inda_status := 'ok';
  elsif v_inda_exists then
    v_inda_status := 'partial';
  else
    v_inda_status := 'missing';
  end if;

  -- Subsidiary links: ENT-R619 first, ENT-INDA when present.
  insert into public.os_portfolio_subsidiary_phase60_links (
    entity_id, portfolio_id, link_status, priority, window_key,
    metrics_sha256, detail
  ) values (
    'ENT-R619', v_r619_pf, v_r619_status, 1,
    left(
      'phase60:sub:ENT-R619:'
        || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24'),
      200
    ),
    public.os_sha256_hex('sub|ENT-R619|' || v_r619_status || '|' || coalesce(v_r619_pf,'')),
    jsonb_build_object(
      'contract_version','phase60-v1',
      'name','Recruit 619',
      'priority',1,
      'todo', case
        when v_r619_status = 'missing'
          then 'TODO: ensure ENT-R619 portfolio company row + weekly cadence'
        else null
      end
    )
  ) on conflict (window_key) do nothing;

  if v_inda_exists then
    insert into public.os_portfolio_subsidiary_phase60_links (
      entity_id, portfolio_id, link_status, priority, window_key,
      metrics_sha256, detail
    ) values (
      'ENT-INDA', v_inda_pf, v_inda_status, 2,
      left(
        'phase60:sub:ENT-INDA:'
          || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24'),
        200
      ),
      public.os_sha256_hex(
        'sub|ENT-INDA|' || v_inda_status || '|' || coalesce(v_inda_pf,'')
      ),
      jsonb_build_object(
        'contract_version','phase60-v1',
        'name','Instant NDA',
        'priority',2,
        'todo', case
          when v_inda_status <> 'ok'
            then 'TODO: show ENT-INDA portfolio cadence when portfolio evidence exists'
          else null
        end
      )
    ) on conflict (window_key) do nothing;
  end if;

  -- Handoff completeness snapshot
  v_window := left(
    'phase60:ho:' || coalesce(v_entity,'firm') || ':'
      || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24'),
    200
  );
  v_hash := public.os_sha256_hex(
    coalesce(v_entity,'firm') || '|ho|' || coalesce(v_ho_total,0)::text || '|'
    || coalesce(v_ho_complete,0)::text || '|' || v_ho_board
  );

  insert into public.os_portfolio_handoff_phase60_snapshots (
    entity_id, window_key, handoff_total, handoff_complete, handoff_open,
    handoff_incomplete, linked_to_portfolio, completeness_pct, board_status,
    metrics_sha256, detail, actor_id
  ) values (
    v_entity, v_window,
    coalesce(v_ho_total,0), coalesce(v_ho_complete,0), coalesce(v_ho_open,0),
    coalesce(v_ho_incomplete,0), coalesce(v_ho_linked,0), v_ho_pct, v_ho_board,
    v_hash,
    jsonb_build_object(
      'contract_version','phase60-v1',
      'source','refresh_portfolio_operating_cadence_phase60'
    ),
    p_actor_id
  )
  on conflict (window_key) do nothing
  returning snapshot_id into v_ho_id;

  if v_ho_id is null then
    select snapshot_id into v_ho_id
    from public.os_portfolio_handoff_phase60_snapshots
    where window_key = v_window;
  end if;

  -- Ops alerts
  if coalesce(v_attention,0) > 0 then
    insert into public.os_portfolio_phase60_ops_alerts (
      entity_id, alert_kind, window_key, severity, metrics_sha256, detail
    ) values (
      v_entity, 'health_attention',
      left(
        'phase60:alert:attention:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      case when coalesce(v_critical,0) > 0 then 'critical' else 'warning' end,
      public.os_sha256_hex(
        'attention|' || coalesce(v_entity,'firm') || '|' || v_attention::text
      ),
      jsonb_build_object(
        'contract_version','phase60-v1',
        'attention_required', v_attention,
        'critical_count', coalesce(v_critical,0),
        'at_risk_count', coalesce(v_at_risk,0)
      )
    ) on conflict (window_key) do nothing;
  end if;

  if coalesce(v_missing_risk,0) > 0 then
    insert into public.os_portfolio_phase60_ops_alerts (
      entity_id, alert_kind, window_key, severity, metrics_sha256, detail
    ) values (
      v_entity, 'missing_risk',
      left(
        'phase60:alert:missing_risk:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      'warning',
      public.os_sha256_hex(
        'missing_risk|' || coalesce(v_entity,'firm') || '|' || v_missing_risk::text
      ),
      jsonb_build_object(
        'contract_version','phase60-v1',
        'missing_risk_count', v_missing_risk
      )
    ) on conflict (window_key) do nothing;
  end if;

  if coalesce(v_missing_ms,0) > 0 then
    insert into public.os_portfolio_phase60_ops_alerts (
      entity_id, alert_kind, window_key, severity, metrics_sha256, detail
    ) values (
      v_entity, 'missing_milestone',
      left(
        'phase60:alert:missing_ms:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      'warning',
      public.os_sha256_hex(
        'missing_ms|' || coalesce(v_entity,'firm') || '|' || v_missing_ms::text
      ),
      jsonb_build_object(
        'contract_version','phase60-v1',
        'missing_milestone_count', v_missing_ms
      )
    ) on conflict (window_key) do nothing;
  end if;

  if coalesce(v_ho_incomplete,0) > 0 then
    insert into public.os_portfolio_phase60_ops_alerts (
      entity_id, alert_kind, reference_id, window_key, severity,
      metrics_sha256, detail
    ) values (
      v_entity, 'handoff_incomplete', v_ho_id,
      left(
        'phase60:alert:ho_incomplete:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      'warning',
      public.os_sha256_hex(
        'ho_incomplete|' || coalesce(v_entity,'firm') || '|'
        || v_ho_incomplete::text
      ),
      jsonb_build_object(
        'contract_version','phase60-v1',
        'handoff_incomplete', v_ho_incomplete,
        'handoff_total', coalesce(v_ho_total,0)
      )
    ) on conflict (window_key) do nothing;
  end if;

  if v_r619_status = 'missing' then
    insert into public.os_portfolio_phase60_ops_alerts (
      entity_id, alert_kind, window_key, severity, metrics_sha256, detail
    ) values (
      'ENT-R619', 'subsidiary_gap',
      left(
        'phase60:alert:sub_gap:ENT-R619:'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      'warning',
      public.os_sha256_hex('sub_gap|ENT-R619'),
      jsonb_build_object(
        'contract_version','phase60-v1',
        'todo', 'TODO: ensure ENT-R619 portfolio company row + weekly cadence'
      )
    ) on conflict (window_key) do nothing;
  end if;

  if v_inda_exists and v_inda_status <> 'ok' then
    insert into public.os_portfolio_phase60_ops_alerts (
      entity_id, alert_kind, window_key, severity, metrics_sha256, detail
    ) values (
      'ENT-INDA', 'subsidiary_gap',
      left(
        'phase60:alert:sub_gap:ENT-INDA:'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      'info',
      public.os_sha256_hex('sub_gap|ENT-INDA'),
      jsonb_build_object(
        'contract_version','phase60-v1',
        'todo', 'TODO: show ENT-INDA portfolio cadence when portfolio evidence exists'
      )
    ) on conflict (window_key) do nothing;
  end if;

  -- Health board snapshot
  v_window := left(
    'phase60:health:' || coalesce(v_entity,'firm') || ':'
      || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24'),
    200
  );
  v_hash := public.os_sha256_hex(
    coalesce(v_entity,'firm') || '|' || coalesce(v_company_count,0)::text || '|'
    || coalesce(v_attention,0)::text || '|' || v_board || '|' || v_window
  );

  insert into public.os_portfolio_health_phase60_snapshots (
    entity_id, window_key, company_count, on_track_count, watch_count,
    at_risk_count, critical_count, attention_required, missing_risk_count,
    missing_milestone_count, board_status, metrics_sha256, detail, actor_id
  ) values (
    v_entity, v_window,
    coalesce(v_company_count,0), coalesce(v_on_track,0), coalesce(v_watch,0),
    coalesce(v_at_risk,0), coalesce(v_critical,0), coalesce(v_attention,0),
    coalesce(v_missing_risk,0), coalesce(v_missing_ms,0), v_board, v_hash,
    jsonb_build_object(
      'contract_version','phase60-v1',
      'source','refresh_portfolio_operating_cadence_phase60',
      'handoff_board_status', v_ho_board,
      'handoff_completeness_pct', v_ho_pct,
      'handoff_total', coalesce(v_ho_total,0),
      'handoff_complete', coalesce(v_ho_complete,0),
      'handoff_incomplete', coalesce(v_ho_incomplete,0),
      'linked_to_portfolio', coalesce(v_ho_linked,0),
      'recruit_link_status', v_r619_status,
      'inda_link_status', v_inda_status,
      'inda_present', v_inda_exists,
      'entity_filter_hint','ENT-R619',
      'weekly_cadence', true
    ),
    p_actor_id
  )
  on conflict (window_key) do nothing
  returning snapshot_id into v_id;

  if v_id is null then
    select snapshot_id into v_id
    from public.os_portfolio_health_phase60_snapshots
    where window_key = v_window;
  end if;

  return jsonb_build_object(
    'snapshot_id', v_id,
    'entity_id', v_entity,
    'company_count', coalesce(v_company_count,0),
    'on_track_count', coalesce(v_on_track,0),
    'watch_count', coalesce(v_watch,0),
    'at_risk_count', coalesce(v_at_risk,0),
    'critical_count', coalesce(v_critical,0),
    'attention_required', coalesce(v_attention,0),
    'missing_risk_count', coalesce(v_missing_risk,0),
    'missing_milestone_count', coalesce(v_missing_ms,0),
    'board_status', v_board,
    'handoff_total', coalesce(v_ho_total,0),
    'handoff_complete', coalesce(v_ho_complete,0),
    'handoff_incomplete', coalesce(v_ho_incomplete,0),
    'handoff_board_status', v_ho_board,
    'completeness_pct', v_ho_pct,
    'recruit_link_status', v_r619_status,
    'inda_link_status', v_inda_status,
    'weekly_cadence', true,
    'contract_version', 'phase60-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Report: Portfolio operating cadence board.
-- ---------------------------------------------------------------------------
create or replace function public.get_portfolio_operating_cadence_phase60_report(
  p_entity_id text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_entity text := nullif(trim(coalesce(p_entity_id,'')),'');
  v_latest public.os_portfolio_health_phase60_snapshots%rowtype;
  v_ho public.os_portfolio_handoff_phase60_snapshots%rowtype;
  v_risks jsonb := '[]'::jsonb;
  v_packets jsonb := '[]'::jsonb;
  v_subs jsonb := '[]'::jsonb;
  v_ops_alerts jsonb := '[]'::jsonb;
  v_todo text;
begin
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 60 portfolio report';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 60 portfolio report';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is null then
    raise exception 'Firm-wide access or entity filter required for Phase 60 portfolio report';
  end if;

  select * into v_latest
  from public.os_portfolio_health_phase60_snapshots s
  where (v_entity is null and s.entity_id is null)
     or (v_entity is not null and s.entity_id = v_entity)
  order by s.created_at desc
  limit 1;

  select * into v_ho
  from public.os_portfolio_handoff_phase60_snapshots s
  where (v_entity is null and s.entity_id is null)
     or (v_entity is not null and s.entity_id = v_entity)
  order by s.created_at desc
  limit 1;

  select coalesce(jsonb_agg(to_jsonb(r) - 'metrics_sha256' order by r.created_at desc), '[]'::jsonb)
  into v_risks
  from (
    select *
    from public.os_portfolio_risk_milestone_phase60_events e
    where (v_entity is null or e.entity_id = v_entity or e.entity_id is null)
    order by e.created_at desc
    limit 20
  ) r;

  select coalesce(jsonb_agg(to_jsonb(p) - 'metrics_sha256' order by p.created_at desc), '[]'::jsonb)
  into v_packets
  from (
    select *
    from public.os_portfolio_review_packet_phase60_events e
    where (v_entity is null or e.entity_id = v_entity or e.entity_id is null)
    order by e.created_at desc
    limit 20
  ) p;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'entity_id', l.entity_id,
      'name', coalesce(l.detail->>'name', l.entity_id),
      'priority', l.priority,
      'link_status', l.link_status,
      'portfolio_id', l.portfolio_id,
      'has_data', l.link_status in ('ok','partial'),
      'todo', l.detail->>'todo',
      'created_at', l.created_at
    )
    order by l.priority asc, l.created_at desc
  ), '[]'::jsonb)
  into v_subs
  from (
    select distinct on (entity_id) *
    from public.os_portfolio_subsidiary_phase60_links
    where entity_id in ('ENT-R619','ENT-INDA')
    order by entity_id, created_at desc
  ) l;

  -- Always surface Recruit first even before first refresh.
  if v_subs = '[]'::jsonb or not exists (
    select 1 from jsonb_array_elements(v_subs) s
    where s->>'entity_id' = 'ENT-R619'
  ) then
    v_subs := jsonb_build_array(
      jsonb_build_object(
        'entity_id','ENT-R619',
        'name','Recruit 619',
        'priority',1,
        'link_status','missing',
        'portfolio_id',null,
        'has_data',false,
        'todo','TODO: ensure ENT-R619 portfolio company row + weekly cadence',
        'created_at',null
      )
    ) || coalesce(v_subs, '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(to_jsonb(a) - 'metrics_sha256' order by a.created_at desc), '[]'::jsonb)
  into v_ops_alerts
  from (
    select *
    from public.os_portfolio_phase60_ops_alerts o
    where (v_entity is null or o.entity_id = v_entity or o.entity_id is null)
    order by o.created_at desc
    limit 20
  ) a;

  if v_latest.snapshot_id is null then
    v_todo := 'Refresh portfolio operating cadence board; track risks/milestones; publish weekly review packets for ENT-R619';
  else
    v_todo := 'Weekly cadence: refresh health board, clear missing risks/milestones, keep handoffs complete';
  end if;

  return jsonb_build_object(
    'entity_id', v_entity,
    'company_count', coalesce(v_latest.company_count, 0),
    'on_track_count', coalesce(v_latest.on_track_count, 0),
    'watch_count', coalesce(v_latest.watch_count, 0),
    'at_risk_count', coalesce(v_latest.at_risk_count, 0),
    'critical_count', coalesce(v_latest.critical_count, 0),
    'attention_required', coalesce(v_latest.attention_required, 0),
    'missing_risk_count', coalesce(v_latest.missing_risk_count, 0),
    'missing_milestone_count', coalesce(v_latest.missing_milestone_count, 0),
    'board_status', coalesce(v_latest.board_status, 'missing'),
    'handoff_total', coalesce(v_ho.handoff_total, (v_latest.detail->>'handoff_total')::integer, 0),
    'handoff_complete', coalesce(v_ho.handoff_complete, (v_latest.detail->>'handoff_complete')::integer, 0),
    'handoff_open', coalesce(v_ho.handoff_open, 0),
    'handoff_incomplete', coalesce(v_ho.handoff_incomplete, (v_latest.detail->>'handoff_incomplete')::integer, 0),
    'linked_to_portfolio', coalesce(v_ho.linked_to_portfolio, (v_latest.detail->>'linked_to_portfolio')::integer, 0),
    'handoff_completeness_pct', coalesce(v_ho.completeness_pct, (v_latest.detail->>'handoff_completeness_pct')::numeric),
    'handoff_board_status', coalesce(v_ho.board_status, v_latest.detail->>'handoff_board_status', 'missing'),
    'snapshot_id', v_latest.snapshot_id,
    'captured_at', v_latest.created_at,
    'risks_milestones', v_risks,
    'review_packets', v_packets,
    'subsidiaries', v_subs,
    'recent_alerts', v_ops_alerts,
    'entity_filter_hint', 'ENT-R619',
    'todo', v_todo,
    'weekly_cadence', true,
    'contract_version', 'phase60-v1'
  );
end;
$$;

revoke all on function public.record_portfolio_risk_milestone_phase60(jsonb)
  from public, anon, authenticated;
revoke all on function public.record_portfolio_review_packet_phase60(jsonb)
  from public, anon, authenticated;
revoke all on function public.refresh_portfolio_operating_cadence_phase60(uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_portfolio_operating_cadence_phase60_report(text)
  from public, anon, authenticated;

grant execute on function public.record_portfolio_risk_milestone_phase60(jsonb)
  to authenticated, service_role;
grant execute on function public.record_portfolio_review_packet_phase60(jsonb)
  to authenticated, service_role;
grant execute on function public.refresh_portfolio_operating_cadence_phase60(uuid, text)
  to authenticated, service_role;
grant execute on function public.get_portfolio_operating_cadence_phase60_report(text)
  to authenticated, service_role;
