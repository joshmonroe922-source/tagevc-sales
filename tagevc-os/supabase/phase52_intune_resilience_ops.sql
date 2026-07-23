-- Phase 52: per-category (postmortem/breaker/waive) backlog TREND charts on
-- Phase 51 unified inbox snapshots, plus category aging/backlog visibility.
-- Apply after phase51_intune_resilience_ops.sql. Observe-only: this file
-- NEVER closes, resets, applies, or approves anything on its own. Aggregates
-- NEVER include entity identifiers. Dual-approve still required for apply.

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

create or replace function public.it_intune_phase51_sanitize_aggregate(p_evidence jsonb)
returns jsonb
language sql immutable set search_path=public as $$
  select coalesce(p_evidence,'{}'::jsonb)
    - 'entity_id' - 'entity_ids' - 'entity_scope' - 'entity_scopes'
    || jsonb_build_object('entity_identifiers_included',false);
$$;

create or replace function public.it_intune_phase52_sanitize_aggregate(p_evidence jsonb)
returns jsonb
language sql immutable set search_path=public as $$
  select public.it_intune_phase51_sanitize_aggregate(p_evidence);
$$;

-- ---------------------------------------------------------------------------
-- Append-only per-category backlog trend snapshots derived from Phase 51
-- unified inbox snapshots. Never a mutation path — purely observational.
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_phase52_category_trend_snapshots (
  trend_id uuid primary key default gen_random_uuid(),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  category text not null check (category in ('postmortem','breaker','waive','total')),
  latest_pending integer not null default 0 check (latest_pending >= 0),
  prior_pending integer,
  pending_delta integer,
  trend_direction text not null default 'unknown'
    check (trend_direction in ('improving','stable','declining','unknown')),
  oldest_pending_hours numeric,
  snapshots_compared integer not null default 0 check (snapshots_compared >= 0),
  aggregate_evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p52_trend_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  ),
  constraint os_it_intune_p52_trend_no_auto_close check (
    coalesce((aggregate_evidence->>'closes_or_resets_breaker')::boolean,false)=false
  )
);

create index if not exists os_it_intune_p52_trend_recorded_idx
  on public.os_it_intune_phase52_category_trend_snapshots(recorded_at desc);
create index if not exists os_it_intune_p52_trend_category_idx
  on public.os_it_intune_phase52_category_trend_snapshots(category, recorded_at desc);

alter table public.os_it_intune_phase52_category_trend_snapshots
  enable row level security;
drop policy if exists "os_it_intune_p52_trend_select"
  on public.os_it_intune_phase52_category_trend_snapshots;
create policy "os_it_intune_p52_trend_select"
  on public.os_it_intune_phase52_category_trend_snapshots for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_phase52_category_trend_snapshots to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_phase52_category_trend_snapshots
  from public,authenticated,service_role;

create table if not exists public.os_it_intune_phase52_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  alert_kind text not null,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null default 'warning',
  destination_key text not null default 'ops_alerts'
    check (destination_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  delivery_status text not null,
  response_code integer
    check (response_code is null or response_code between 100 and 599),
  aggregate_evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null,
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p52_alert_kind_check
    check (alert_kind in (
      'category_backlog_trend_declining',
      'category_aging_critical'
    )),
  constraint os_it_intune_p52_alert_severity_check
    check (severity in ('warning','critical')),
  constraint os_it_intune_p52_alert_delivery_check
    check (delivery_status in
      ('delivered','skipped_no_webhook','failed','recorded')),
  constraint os_it_intune_p52_alert_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_it_intune_p52_alert_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  )
);

create index if not exists os_it_intune_p52_alert_kind_recorded_idx
  on public.os_it_intune_phase52_ops_alerts(alert_kind, recorded_at desc);

alter table public.os_it_intune_phase52_ops_alerts
  enable row level security;
drop policy if exists "os_it_intune_p52_alert_select"
  on public.os_it_intune_phase52_ops_alerts;
create policy "os_it_intune_p52_alert_select"
  on public.os_it_intune_phase52_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_phase52_ops_alerts to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_phase52_ops_alerts
  from public,authenticated,service_role;

create or replace function public.prevent_it_intune_phase52_ops_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'Phase 52 Intune category backlog trend evidence is append-only';
end;
$$;

drop trigger if exists os_it_intune_p52_trend_append_only
  on public.os_it_intune_phase52_category_trend_snapshots;
create trigger os_it_intune_p52_trend_append_only
  before update or delete
  on public.os_it_intune_phase52_category_trend_snapshots
  for each row execute function public.prevent_it_intune_phase52_ops_mutation();
drop trigger if exists os_it_intune_p52_trend_no_truncate
  on public.os_it_intune_phase52_category_trend_snapshots;
create trigger os_it_intune_p52_trend_no_truncate
  before truncate
  on public.os_it_intune_phase52_category_trend_snapshots
  for each statement execute function public.prevent_it_intune_phase52_ops_mutation();

drop trigger if exists os_it_intune_p52_alert_append_only
  on public.os_it_intune_phase52_ops_alerts;
create trigger os_it_intune_p52_alert_append_only
  before update or delete
  on public.os_it_intune_phase52_ops_alerts
  for each row execute function public.prevent_it_intune_phase52_ops_mutation();
drop trigger if exists os_it_intune_p52_alert_no_truncate
  on public.os_it_intune_phase52_ops_alerts;
create trigger os_it_intune_p52_alert_no_truncate
  before truncate
  on public.os_it_intune_phase52_ops_alerts
  for each statement execute function public.prevent_it_intune_phase52_ops_mutation();

-- Record per-category backlog trends from the last two Phase 51 inbox
-- snapshots. Observe-only; never applies/approves; no entity ID leaks.
create or replace function public.record_it_intune_inbox_category_trends_phase52(
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public as $$
declare
  v_latest public.os_it_intune_phase51_inbox_snapshots%rowtype;
  v_prior public.os_it_intune_phase51_inbox_snapshots%rowtype;
  v_categories text[] := array['postmortem','breaker','waive','total'];
  v_cat text;
  v_latest_val integer;
  v_prior_val integer;
  v_delta integer;
  v_direction text;
  v_window text;
  v_hash text;
  v_evidence jsonb;
  v_id uuid;
  v_recorded integer := 0;
  v_day text;
begin
  select * into v_latest
  from public.os_it_intune_phase51_inbox_snapshots
  order by recorded_at desc
  limit 1;

  select * into v_prior
  from public.os_it_intune_phase51_inbox_snapshots
  order by recorded_at desc
  offset 1
  limit 1;

  if v_latest.snapshot_id is null then
    return jsonb_build_object(
      'version','phase52-v1',
      'recorded',0,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false,
      'requires_dual_approval',true
    );
  end if;

  v_day := to_char(now() at time zone 'utc','YYYY-MM-DD');

  foreach v_cat in array v_categories
  loop
    if v_cat = 'postmortem' then
      v_latest_val := coalesce(v_latest.postmortem_pending,0);
      v_prior_val := v_prior.postmortem_pending;
    elsif v_cat = 'breaker' then
      v_latest_val := coalesce(v_latest.breaker_tuning_pending,0);
      v_prior_val := v_prior.breaker_tuning_pending;
    elsif v_cat = 'waive' then
      v_latest_val := coalesce(v_latest.promote_waive_pending,0);
      v_prior_val := v_prior.promote_waive_pending;
    else
      v_latest_val := coalesce(v_latest.total_pending,0);
      v_prior_val := v_prior.total_pending;
    end if;

    if v_prior.snapshot_id is null or v_prior_val is null then
      v_delta := null;
      v_direction := 'unknown';
    else
      v_delta := v_latest_val - v_prior_val;
      if v_delta <= -1 then
        v_direction := 'improving';
      elsif v_delta >= 1 then
        v_direction := 'declining';
      else
        v_direction := 'stable';
      end if;
    end if;

    v_window := 'phase52:cattrend:' || v_cat || ':' || v_day;
    if exists (
      select 1 from public.os_it_intune_phase52_category_trend_snapshots t
      where t.window_key=v_window
    ) then
      continue;
    end if;

    v_evidence := public.it_intune_phase52_sanitize_aggregate(jsonb_build_object(
      'evidence_version','phase52-v1',
      'category',v_cat,
      'latest_pending',v_latest_val,
      'prior_pending',v_prior_val,
      'pending_delta',v_delta,
      'trend_direction',v_direction,
      'closes_or_resets_breaker',false,
      'requires_dual_approval',true
    ));
    v_hash := public.os_sha256_hex(v_evidence::text);

    insert into public.os_it_intune_phase52_category_trend_snapshots(
      window_key,category,latest_pending,prior_pending,pending_delta,
      trend_direction,oldest_pending_hours,snapshots_compared,
      aggregate_evidence,evidence_sha256
    ) values (
      v_window,v_cat,v_latest_val,v_prior_val,v_delta,v_direction,
      v_latest.oldest_pending_hours,
      case when v_prior.snapshot_id is null then 1 else 2 end,
      v_evidence,v_hash
    ) returning trend_id into v_id;

    if v_id is not null then
      v_recorded := v_recorded + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'version','phase52-v1',
    'recorded',v_recorded,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false,
    'requires_dual_approval',true
  );
end;
$$;

create or replace function public.list_it_intune_phase52_critical_windows(
  p_window_hours integer default 24,
  p_stale_hours integer default 72
) returns jsonb
language plpgsql
stable
security definer
set search_path=public as $$
declare
  v_hours integer := least(greatest(coalesce(p_window_hours,24),1),168);
  v_stale_hours integer := least(greatest(coalesce(p_stale_hours,72),1),720);
  v_bucket text;
  v_pending jsonb := '[]'::jsonb;
  v_trend public.os_it_intune_phase52_category_trend_snapshots%rowtype;
  v_key text;
begin
  v_bucket := to_char(
    to_timestamp(
      (floor(extract(epoch from now())/(v_hours*3600.0))
        *(v_hours*3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  for v_trend in
    select distinct on (category) *
    from public.os_it_intune_phase52_category_trend_snapshots
    order by category, recorded_at desc
  loop
    if v_trend.trend_direction = 'declining' and v_trend.category <> 'total' then
      v_key := 'cattrenddecline52:' || v_trend.category || ':' || v_bucket;
      if not exists (
        select 1 from public.os_it_intune_phase52_ops_alerts x
        where x.window_key=v_key
      ) then
        v_pending := v_pending || jsonb_build_array(jsonb_build_object(
          'alert_kind','category_backlog_trend_declining',
          'window_key',v_key,
          'severity','warning',
          'category',v_trend.category,
          'latest_pending',v_trend.latest_pending
        ));
      end if;
    end if;

    if v_trend.category = 'total'
      and v_trend.oldest_pending_hours is not null
      and v_trend.oldest_pending_hours >= v_stale_hours then
      v_key := 'cataging52:' || v_bucket || 'h' || v_hours::text;
      if not exists (
        select 1 from public.os_it_intune_phase52_ops_alerts x
        where x.window_key=v_key
      ) then
        v_pending := v_pending || jsonb_build_array(jsonb_build_object(
          'alert_kind','category_aging_critical',
          'window_key',v_key,
          'severity','critical',
          'oldest_pending_hours',v_trend.oldest_pending_hours
        ));
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'version','phase52-v1',
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',coalesce(v_pending,'[]'::jsonb),
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false,
    'requires_dual_approval',true
  );
end;
$$;

create or replace function public.record_it_intune_phase52_ops_alert(p_alert jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_kind text;
  v_window text;
  v_dest text;
  v_delivery text;
  v_code integer;
  v_severity text;
  v_evidence jsonb;
  v_hash text;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_alert,'{}'::jsonb))<>'object' then
    raise exception 'Phase 52 ops alert payload must be a JSON object';
  end if;

  v_kind:=coalesce(p_alert->>'alert_kind','');
  v_window:=coalesce(p_alert->>'window_key','');
  v_dest:=coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery:=coalesce(p_alert->>'delivery_status','recorded');
  v_code:=nullif(p_alert->>'response_code','')::integer;
  v_severity:=coalesce(nullif(p_alert->>'severity',''),'warning');

  if v_kind not in (
      'category_backlog_trend_declining','category_aging_critical')
    or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
    or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
    or v_delivery not in
      ('delivered','skipped_no_webhook','failed','recorded')
    or v_severity not in ('warning','critical') then
    raise exception 'Phase 52 ops alert contract is invalid';
  end if;

  v_evidence:=public.it_intune_phase52_sanitize_aggregate(
    coalesce(p_alert->'aggregate_evidence','{}'::jsonb)
    || jsonb_build_object(
      'evidence_version','phase52-v1',
      'alert_kind',v_kind,
      'window_key',v_window,
      'severity',v_severity,
      'destination_key',v_dest,
      'delivery_status',v_delivery,
      'response_code',v_code,
      'closes_or_resets_breaker',false,
      'requires_dual_approval',true
    )
  );
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_it_intune_phase52_ops_alerts(
    alert_kind,window_key,severity,destination_key,delivery_status,
    response_code,aggregate_evidence,evidence_sha256
  ) values (
    v_kind,v_window,v_severity,v_dest,v_delivery,v_code,v_evidence,v_hash
  )
  on conflict (window_key) do nothing
  returning alert_id into v_id;

  if v_id is null then
    select alert_id into v_id
    from public.os_it_intune_phase52_ops_alerts
    where window_key=v_window;
    return jsonb_build_object(
      'inserted',false,
      'alert_id',v_id,
      'window_key',v_window,
      'closes_or_resets_breaker',false,
      'requires_dual_approval',true);
  end if;

  return jsonb_build_object(
    'inserted',true,
    'alert_id',v_id,
    'window_key',v_window,
    'closes_or_resets_breaker',false,
    'requires_dual_approval',true);
end;
$$;

create or replace function public.get_it_intune_phase52_ops_report()
returns jsonb
language plpgsql
stable
security definer
set search_path=public as $$
declare
  v_trends jsonb;
  v_alerts jsonb;
  v_postmortem_dir text := 'unknown';
  v_breaker_dir text := 'unknown';
  v_waive_dir text := 'unknown';
begin
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_trends
  from (
    select t.trend_id,t.category,t.latest_pending,t.prior_pending,t.pending_delta,
      t.trend_direction,t.oldest_pending_hours,t.snapshots_compared,t.recorded_at
    from public.os_it_intune_phase52_category_trend_snapshots t
    order by t.recorded_at desc
    limit 60
  ) x;

  select trend_direction into v_postmortem_dir
  from public.os_it_intune_phase52_category_trend_snapshots
  where category='postmortem' order by recorded_at desc limit 1;
  select trend_direction into v_breaker_dir
  from public.os_it_intune_phase52_category_trend_snapshots
  where category='breaker' order by recorded_at desc limit 1;
  select trend_direction into v_waive_dir
  from public.os_it_intune_phase52_category_trend_snapshots
  where category='waive' order by recorded_at desc limit 1;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_alerts
  from (
    select al.alert_id,al.alert_kind,al.window_key,al.severity,
      al.destination_key,al.delivery_status,al.response_code,
      al.evidence_sha256,al.recorded_at
    from public.os_it_intune_phase52_ops_alerts al
    order by al.recorded_at desc
    limit 50
  ) x;

  return jsonb_build_object(
    'version','phase52-v1',
    'postmortem_trend_direction',coalesce(v_postmortem_dir,'unknown'),
    'breaker_trend_direction',coalesce(v_breaker_dir,'unknown'),
    'waive_trend_direction',coalesce(v_waive_dir,'unknown'),
    'category_trend_snapshots',v_trends,
    'ops_alerts',v_alerts,
    'destination_key','ops_alerts',
    'requires_dual_approval',true,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

revoke all on function public.it_intune_phase52_sanitize_aggregate(jsonb)
  from public,authenticated,service_role;
revoke all on function public.record_it_intune_inbox_category_trends_phase52(uuid)
  from public,authenticated;
revoke all on function public.list_it_intune_phase52_critical_windows(integer,integer)
  from public,authenticated;
revoke all on function public.record_it_intune_phase52_ops_alert(jsonb)
  from public,authenticated;
revoke all on function public.get_it_intune_phase52_ops_report()
  from public,authenticated;
revoke all on function public.prevent_it_intune_phase52_ops_mutation()
  from public,authenticated,service_role;

grant execute on function public.list_it_intune_phase52_critical_windows(integer,integer),
  public.record_it_intune_phase52_ops_alert(jsonb),
  public.record_it_intune_inbox_category_trends_phase52(uuid),
  public.get_it_intune_phase52_ops_report()
  to service_role;

grant execute on function public.list_it_intune_phase52_critical_windows(integer,integer),
  public.get_it_intune_phase52_ops_report()
  to authenticated;
