-- Phase 53: Subsidiary Rollup Hub (Recruit 619 first — ENT-R619).
-- Append-only evidence/snapshots for recruiting ops rollup metrics.
-- Apply after Phase 52. Safe to re-run.
-- Fail-soft when Recruit feed tables/APIs are missing or partial.
-- Never auto-approves money. Never mutates snapshot retirement tables.

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

create or replace function public.phase53_subsidiary_rollup_safe_detail(p_detail jsonb)
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
        '"[^"]*(payload|secret|token|password|authorization|cookie|body|bytes|base64|webhook_url)[^"]*"\s*:'
      and p_detail::text !~*
        '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
    );
$$;

-- ---------------------------------------------------------------------------
-- Append-only Recruit-first subsidiary rollup snapshots (ENT-R619 scoped).
-- ---------------------------------------------------------------------------
create table if not exists public.os_subsidiary_rollup_phase53_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  open_reqs integer check (open_reqs is null or open_reqs >= 0),
  pipeline_volume integer check (pipeline_volume is null or pipeline_volume >= 0),
  submissions integer check (submissions is null or submissions >= 0),
  interviews integer check (interviews is null or interviews >= 0),
  offers integer check (offers is null or offers >= 0),
  placements integer check (placements is null or placements >= 0),
  source_mix jsonb not null default '{}'::jsonb,
  time_to_fill_days numeric(10,2)
    check (time_to_fill_days is null or time_to_fill_days >= 0),
  time_to_place_days numeric(10,2)
    check (time_to_place_days is null or time_to_place_days >= 0),
  freshness text not null default 'unknown'
    check (freshness in ('fresh','stale','partial','unknown')),
  feed_status text not null default 'unknown'
    check (feed_status in ('ok','partial','missing','unknown')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_sub_rollup_p53_entity_recruit_check
    check (entity_id = 'ENT-R619'),
  constraint os_sub_rollup_p53_source_mix_check
    check (
      jsonb_typeof(source_mix)='object'
      and pg_column_size(source_mix)<=4096
      and public.phase53_subsidiary_rollup_safe_detail(source_mix)
    ),
  constraint os_sub_rollup_p53_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=8192
      and public.phase53_subsidiary_rollup_safe_detail(detail)
    ),
  constraint os_sub_rollup_p53_no_money_approve_check
    check (coalesce((detail->>'money_auto_approve')::boolean,false)=false)
);

create index if not exists os_sub_rollup_p53_entity_created_idx
  on public.os_subsidiary_rollup_phase53_snapshots(entity_id, created_at desc);

alter table public.os_subsidiary_rollup_phase53_snapshots enable row level security;
drop policy if exists "os_sub_rollup_p53_select"
  on public.os_subsidiary_rollup_phase53_snapshots;
create policy "os_sub_rollup_p53_select"
  on public.os_subsidiary_rollup_phase53_snapshots for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_subsidiary_rollup_phase53_snapshots
  from public, anon, authenticated;
grant select on public.os_subsidiary_rollup_phase53_snapshots
  to authenticated;

create or replace function public.reject_subsidiary_rollup_phase53_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Subsidiary rollup Phase 53 evidence is append-only';
end;
$$;

drop trigger if exists os_sub_rollup_p53_immutable
  on public.os_subsidiary_rollup_phase53_snapshots;
create trigger os_sub_rollup_p53_immutable
  before update or delete on public.os_subsidiary_rollup_phase53_snapshots
  for each row execute function public.reject_subsidiary_rollup_phase53_mutation();
drop trigger if exists os_sub_rollup_p53_no_truncate
  on public.os_subsidiary_rollup_phase53_snapshots;
create trigger os_sub_rollup_p53_no_truncate
  before truncate on public.os_subsidiary_rollup_phase53_snapshots
  for each statement execute function public.reject_subsidiary_rollup_phase53_mutation();

-- Optional ops alerts (stale / missing feed) — append-only visibility only.
create table if not exists public.os_subsidiary_rollup_phase53_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  entity_id text not null check (entity_id = 'ENT-R619'),
  alert_kind text not null
    check (alert_kind in (
      'feed_missing','feed_partial','metrics_stale','refresh_failed'
    )),
  reference_id uuid,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null default 'warning'
    check (severity in ('info','warning','critical')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_sub_rollup_p53_alert_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase53_subsidiary_rollup_safe_detail(detail)
    )
);

create index if not exists os_sub_rollup_p53_alerts_created_idx
  on public.os_subsidiary_rollup_phase53_ops_alerts(created_at desc);

alter table public.os_subsidiary_rollup_phase53_ops_alerts enable row level security;
drop policy if exists "os_sub_rollup_p53_alerts_select"
  on public.os_subsidiary_rollup_phase53_ops_alerts;
create policy "os_sub_rollup_p53_alerts_select"
  on public.os_subsidiary_rollup_phase53_ops_alerts for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_subsidiary_rollup_phase53_ops_alerts
  from public, anon, authenticated;
grant select on public.os_subsidiary_rollup_phase53_ops_alerts
  to authenticated;

drop trigger if exists os_sub_rollup_p53_alerts_immutable
  on public.os_subsidiary_rollup_phase53_ops_alerts;
create trigger os_sub_rollup_p53_alerts_immutable
  before update or delete on public.os_subsidiary_rollup_phase53_ops_alerts
  for each row execute function public.reject_subsidiary_rollup_phase53_mutation();
drop trigger if exists os_sub_rollup_p53_alerts_no_truncate
  on public.os_subsidiary_rollup_phase53_ops_alerts;
create trigger os_sub_rollup_p53_alerts_no_truncate
  before truncate on public.os_subsidiary_rollup_phase53_ops_alerts
  for each statement execute function public.reject_subsidiary_rollup_phase53_mutation();

-- Refresh Recruit 619 rollup from optional feed tables (fail-soft).
-- TODO: wire live Recruit portal feed tables/APIs when available
-- (e.g. recruiting_kpi_facts / future os_recruit_feed_*). Until then,
-- records empty metrics with freshness=unknown and feed_status=missing.
create or replace function public.refresh_subsidiary_rollup_phase53(
  p_actor_id uuid default null,
  p_entity_id text default 'ENT-R619'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity text := coalesce(nullif(trim(p_entity_id),''),'ENT-R619');
  v_has_kpi_facts boolean := false;
  v_has_feed boolean := false;
  v_open_reqs integer;
  v_pipeline integer;
  v_submissions integer;
  v_interviews integer;
  v_offers integer;
  v_placements integer;
  v_fill numeric;
  v_place numeric;
  v_source jsonb := '{}'::jsonb;
  v_freshness text := 'unknown';
  v_feed text := 'missing';
  v_window text;
  v_hash text;
  v_id uuid;
  v_detail jsonb;
begin
  if v_entity is distinct from 'ENT-R619' then
    raise exception 'Phase 53 subsidiary rollup currently supports ENT-R619 only';
  end if;

  if auth.role() is distinct from 'service_role' then
    if p_actor_id is null then
      raise exception 'Phase 53 subsidiary rollup refresh requires actor or service_role';
    end if;
    if not public.is_firm_wide_access()
       and not public.can_access_entity(v_entity) then
      raise exception 'Entity access required for Phase 53 subsidiary rollup refresh';
    end if;
  end if;

  select exists (
    select 1 from information_schema.tables t
    where t.table_schema='public' and t.table_name='recruiting_kpi_facts'
  ) into v_has_kpi_facts;

  select exists (
    select 1 from information_schema.tables t
    where t.table_schema='public' and t.table_name='os_recruit_feed_metrics'
  ) into v_has_feed;

  if v_has_feed then
    begin
      execute
        'select open_reqs, pipeline_volume, submissions, interviews, offers, placements, '
        || 'time_to_fill_days, time_to_place_days, coalesce(source_mix,''{}''::jsonb) '
        || 'from public.os_recruit_feed_metrics '
        || 'where entity_id = $1 '
        || 'order by captured_at desc nulls last, created_at desc nulls last '
        || 'limit 1'
      into v_open_reqs, v_pipeline, v_submissions, v_interviews, v_offers,
           v_placements, v_fill, v_place, v_source
      using v_entity;
      if v_open_reqs is not null or v_placements is not null then
        v_feed := 'ok';
        v_freshness := 'fresh';
      else
        v_feed := 'partial';
        v_freshness := 'partial';
      end if;
    exception when others then
      v_feed := 'partial';
      v_freshness := 'partial';
      v_open_reqs := null;
      v_pipeline := null;
      v_submissions := null;
      v_interviews := null;
      v_offers := null;
      v_placements := null;
      v_fill := null;
      v_place := null;
      v_source := '{}'::jsonb;
    end;
  elsif v_has_kpi_facts then
    begin
      execute
        'select '
        || 'coalesce(sum(value_num) filter (where metric_key = ''open_reqs''),0)::integer, '
        || 'coalesce(sum(value_num) filter (where metric_key = ''pipeline_volume''),0)::integer, '
        || 'coalesce(sum(value_num) filter (where metric_key = ''submissions''),0)::integer, '
        || 'coalesce(sum(value_num) filter (where metric_key = ''interviews''),0)::integer, '
        || 'coalesce(sum(value_num) filter (where metric_key = ''offers''),0)::integer, '
        || 'coalesce(sum(value_num) filter (where metric_key in (''placements'',''placement_count'')),0)::integer, '
        || 'avg(value_num) filter (where metric_key in (''fill_time_days'',''time_to_fill_days'')), '
        || 'avg(value_num) filter (where metric_key in (''place_time_days'',''time_to_place_days'')) '
        || 'from public.recruiting_kpi_facts '
        || 'where entity_id = $1 or entity_id is null'
      into v_open_reqs, v_pipeline, v_submissions, v_interviews, v_offers,
           v_placements, v_fill, v_place
      using v_entity;
      v_source := '{}'::jsonb;
      if coalesce(v_open_reqs,0) = 0
         and coalesce(v_pipeline,0) = 0
         and coalesce(v_submissions,0) = 0
         and coalesce(v_interviews,0) = 0
         and coalesce(v_offers,0) = 0
         and coalesce(v_placements,0) = 0
         and v_fill is null
         and v_place is null then
        v_feed := 'partial';
        v_freshness := 'partial';
      else
        v_feed := 'partial';
        v_freshness := 'partial';
      end if;
    exception when others then
      v_feed := 'missing';
      v_freshness := 'unknown';
      v_open_reqs := null;
      v_pipeline := null;
      v_submissions := null;
      v_interviews := null;
      v_offers := null;
      v_placements := null;
      v_fill := null;
      v_place := null;
      v_source := '{}'::jsonb;
    end;
  else
    -- Feed tables absent: explicit empty stub (freshness=unknown).
    v_feed := 'missing';
    v_freshness := 'unknown';
    v_open_reqs := null;
    v_pipeline := null;
    v_submissions := null;
    v_interviews := null;
    v_offers := null;
    v_placements := null;
    v_fill := null;
    v_place := null;
    v_source := '{}'::jsonb;
  end if;

  if v_source is null or jsonb_typeof(v_source) is distinct from 'object' then
    v_source := '{}'::jsonb;
  end if;

  v_window := 'phase53:rollup:' || v_entity || ':' || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24');
  if exists (
    select 1 from public.os_subsidiary_rollup_phase53_snapshots s
    where s.window_key = v_window
  ) then
    select snapshot_id into v_id
    from public.os_subsidiary_rollup_phase53_snapshots
    where window_key = v_window;
    return jsonb_build_object(
      'snapshot_id', v_id,
      'entity_id', v_entity,
      'already_recorded_window', true,
      'freshness', v_freshness,
      'feed_status', v_feed,
      'money_auto_approve', false,
      'contract_version', 'phase53-v1'
    );
  end if;

  v_detail := jsonb_build_object(
    'contract_version', 'phase53-v1',
    'money_auto_approve', false,
    'source', 'refresh_subsidiary_rollup_phase53',
    'todo', 'Wire live Recruit portal feed when os_recruit_feed_metrics or recruiting_kpi_facts is available',
    'feed_tables', jsonb_build_object(
      'os_recruit_feed_metrics', v_has_feed,
      'recruiting_kpi_facts', v_has_kpi_facts
    ),
    'drill_down_base', 'https://portal.recruit619.com'
  );

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'contract_version', 'phase53-v1',
    'entity_id', v_entity,
    'open_reqs', v_open_reqs,
    'pipeline_volume', v_pipeline,
    'submissions', v_submissions,
    'interviews', v_interviews,
    'offers', v_offers,
    'placements', v_placements,
    'source_mix', v_source,
    'time_to_fill_days', v_fill,
    'time_to_place_days', v_place,
    'freshness', v_freshness,
    'feed_status', v_feed,
    'window_key', v_window
  )::text);

  insert into public.os_subsidiary_rollup_phase53_snapshots(
    entity_id, window_key, open_reqs, pipeline_volume, submissions,
    interviews, offers, placements, source_mix, time_to_fill_days,
    time_to_place_days, freshness, feed_status, metrics_sha256, detail, actor_id
  ) values (
    v_entity, v_window, v_open_reqs, v_pipeline, v_submissions,
    v_interviews, v_offers, v_placements, v_source, v_fill,
    v_place, v_freshness, v_feed, v_hash, v_detail, p_actor_id
  ) returning snapshot_id into v_id;

  if v_feed = 'missing' then
    insert into public.os_subsidiary_rollup_phase53_ops_alerts(
      entity_id, alert_kind, reference_id, window_key, severity,
      metrics_sha256, detail
    ) values (
      v_entity, 'feed_missing', v_id,
      'phase53:alert:feed_missing:' || v_entity || ':' || to_char(now() at time zone 'utc','YYYY-MM-DD'),
      'info', v_hash,
      jsonb_build_object(
        'contract_version', 'phase53-v1',
        'source', 'refresh_subsidiary_rollup_phase53',
        'money_auto_approve', false
      )
    ) on conflict (window_key) do nothing;
  elsif v_feed = 'partial' then
    insert into public.os_subsidiary_rollup_phase53_ops_alerts(
      entity_id, alert_kind, reference_id, window_key, severity,
      metrics_sha256, detail
    ) values (
      v_entity, 'feed_partial', v_id,
      'phase53:alert:feed_partial:' || v_entity || ':' || to_char(now() at time zone 'utc','YYYY-MM-DD'),
      'warning', v_hash,
      jsonb_build_object(
        'contract_version', 'phase53-v1',
        'source', 'refresh_subsidiary_rollup_phase53',
        'money_auto_approve', false
      )
    ) on conflict (window_key) do nothing;
  end if;

  return jsonb_build_object(
    'snapshot_id', v_id,
    'entity_id', v_entity,
    'open_reqs', v_open_reqs,
    'pipeline_volume', v_pipeline,
    'submissions', v_submissions,
    'interviews', v_interviews,
    'offers', v_offers,
    'placements', v_placements,
    'source_mix', v_source,
    'time_to_fill_days', v_fill,
    'time_to_place_days', v_place,
    'freshness', v_freshness,
    'feed_status', v_feed,
    'money_auto_approve', false,
    'contract_version', 'phase53-v1'
  );
end $$;

create or replace function public.get_subsidiary_rollup_phase53_report(
  p_entity_id text default 'ENT-R619'
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_entity text := coalesce(nullif(trim(p_entity_id),''),'ENT-R619');
  v_latest public.os_subsidiary_rollup_phase53_snapshots%rowtype;
  v_alerts jsonb := '[]'::jsonb;
begin
  if v_entity is distinct from 'ENT-R619' then
    raise exception 'Phase 53 subsidiary rollup currently supports ENT-R619 only';
  end if;

  if auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 53 subsidiary rollup report';
  end if;

  select * into v_latest
  from public.os_subsidiary_rollup_phase53_snapshots s
  where s.entity_id = v_entity
  order by s.created_at desc
  limit 1;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc), '[]'::jsonb)
  into v_alerts
  from (
    select a.alert_id, a.alert_kind, a.severity, a.created_at
    from public.os_subsidiary_rollup_phase53_ops_alerts a
    where a.entity_id = v_entity
    order by a.created_at desc
    limit 12
  ) t;

  if v_latest.snapshot_id is null then
    return jsonb_build_object(
      'entity_id', v_entity,
      'canonical_name', 'Recruit 619',
      'open_reqs', null,
      'pipeline_volume', null,
      'submissions', null,
      'interviews', null,
      'offers', null,
      'placements', null,
      'source_mix', '{}'::jsonb,
      'time_to_fill_days', null,
      'time_to_place_days', null,
      'freshness', 'unknown',
      'feed_status', 'missing',
      'snapshot_id', null,
      'captured_at', null,
      'recent_alerts', v_alerts,
      'drill_downs', jsonb_build_object(
        'portal', 'https://portal.recruit619.com',
        'reqs', 'https://portal.recruit619.com/jobs',
        'pipeline', 'https://portal.recruit619.com/pipeline',
        'placements', 'https://portal.recruit619.com/placements'
      ),
      'todo', 'Wire live Recruit portal feed tables/APIs; until then metrics stay empty with freshness=unknown',
      'money_auto_approve', false,
      'contract_version', 'phase53-v1'
    );
  end if;

  return jsonb_build_object(
    'entity_id', v_entity,
    'canonical_name', 'Recruit 619',
    'open_reqs', v_latest.open_reqs,
    'pipeline_volume', v_latest.pipeline_volume,
    'submissions', v_latest.submissions,
    'interviews', v_latest.interviews,
    'offers', v_latest.offers,
    'placements', v_latest.placements,
    'source_mix', coalesce(v_latest.source_mix, '{}'::jsonb),
    'time_to_fill_days', v_latest.time_to_fill_days,
    'time_to_place_days', v_latest.time_to_place_days,
    'freshness', v_latest.freshness,
    'feed_status', v_latest.feed_status,
    'snapshot_id', v_latest.snapshot_id,
    'captured_at', v_latest.created_at,
    'recent_alerts', v_alerts,
    'drill_downs', jsonb_build_object(
      'portal', 'https://portal.recruit619.com',
      'reqs', 'https://portal.recruit619.com/jobs',
      'pipeline', 'https://portal.recruit619.com/pipeline',
      'placements', 'https://portal.recruit619.com/placements'
    ),
    'todo', 'Wire live Recruit portal feed tables/APIs; until then metrics stay empty with freshness=unknown',
    'money_auto_approve', false,
    'contract_version', 'phase53-v1'
  );
end $$;

revoke all on function public.refresh_subsidiary_rollup_phase53(uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_subsidiary_rollup_phase53_report(text)
  from public, anon;
revoke all on function public.phase53_subsidiary_rollup_safe_detail(jsonb)
  from public, anon;

grant execute on function public.phase53_subsidiary_rollup_safe_detail(jsonb),
  public.get_subsidiary_rollup_phase53_report(text)
  to authenticated, service_role;
grant execute on function public.refresh_subsidiary_rollup_phase53(uuid, text)
  to authenticated, service_role;
