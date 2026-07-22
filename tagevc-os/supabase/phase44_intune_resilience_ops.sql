-- Phase 44: Intune resilience ops — breaker config performance trends,
-- smarter canary/outage ops alerts (idempotent window_key), and correlation
-- timeline (outages ↔ tuning ↔ recovery).
-- Apply after phase43_intune_soak_cycle_evidence.sql.
-- Observe-only: never closes, resets, or mutates breaker state.
-- Aggregates never include entity identifiers.

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

-- ---------------------------------------------------------------------------
-- Append-only breaker config performance trend snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_breaker_config_performance_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  breaker_id uuid not null
    references public.os_it_intune_provider_breakers(breaker_id),
  config_version_no integer not null,
  sample_count integer not null default 0,
  failure_count integer not null default 0,
  failure_rate numeric(5,4) not null default 0,
  time_closed_minutes integer not null default 0,
  time_open_minutes integer not null default 0,
  time_half_open_minutes integer not null default 0,
  blocked_action_count integer not null default 0,
  cycle_complete_count integer not null default 0,
  aggregate_evidence jsonb not null,
  evidence_sha256 text not null,
  bucket_key text,
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p44_perf_counts_check
    check (sample_count>=0 and failure_count>=0
      and failure_count<=sample_count
      and failure_rate between 0 and 1
      and time_closed_minutes>=0
      and time_open_minutes>=0
      and time_half_open_minutes>=0
      and blocked_action_count>=0
      and cycle_complete_count>=0
      and config_version_no>=0),
  constraint os_it_intune_p44_perf_hash_check
    check (evidence_sha256~'^[0-9a-f]{64}$'),
  constraint os_it_intune_p44_perf_bucket_check
    check (bucket_key is null
      or bucket_key~'^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$'),
  constraint os_it_intune_p44_perf_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  ),
  constraint os_it_intune_p44_perf_bucket_unique
    unique (breaker_id, config_version_no, bucket_key)
);

create index if not exists os_it_intune_p44_perf_breaker_recorded_idx
  on public.os_it_intune_breaker_config_performance_snapshots(
    breaker_id, recorded_at desc, snapshot_id desc);

alter table public.os_it_intune_breaker_config_performance_snapshots
  enable row level security;

drop policy if exists "os_it_intune_p44_perf_select"
  on public.os_it_intune_breaker_config_performance_snapshots;
create policy "os_it_intune_p44_perf_select"
  on public.os_it_intune_breaker_config_performance_snapshots
  for select to authenticated
  using (exists (
    select 1 from public.os_it_intune_provider_breakers b
    where b.breaker_id=
      os_it_intune_breaker_config_performance_snapshots.breaker_id
      and (public.is_firm_wide_access()
        or (b.entity_id is not null and public.can_access_entity(b.entity_id)))
  ));

grant select on public.os_it_intune_breaker_config_performance_snapshots
  to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_breaker_config_performance_snapshots
  from public,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Append-only Phase 44 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_phase44_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  alert_kind text not null,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null default 'critical',
  destination_key text not null default 'ops_alerts'
    check (destination_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  delivery_status text not null,
  response_code integer
    check (response_code is null or response_code between 100 and 599),
  breaker_id uuid
    references public.os_it_intune_provider_breakers(breaker_id),
  aggregate_evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null,
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p44_alert_kind_check
    check (alert_kind in (
      'read_only_canary_unhealthy',
      'canary_stale',
      'canary_during_outage',
      'open_awaiting_close_aged',
      'breaker_failure_rate_elevated'
    )),
  constraint os_it_intune_p44_alert_severity_check
    check (severity in ('warning','critical')),
  constraint os_it_intune_p44_alert_delivery_check
    check (delivery_status in
      ('delivered','skipped_no_webhook','failed','recorded')),
  constraint os_it_intune_p44_alert_hash_check
    check (evidence_sha256~'^[0-9a-f]{64}$'),
  constraint os_it_intune_p44_alert_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  )
);

create index if not exists os_it_intune_p44_alert_kind_recorded_idx
  on public.os_it_intune_phase44_ops_alerts(alert_kind, recorded_at desc);

alter table public.os_it_intune_phase44_ops_alerts
  enable row level security;

drop policy if exists "os_it_intune_p44_alert_select"
  on public.os_it_intune_phase44_ops_alerts;
create policy "os_it_intune_p44_alert_select"
  on public.os_it_intune_phase44_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_phase44_ops_alerts to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_phase44_ops_alerts
  from public,authenticated,service_role;

create or replace function public.prevent_it_intune_phase44_ops_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'Phase 44 Intune resilience ops evidence is append-only';
end;
$$;

drop trigger if exists os_it_intune_p44_perf_append_only
  on public.os_it_intune_breaker_config_performance_snapshots;
create trigger os_it_intune_p44_perf_append_only
  before update or delete
  on public.os_it_intune_breaker_config_performance_snapshots
  for each row execute function public.prevent_it_intune_phase44_ops_mutation();

drop trigger if exists os_it_intune_p44_perf_no_truncate
  on public.os_it_intune_breaker_config_performance_snapshots;
create trigger os_it_intune_p44_perf_no_truncate
  before truncate
  on public.os_it_intune_breaker_config_performance_snapshots
  for each statement execute function public.prevent_it_intune_phase44_ops_mutation();

drop trigger if exists os_it_intune_p44_alert_append_only
  on public.os_it_intune_phase44_ops_alerts;
create trigger os_it_intune_p44_alert_append_only
  before update or delete
  on public.os_it_intune_phase44_ops_alerts
  for each row execute function public.prevent_it_intune_phase44_ops_mutation();

drop trigger if exists os_it_intune_p44_alert_no_truncate
  on public.os_it_intune_phase44_ops_alerts;
create trigger os_it_intune_p44_alert_no_truncate
  before truncate
  on public.os_it_intune_phase44_ops_alerts
  for each statement execute function public.prevent_it_intune_phase44_ops_mutation();

create or replace function public.it_intune_phase44_sanitize_aggregate(p_evidence jsonb)
returns jsonb
language sql immutable set search_path=public as $$
  select coalesce(p_evidence,'{}'::jsonb)
    - 'entity_id' - 'entity_ids' - 'entity_scope' - 'entity_scopes'
    || jsonb_build_object('entity_identifiers_included',false);
$$;

-- ---------------------------------------------------------------------------
-- Correlation timeline (aggregate-safe columns only — no entity identifiers)
-- ---------------------------------------------------------------------------
create or replace view public.os_it_intune_resilience_correlation_timeline
with (security_invoker=true) as
select null::uuid as breaker_id,
  ('outage_'||e.event_type)::text as event_kind,
  e.created_at as occurred_at,
  e.evidence_sha256,
  e.to_state as status
from public.os_it_intune_outage_episode_events e
union all
select t.breaker_id,
  ('tuning_'||t.event_type)::text as event_kind,
  t.created_at as occurred_at,
  t.evidence_sha256,
  t.event_type as status
from public.os_it_intune_breaker_tuning_events t
union all
select c.breaker_id,
  'soak_cycle_complete'::text as event_kind,
  c.recorded_at as occurred_at,
  c.evidence_sha256,
  c.cycle_status as status
from public.os_it_intune_soak_cycle_evidence c
union all
select null::uuid as breaker_id,
  ('health_'||i.incident_type||'_'||i.status)::text as event_kind,
  coalesce(i.last_observed_at,i.opened_at) as occurred_at,
  public.os_sha256_hex(jsonb_build_object(
    'incident_id',i.incident_id,
    'incident_type',i.incident_type,
    'status',i.status,
    'severity',i.severity,
    'entity_identifiers_included',false
  )::text) as evidence_sha256,
  i.status
from public.os_it_intune_health_incidents i
union all
select s.breaker_id,
  'config_performance_snapshot'::text as event_kind,
  s.recorded_at as occurred_at,
  s.evidence_sha256,
  'snapshot'::text as status
from public.os_it_intune_breaker_config_performance_snapshots s;
grant select on public.os_it_intune_resilience_correlation_timeline
  to authenticated;

create or replace view public.os_it_intune_phase44_health
with (security_invoker=true) as
select
  (select count(*) from public.os_it_intune_breaker_config_performance_snapshots)
    as performance_snapshot_count,
  (select count(*) from public.os_it_intune_phase44_ops_alerts)
    as ops_alert_count,
  (select count(*) from public.os_it_intune_phase44_ops_alerts
    where delivery_status='delivered') as alerts_delivered_count,
  (select count(*) from public.os_it_intune_phase44_ops_alerts
    where delivery_status in ('failed','skipped_no_webhook'))
    as alerts_undelivered_count,
  (select count(*) from public.os_it_intune_phase44_ops_alerts
    where alert_kind='read_only_canary_unhealthy'
      and recorded_at>=now()-interval '7 days') as canary_unhealthy_alerts_7d,
  (select count(*) from public.os_it_intune_phase44_ops_alerts
    where alert_kind='canary_stale'
      and recorded_at>=now()-interval '7 days') as canary_stale_alerts_7d,
  (select count(*) from public.os_it_intune_phase44_ops_alerts
    where alert_kind='canary_during_outage'
      and recorded_at>=now()-interval '7 days') as canary_during_outage_alerts_7d,
  (select count(*) from public.os_it_intune_phase44_ops_alerts
    where alert_kind='open_awaiting_close_aged'
      and recorded_at>=now()-interval '7 days') as open_awaiting_close_aged_7d,
  (select count(*) from public.os_it_intune_phase44_ops_alerts
    where alert_kind='breaker_failure_rate_elevated'
      and recorded_at>=now()-interval '7 days') as failure_rate_elevated_7d,
  (select count(*) from public.os_it_intune_resilience_correlation_timeline
    where occurred_at>=now()-interval '7 days') as correlation_events_7d;
grant select on public.os_it_intune_phase44_health to authenticated;

-- ---------------------------------------------------------------------------
-- Snapshot breaker config performance (observe-only; never mutates breakers)
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_it_intune_breaker_performance_phase44()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_breaker record;
  v_config record;
  v_bucket text;
  v_window_start timestamptz;
  v_samples integer;
  v_failures integer;
  v_rate numeric(5,4);
  v_closed integer;
  v_open integer;
  v_half integer;
  v_blocked integer;
  v_cycles integer;
  v_evidence jsonb;
  v_hash text;
  v_recorded integer:=0;
  v_skipped integer:=0;
begin
  -- Performance snapshots never update breaker rows and never call reset/close RPCs.
  v_bucket:=to_char(date_trunc('hour',now()),'YYYYMMDD"T"HH24');

  for v_breaker in
    select b.breaker_id,b.state,b.entity_scope,b.failure_window_minutes,
      b.failure_rate_threshold,b.updated_at,b.opened_at
    from public.os_it_intune_provider_breakers b
    order by b.breaker_id
    limit 100
  loop
    v_config:=null;
    select v.version_no,v.applied_at into v_config
    from public.os_it_intune_breaker_config_versions v
    where v.breaker_id=v_breaker.breaker_id
    order by v.version_no desc
    limit 1;

    if not found then
      v_skipped:=v_skipped+1;
      continue;
    end if;

    if exists (
      select 1 from public.os_it_intune_breaker_config_performance_snapshots s
      where s.breaker_id=v_breaker.breaker_id
        and s.config_version_no=v_config.version_no
        and s.bucket_key=v_bucket
    ) then
      v_skipped:=v_skipped+1;
      continue;
    end if;

    v_window_start:=greatest(v_config.applied_at, now()-interval '24 hours');

    select count(*) filter (where o.outcome<>'ignored'),
      count(*) filter (where o.outcome in ('failure','ambiguous'))
    into v_samples, v_failures
    from public.os_it_intune_provider_observations o
    where o.breaker_id=v_breaker.breaker_id
      and o.observed_at>=v_window_start;

    if coalesce(v_samples,0)>0 then
      v_rate:=round((v_failures::numeric/v_samples::numeric),4);
    else
      v_rate:=0;
    end if;

    select
      coalesce(sum(mins) filter (where state='closed'),0),
      coalesce(sum(mins) filter (where state='open'),0),
      coalesce(sum(mins) filter (where state='half_open'),0)
    into v_closed, v_open, v_half
    from (
      select e.to_state as state,
        greatest(0, ceil(extract(epoch from (
          lead(e.created_at,1,now()) over (
            partition by e.breaker_id order by e.created_at, e.event_id
          ) - e.created_at
        ))/60.0))::integer as mins
      from public.os_it_intune_breaker_events e
      where e.breaker_id=v_breaker.breaker_id
        and e.created_at>=v_window_start
        and e.to_state in ('closed','open','half_open')
    ) spans;

    if coalesce(v_closed,0)+coalesce(v_open,0)+coalesce(v_half,0)=0 then
      if v_breaker.state='closed' then
        v_closed:=greatest(0,ceil(extract(epoch from (now()-v_window_start))/60.0));
        v_open:=0;
        v_half:=0;
      elsif v_breaker.state='open' then
        v_open:=greatest(0,ceil(extract(epoch from (now()-v_window_start))/60.0));
        v_closed:=0;
        v_half:=0;
      else
        v_half:=greatest(0,ceil(extract(epoch from (now()-v_window_start))/60.0));
        v_closed:=0;
        v_open:=0;
      end if;
    end if;

    if v_breaker.state='closed' then
      v_blocked:=0;
    else
      select count(*) into v_blocked
      from public.os_it_intune_actions a
      where coalesce(a.entity_id,'__firm__')=v_breaker.entity_scope
        and a.status in ('approved','preflighting');
    end if;

    select count(*) into v_cycles
    from public.os_it_intune_soak_cycle_evidence c
    where c.breaker_id=v_breaker.breaker_id
      and c.recorded_at>=v_window_start
      and c.cycle_status='cycle_complete';

    v_evidence:=public.it_intune_phase44_sanitize_aggregate(jsonb_build_object(
      'evidence_version','phase44-v1',
      'snapshot_kind','breaker_config_performance',
      'breaker_id',v_breaker.breaker_id,
      'config_version_no',v_config.version_no,
      'bucket_key',v_bucket,
      'window_start',v_window_start,
      'sample_count',coalesce(v_samples,0),
      'failure_count',coalesce(v_failures,0),
      'failure_rate',v_rate,
      'failure_rate_threshold',v_breaker.failure_rate_threshold,
      'time_closed_minutes',coalesce(v_closed,0),
      'time_open_minutes',coalesce(v_open,0),
      'time_half_open_minutes',coalesce(v_half,0),
      'blocked_action_count',coalesce(v_blocked,0),
      'cycle_complete_count',coalesce(v_cycles,0),
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    ));
    v_hash:=public.os_sha256_hex(v_evidence::text);

    insert into public.os_it_intune_breaker_config_performance_snapshots(
      breaker_id,config_version_no,sample_count,failure_count,failure_rate,
      time_closed_minutes,time_open_minutes,time_half_open_minutes,
      blocked_action_count,cycle_complete_count,aggregate_evidence,
      evidence_sha256,bucket_key
    ) values (
      v_breaker.breaker_id,v_config.version_no::integer,
      coalesce(v_samples,0),coalesce(v_failures,0),v_rate,
      coalesce(v_closed,0),coalesce(v_open,0),coalesce(v_half,0),
      coalesce(v_blocked,0),coalesce(v_cycles,0),v_evidence,v_hash,v_bucket
    );
    v_recorded:=v_recorded+1;
  end loop;

  return jsonb_build_object(
    'snapshots_recorded',v_recorded,
    'skipped',v_skipped,
    'bucket_key',v_bucket,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- List critical windows still needing an idempotent ops alert
-- ---------------------------------------------------------------------------
create or replace function public.list_it_intune_phase44_critical_windows(
  p_window_hours integer default 24)
returns jsonb
language plpgsql
stable
security definer
set search_path=public as $$
declare
  v_hours integer:=least(greatest(coalesce(p_window_hours,24),1),168);
  v_bucket text;
  v_pending jsonb:='[]'::jsonb;
  v_part jsonb;
  v_last_success timestamptz;
  v_open_incident boolean;
  v_active_outage boolean;
  v_recent_canary_fail boolean;
begin
  v_bucket:=to_char(
    to_timestamp(
      (floor(extract(epoch from now())/(v_hours*3600.0))
        *(v_hours*3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  select exists (
    select 1 from public.os_it_intune_health_incidents
    where status='open' and incident_type='read_only_canary'
  ) into v_open_incident;

  if v_open_incident then
    select coalesce((
      select jsonb_agg(jsonb_build_object(
        'alert_kind','read_only_canary_unhealthy',
        'window_key','canaryunhealthy:ms_graph:'||v_bucket||'h'||v_hours::text,
        'severity','critical',
        'breaker_id',null
      ))
      where not exists (
        select 1 from public.os_it_intune_phase44_ops_alerts x
        where x.window_key=
          'canaryunhealthy:ms_graph:'||v_bucket||'h'||v_hours::text
      )
    ), '[]'::jsonb) into v_part;
    v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);
  end if;

  select max(observed_at) into v_last_success
  from public.os_it_intune_health_canary_runs
  where outcome='success';

  if v_last_success is null
     or v_last_success < now()-interval '60 minutes' then
    select coalesce((
      select jsonb_agg(jsonb_build_object(
        'alert_kind','canary_stale',
        'window_key','canarystale:ms_graph:'||v_bucket||'h'||v_hours::text,
        'severity','warning',
        'breaker_id',null,
        'last_canary_success_at',v_last_success
      ))
      where not exists (
        select 1 from public.os_it_intune_phase44_ops_alerts x
        where x.window_key=
          'canarystale:ms_graph:'||v_bucket||'h'||v_hours::text
      )
    ), '[]'::jsonb) into v_part;
    v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);
  end if;

  select exists (
    select 1 from public.os_it_intune_outage_episodes
    where state='active'
  ) into v_active_outage;

  select exists (
    select 1 from public.os_it_intune_health_canary_runs
    where outcome='failure'
      and observed_at>=now()-interval '30 minutes'
  ) into v_recent_canary_fail;

  if v_active_outage and v_recent_canary_fail then
    select coalesce((
      select jsonb_agg(jsonb_build_object(
        'alert_kind','canary_during_outage',
        'window_key','canaryoutage:ms_graph:'||v_bucket||'h'||v_hours::text,
        'severity','critical',
        'breaker_id',null
      ))
      where not exists (
        select 1 from public.os_it_intune_phase44_ops_alerts x
        where x.window_key=
          'canaryoutage:ms_graph:'||v_bucket||'h'||v_hours::text
      )
    ), '[]'::jsonb) into v_part;
    v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);
  end if;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','open_awaiting_close_aged',
      'window_key','openawait:'||o.breaker_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','warning',
      'breaker_id',o.breaker_id,
      'open_observed_at',o.observed_at,
      'age_minutes',ceil(extract(epoch from (now()-o.observed_at))/60.0)
    ) order by o.observed_at)
    from (
      select so.breaker_id, so.observation_id, so.observed_at
      from public.os_it_intune_recommendation_soak_observations so
      where so.soak_status='breaker_open_observed'
        and so.observed_at < now()-interval '24 hours'
        and not exists (
          select 1 from public.os_it_intune_soak_cycle_evidence c
          where c.open_observation_id=so.observation_id
        )
        and not exists (
          select 1 from public.os_it_intune_phase44_ops_alerts x
          where x.window_key=
            'openawait:'||so.breaker_id::text||':'||v_bucket||'h'||v_hours::text
        )
      order by so.observed_at asc
      limit 25
    ) o
  ), '[]'::jsonb) into v_part;
  v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','breaker_failure_rate_elevated',
      'window_key','failrate:'||s.breaker_id::text||':v'||s.config_version_no::text
        ||':'||v_bucket||'h'||v_hours::text,
      'severity','critical',
      'breaker_id',s.breaker_id,
      'config_version_no',s.config_version_no,
      'failure_rate',s.failure_rate,
      'sample_count',s.sample_count
    ) order by s.recorded_at desc)
    from (
      select p.breaker_id,p.config_version_no,p.failure_rate,p.sample_count,
        p.recorded_at,
        row_number() over (
          partition by p.breaker_id,p.config_version_no
          order by p.recorded_at desc, p.snapshot_id desc
        ) rn
      from public.os_it_intune_breaker_config_performance_snapshots p
      where p.recorded_at>=now()-interval '24 hours'
        and p.sample_count>=3
        and p.failure_rate>=0.5000
    ) s
    where s.rn=1
      and not exists (
        select 1 from public.os_it_intune_phase44_ops_alerts x
        where x.window_key=
          'failrate:'||s.breaker_id::text||':v'||s.config_version_no::text
            ||':'||v_bucket||'h'||v_hours::text
      )
    limit 25
  ), '[]'::jsonb) into v_part;
  v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);

  return jsonb_build_object(
    'version','phase44-v1',
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',coalesce(v_pending,'[]'::jsonb),
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record one ops alert after delivery attempt (idempotent window_key)
-- ---------------------------------------------------------------------------
create or replace function public.record_it_intune_phase44_ops_alert(p_alert jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_kind text;
  v_window text;
  v_dest text;
  v_delivery text;
  v_code integer;
  v_severity text;
  v_breaker uuid;
  v_evidence jsonb;
  v_hash text;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_alert,'{}'::jsonb))<>'object' then
    raise exception 'Phase 44 ops alert payload must be a JSON object';
  end if;

  v_kind:=coalesce(p_alert->>'alert_kind','');
  v_window:=coalesce(p_alert->>'window_key','');
  v_dest:=coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery:=coalesce(p_alert->>'delivery_status','recorded');
  v_code:=nullif(p_alert->>'response_code','')::integer;
  v_severity:=coalesce(nullif(p_alert->>'severity',''),'critical');
  v_breaker:=nullif(p_alert->>'breaker_id','')::uuid;

  if v_kind not in (
      'read_only_canary_unhealthy','canary_stale','canary_during_outage',
      'open_awaiting_close_aged','breaker_failure_rate_elevated')
    or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
    or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
    or v_delivery not in
      ('delivered','skipped_no_webhook','failed','recorded')
    or v_severity not in ('warning','critical') then
    raise exception 'Phase 44 ops alert contract is invalid';
  end if;

  if v_breaker is not null and not exists (
    select 1 from public.os_it_intune_provider_breakers
    where breaker_id=v_breaker
  ) then
    raise exception 'Phase 44 ops alert breaker is unknown';
  end if;

  v_evidence:=public.it_intune_phase44_sanitize_aggregate(
    coalesce(p_alert->'aggregate_evidence','{}'::jsonb)
    || jsonb_build_object(
      'evidence_version','phase44-v1',
      'alert_kind',v_kind,
      'window_key',v_window,
      'severity',v_severity,
      'destination_key',v_dest,
      'delivery_status',v_delivery,
      'response_code',v_code,
      'breaker_id',v_breaker,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    )
  );
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_it_intune_phase44_ops_alerts(
    alert_kind,window_key,severity,destination_key,delivery_status,
    response_code,breaker_id,aggregate_evidence,evidence_sha256
  ) values (
    v_kind,v_window,v_severity,v_dest,v_delivery,v_code,v_breaker,
    v_evidence,v_hash
  )
  on conflict (window_key) do nothing
  returning alert_id into v_id;

  if v_id is null then
    select alert_id into v_id
    from public.os_it_intune_phase44_ops_alerts
    where window_key=v_window;
    return jsonb_build_object(
      'inserted',false,
      'alert_id',v_id,
      'window_key',v_window,
      'closes_or_resets_breaker',false
    );
  end if;

  return jsonb_build_object(
    'inserted',true,
    'alert_id',v_id,
    'window_key',v_window,
    'closes_or_resets_breaker',false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Correlation enrichment — returns timeline jsonb; never mutates breakers
-- ---------------------------------------------------------------------------
create or replace function public.correlate_it_intune_resilience_phase44()
returns jsonb
language plpgsql
stable
security definer
set search_path=public as $$
declare
  v_timeline jsonb;
  v_summary jsonb;
begin
  -- Correlation is observe-only and never updates breaker rows or reset/close RPCs.
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.occurred_at desc),
    '[]'::jsonb)
  into v_timeline
  from (
    select t.breaker_id,t.event_kind,t.occurred_at,t.evidence_sha256,t.status
    from public.os_it_intune_resilience_correlation_timeline t
    where t.occurred_at>=now()-interval '14 days'
    order by t.occurred_at desc
    limit 200
  ) x;

  select jsonb_build_object(
    'outage_events_14d',
      (select count(*) from public.os_it_intune_outage_episode_events
        where created_at>=now()-interval '14 days'),
    'tuning_events_14d',
      (select count(*) from public.os_it_intune_breaker_tuning_events
        where created_at>=now()-interval '14 days'),
    'cycle_complete_14d',
      (select count(*) from public.os_it_intune_soak_cycle_evidence
        where recorded_at>=now()-interval '14 days'
          and cycle_status='cycle_complete'),
    'open_health_incidents',
      (select count(*) from public.os_it_intune_health_incidents
        where status='open'),
    'performance_snapshots_14d',
      (select count(*) from public.os_it_intune_breaker_config_performance_snapshots
        where recorded_at>=now()-interval '14 days')
  ) into v_summary;

  return jsonb_build_object(
    'version','phase44-v1',
    'summary',v_summary,
    'timeline',v_timeline,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

create or replace function public.get_it_intune_phase44_ops_report()
returns jsonb
language plpgsql
stable
security definer
set search_path=public as $$
declare
  v_health jsonb;
  v_snapshots jsonb;
  v_alerts jsonb;
  v_correlation jsonb;
begin
  select jsonb_build_object(
    'performance_snapshot_count',performance_snapshot_count,
    'ops_alert_count',ops_alert_count,
    'alerts_delivered_count',alerts_delivered_count,
    'alerts_undelivered_count',alerts_undelivered_count,
    'canary_unhealthy_alerts_7d',canary_unhealthy_alerts_7d,
    'canary_stale_alerts_7d',canary_stale_alerts_7d,
    'canary_during_outage_alerts_7d',canary_during_outage_alerts_7d,
    'open_awaiting_close_aged_7d',open_awaiting_close_aged_7d,
    'failure_rate_elevated_7d',failure_rate_elevated_7d,
    'correlation_events_7d',correlation_events_7d,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  ) into v_health
  from public.os_it_intune_phase44_health;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_snapshots
  from (
    select s.snapshot_id,s.breaker_id,s.config_version_no,s.sample_count,
      s.failure_count,s.failure_rate,s.time_closed_minutes,s.time_open_minutes,
      s.time_half_open_minutes,s.blocked_action_count,s.cycle_complete_count,
      s.evidence_sha256,s.bucket_key,s.recorded_at
    from public.os_it_intune_breaker_config_performance_snapshots s
    order by s.recorded_at desc
    limit 50
  ) x;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_alerts
  from (
    select a.alert_id,a.alert_kind,a.window_key,a.severity,a.destination_key,
      a.delivery_status,a.response_code,a.breaker_id,a.evidence_sha256,
      a.recorded_at
    from public.os_it_intune_phase44_ops_alerts a
    order by a.recorded_at desc
    limit 50
  ) x;

  v_correlation:=public.correlate_it_intune_resilience_phase44();

  return coalesce(v_health,'{}'::jsonb) || jsonb_build_object(
    'version','phase44-v1',
    'performance_snapshots',v_snapshots,
    'ops_alerts',v_alerts,
    'correlation',v_correlation
  );
end;
$$;

revoke all on function public.it_intune_phase44_sanitize_aggregate(jsonb)
  from public,authenticated,service_role;
revoke all on function public.snapshot_it_intune_breaker_performance_phase44()
  from public,authenticated;
revoke all on function public.list_it_intune_phase44_critical_windows(integer)
  from public,authenticated;
revoke all on function public.record_it_intune_phase44_ops_alert(jsonb)
  from public,authenticated;
revoke all on function public.correlate_it_intune_resilience_phase44()
  from public,authenticated;
revoke all on function public.get_it_intune_phase44_ops_report()
  from public,authenticated;

grant execute on function public.snapshot_it_intune_breaker_performance_phase44(),
  public.list_it_intune_phase44_critical_windows(integer),
  public.record_it_intune_phase44_ops_alert(jsonb),
  public.correlate_it_intune_resilience_phase44(),
  public.get_it_intune_phase44_ops_report()
  to service_role;

grant execute on function public.list_it_intune_phase44_critical_windows(integer),
  public.correlate_it_intune_resilience_phase44(),
  public.get_it_intune_phase44_ops_report()
  to authenticated;
