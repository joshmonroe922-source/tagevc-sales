-- Phase 50: week-over-week trends for owner digest delivery success SLOs,
-- plus an opt-in self-serve view of an owner's own digest delivery failures
-- in the Shared Services hub. NOT a full push notification system — the
-- owner must explicitly opt in, and failures are only ever pulled on demand
-- by the owner (or a firm-wide admin), never pushed.
-- Apply after phase49_slo_governance_ops.sql.
-- Counterfactual / governance only — never mutates os_slo_alerts evaluation
-- or production delivery paths. Reads read-only from Phase 49 owner digest
-- success SLO snapshots and Phase 47/48 delivery evidence; creates no new
-- delivery paths.

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

-- Bootstrap Phase 49 safe-detail helper if prior SLO SQL was skipped.
create or replace function public.phase49_slo_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body|email|webhook_url)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

create or replace function public.phase50_slo_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select public.phase49_slo_safe_detail(p_detail);
$$;

-- ---------------------------------------------------------------------------
-- Week-over-week trend snapshots (append-only), rolled up per owner from
-- Phase 49's owner digest delivery success SLO snapshots. Read + append-only
-- — never mutates the Phase 49 snapshots or production alert evaluation.
-- ---------------------------------------------------------------------------
create table if not exists public.os_slo_owner_digest_wow_trend_snapshots (
  trend_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  window_key text not null unique,
  current_snapshot_id uuid
    references public.os_slo_owner_digest_delivery_success_slos(snapshot_id),
  prior_snapshot_id uuid
    references public.os_slo_owner_digest_delivery_success_slos(snapshot_id),
  current_success_rate numeric(6,4),
  prior_success_rate numeric(6,4),
  rate_delta numeric(6,4),
  trend_direction text not null default 'unknown',
  severity text not null default 'healthy',
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_slo_owner_digest_wow_direction_check
    check (trend_direction in ('improving','stable','declining','unknown')),
  constraint os_slo_owner_digest_wow_severity_check
    check (severity in ('healthy','warning','critical')),
  constraint os_slo_owner_digest_wow_rate_check
    check (
      (current_success_rate is null or (current_success_rate>=0 and current_success_rate<=1))
      and (prior_success_rate is null or (prior_success_rate>=0 and prior_success_rate<=1))
      and (rate_delta is null or (rate_delta>=-1 and rate_delta<=1))
    ),
  constraint os_slo_owner_digest_wow_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_slo_owner_digest_wow_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_slo_owner_digest_wow_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

create index if not exists os_slo_owner_digest_wow_owner_idx
  on public.os_slo_owner_digest_wow_trend_snapshots(owner_id,created_at desc);
create index if not exists os_slo_owner_digest_wow_direction_idx
  on public.os_slo_owner_digest_wow_trend_snapshots(trend_direction,created_at desc);

-- ---------------------------------------------------------------------------
-- Grow-only opt-in preference log. The CURRENT preference for an owner is
-- always the most recent row for that owner_id — this table is never
-- updated or deleted, only appended to, so the opt-in history is auditable.
-- ---------------------------------------------------------------------------
create table if not exists public.os_slo_owner_digest_self_serve_opt_ins (
  opt_in_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  opted_in boolean not null,
  changed_by uuid not null references public.profiles(id),
  reason text,
  change_key text not null unique,
  created_at timestamptz not null default now(),
  constraint os_slo_owner_digest_opt_in_reason_check
    check (reason is null or length(reason)<=500),
  constraint os_slo_owner_digest_opt_in_change_key_check
    check (change_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$')
);

create index if not exists os_slo_owner_digest_opt_in_owner_idx
  on public.os_slo_owner_digest_self_serve_opt_ins(owner_id,created_at desc);

create or replace function public.prevent_slo_phase50_append_only()
returns trigger language plpgsql as $$
begin raise exception '% is append-only',tg_table_name; end $$;

drop trigger if exists os_slo_owner_digest_wow_append_only
  on public.os_slo_owner_digest_wow_trend_snapshots;
create trigger os_slo_owner_digest_wow_append_only before update or delete
  on public.os_slo_owner_digest_wow_trend_snapshots for each row
  execute function public.prevent_slo_phase50_append_only();
drop trigger if exists os_slo_owner_digest_wow_no_truncate
  on public.os_slo_owner_digest_wow_trend_snapshots;
create trigger os_slo_owner_digest_wow_no_truncate before truncate
  on public.os_slo_owner_digest_wow_trend_snapshots for each statement
  execute function public.prevent_slo_phase50_append_only();

drop trigger if exists os_slo_owner_digest_opt_in_append_only
  on public.os_slo_owner_digest_self_serve_opt_ins;
create trigger os_slo_owner_digest_opt_in_append_only before update or delete
  on public.os_slo_owner_digest_self_serve_opt_ins for each row
  execute function public.prevent_slo_phase50_append_only();
drop trigger if exists os_slo_owner_digest_opt_in_no_truncate
  on public.os_slo_owner_digest_self_serve_opt_ins;
create trigger os_slo_owner_digest_opt_in_no_truncate before truncate
  on public.os_slo_owner_digest_self_serve_opt_ins for each statement
  execute function public.prevent_slo_phase50_append_only();

-- Compare each owner's latest Phase 49 snapshot against the closest prior
-- snapshot at least 7 days earlier. Read + append-only.
create or replace function public.record_slo_owner_digest_wow_trend_phase50(
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_recorded integer:=0;
  v_owners_tracked integer:=0;
  v_direction text;
  v_severity text;
  v_delta numeric;
  v_window text;
  v_hash text;
begin
  if p_actor_id is not null
     and not public.phase39_actor_authorized(p_actor_id,null,true)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Actor is not authorized to record owner digest WoW trends';
  end if;

  for v_row in
    select distinct on (cur.owner_id)
      cur.owner_id,
      cur.snapshot_id as current_snapshot_id,
      cur.success_rate as current_success_rate,
      cur.severity as current_severity,
      prior.snapshot_id as prior_snapshot_id,
      prior.success_rate as prior_success_rate
    from public.os_slo_owner_digest_delivery_success_slos cur
    left join lateral (
      select p.snapshot_id, p.success_rate
      from public.os_slo_owner_digest_delivery_success_slos p
      where p.owner_id=cur.owner_id
        and p.created_at<=cur.created_at-interval '7 days'
      order by p.created_at desc
      limit 1
    ) prior on true
    order by cur.owner_id, cur.created_at desc
    limit 200
  loop
    v_window:='phase50:wow:'||v_row.owner_id::text||':'||
      to_char(now() at time zone 'utc','YYYY-MM-DD');

    if exists (
      select 1 from public.os_slo_owner_digest_wow_trend_snapshots s
      where s.window_key=v_window
    ) then
      continue;
    end if;

    if v_row.prior_success_rate is null or v_row.current_success_rate is null then
      v_direction:='unknown';
      v_delta:=null;
      v_severity:=coalesce(v_row.current_severity,'healthy');
    else
      v_delta:=round(v_row.current_success_rate-v_row.prior_success_rate,4);
      if v_delta>0.0200 then
        v_direction:='improving';
      elsif v_delta<-0.0200 then
        v_direction:='declining';
      else
        v_direction:='stable';
      end if;
      v_severity:=coalesce(v_row.current_severity,'healthy');
      if v_direction='declining' and v_severity='healthy' then
        v_severity:='warning';
      end if;
    end if;

    v_hash:=public.os_sha256_hex(jsonb_build_object(
      'contract_version','phase50-v1',
      'owner_id',v_row.owner_id,
      'current_success_rate',v_row.current_success_rate,
      'prior_success_rate',v_row.prior_success_rate,
      'rate_delta',v_delta,
      'trend_direction',v_direction,
      'severity',v_severity,
      'window_key',v_window
    )::text);

    insert into public.os_slo_owner_digest_wow_trend_snapshots(
      owner_id,window_key,current_snapshot_id,prior_snapshot_id,
      current_success_rate,prior_success_rate,rate_delta,trend_direction,
      severity,metrics_sha256,detail
    ) values (
      v_row.owner_id,v_window,v_row.current_snapshot_id,v_row.prior_snapshot_id,
      v_row.current_success_rate,v_row.prior_success_rate,v_delta,v_direction,
      v_severity,v_hash,
      jsonb_build_object(
        'contract_version','phase50-v1',
        'metric','owner_digest_delivery_success_rate_wow',
        'comparison_window_days',7,
        'source','record_slo_owner_digest_wow_trend_phase50'
      )
    );
    v_recorded:=v_recorded+1;
    v_owners_tracked:=v_owners_tracked+1;
  end loop;

  return jsonb_build_object(
    'ok',true,
    'wow_trend_snapshots_recorded',v_recorded,
    'owners_tracked',v_owners_tracked,
    'production_alerts_mutated',false,
    'full_push',false,
    'contract_version','phase50-v1'
  );
end $$;

-- Self-serve opt-in toggle. An owner may opt themselves in/out; a firm-wide
-- actor may also change it on the owner's behalf. Always appends a new row
-- — never updates or deletes prior preference history.
create or replace function public.set_slo_owner_digest_self_serve_opt_in_phase50(
  p_owner_id uuid,
  p_actor_id uuid,
  p_opted_in boolean,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text:=nullif(trim(coalesce(p_reason,'')),'');
  v_key text;
  v_id uuid;
begin
  if p_owner_id is null or p_actor_id is null or p_opted_in is null then
    raise exception 'Phase 50 self-serve opt-in requires owner, actor, and opted_in';
  end if;
  if p_actor_id<>p_owner_id
     and not public.phase39_actor_authorized(p_actor_id,null,true)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Only the owner or a firm-wide actor may change this opt-in';
  end if;
  if v_reason is not null and length(v_reason)>500 then
    raise exception 'Opt-in reason must be 500 characters or fewer';
  end if;

  v_key:='phase50:optin:'||p_owner_id::text||':'||
    extract(epoch from clock_timestamp())::text||':'||gen_random_uuid()::text;

  insert into public.os_slo_owner_digest_self_serve_opt_ins(
    owner_id,opted_in,changed_by,reason,change_key
  ) values (
    p_owner_id,p_opted_in,p_actor_id,v_reason,v_key
  ) returning opt_in_id into v_id;

  return jsonb_build_object(
    'opt_in_id',v_id,
    'owner_id',p_owner_id,
    'opted_in',p_opted_in,
    'full_push',false,
    'contract_version','phase50-v1'
  );
end $$;

-- Self-serve, pull-only view of an owner's own digest delivery failures.
-- Returns rows ONLY when the owner is currently opted in AND the caller is
-- the owner themselves or a firm-wide actor. Never pushes anything — the
-- owner (or admin) must explicitly call this to see their failures.
create or replace function public.list_slo_owner_digest_self_serve_failures_phase50(
  p_owner_id uuid,
  p_actor_id uuid,
  p_days integer default 30
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer:=least(greatest(coalesce(p_days,30),1),90);
  v_opted_in boolean:=false;
  v_failures jsonb:='[]'::jsonb;
begin
  if p_owner_id is null or p_actor_id is null then
    raise exception 'Phase 50 self-serve failure view requires owner and actor';
  end if;
  if p_actor_id<>p_owner_id
     and not public.phase39_actor_authorized(p_actor_id,null,true)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Only the owner or a firm-wide actor may view these failures';
  end if;

  select opted_in into v_opted_in
  from public.os_slo_owner_digest_self_serve_opt_ins
  where owner_id=p_owner_id
  order by created_at desc
  limit 1;
  v_opted_in:=coalesce(v_opted_in,false);

  if v_opted_in then
    select coalesce(jsonb_agg(row_to_json(f)::jsonb order by f.created_at desc),'[]'::jsonb)
      into v_failures
    from (
      select d.delivery_id,d.destination_key,d.response_code,d.window_key,d.created_at
      from public.os_slo_digest_notification_deliveries d
      join public.os_slo_handoff_digest_notifications n
        on n.notification_id=d.notification_id
      where n.owner_id=p_owner_id
        and d.delivery_status='failed'
        and d.created_at>=now()-(v_days||' days')::interval
      order by d.created_at desc
      limit 20
    ) f;
  end if;

  return jsonb_build_object(
    'owner_id',p_owner_id,
    'opted_in',v_opted_in,
    'window_days',v_days,
    'failures',v_failures,
    'full_push',false,
    'contract_version','phase50-v1'
  );
end $$;

-- Hub report: WoW trend visibility + opt-in adoption counts. Firm-wide only
-- (mirrors Phase 49's report scope); per-owner detail is via the self-serve
-- failure view above.
create or replace function public.get_slo_phase50_owner_digest_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_recent jsonb:='[]'::jsonb;
  v_improving integer:=0;
  v_stable integer:=0;
  v_declining integer:=0;
  v_unknown integer:=0;
  v_opted_in_count integer:=0;
  v_owners_with_pref integer:=0;
begin
  if not public.is_firm_wide_access()
     and auth.role() is distinct from 'service_role' then
    raise exception 'Firm-wide access required for SLO Phase 50 owner digest report';
  end if;

  select coalesce(jsonb_agg(row_to_json(y)::jsonb order by y.created_at desc),'[]'::jsonb)
    into v_recent
  from (
    select t.* from (
      select distinct on (s.owner_id)
        s.trend_id,
        s.owner_id,
        s.current_success_rate,
        s.prior_success_rate,
        s.rate_delta,
        s.trend_direction,
        s.severity,
        s.created_at
      from public.os_slo_owner_digest_wow_trend_snapshots s
      where s.created_at>=now()-interval '30 days'
      order by s.owner_id, s.created_at desc
    ) t
    order by t.created_at desc
    limit 40
  ) y;

  select
    count(*) filter (where trend_direction='improving'),
    count(*) filter (where trend_direction='stable'),
    count(*) filter (where trend_direction='declining'),
    count(*) filter (where trend_direction='unknown')
  into v_improving,v_stable,v_declining,v_unknown
  from (
    select distinct on (owner_id) owner_id, trend_direction
    from public.os_slo_owner_digest_wow_trend_snapshots
    where created_at>=now()-interval '30 days'
    order by owner_id, created_at desc
  ) x;

  select
    count(*) filter (where opted_in),
    count(*)
  into v_opted_in_count,v_owners_with_pref
  from (
    select distinct on (owner_id) owner_id, opted_in
    from public.os_slo_owner_digest_self_serve_opt_ins
    order by owner_id, created_at desc
  ) z;

  return jsonb_build_object(
    'owners_improving_30d',v_improving,
    'owners_stable_30d',v_stable,
    'owners_declining_30d',v_declining,
    'owners_unknown_30d',v_unknown,
    'owners_opted_in',v_opted_in_count,
    'owners_with_opt_in_preference',v_owners_with_pref,
    'recent_wow_trends',v_recent,
    'production_alerts_mutated',false,
    'full_push',false,
    'contract_version','phase50-v1'
  );
end $$;

alter table public.os_slo_owner_digest_wow_trend_snapshots enable row level security;
drop policy if exists "os_slo_owner_digest_wow_select"
  on public.os_slo_owner_digest_wow_trend_snapshots;
create policy "os_slo_owner_digest_wow_select"
  on public.os_slo_owner_digest_wow_trend_snapshots for select to authenticated
  using (public.is_firm_wide_access() or owner_id=auth.uid());

grant select on public.os_slo_owner_digest_wow_trend_snapshots
  to authenticated, service_role;
revoke insert,update,delete,truncate on
  public.os_slo_owner_digest_wow_trend_snapshots
  from public,authenticated,service_role;

alter table public.os_slo_owner_digest_self_serve_opt_ins enable row level security;
drop policy if exists "os_slo_owner_digest_opt_in_select"
  on public.os_slo_owner_digest_self_serve_opt_ins;
create policy "os_slo_owner_digest_opt_in_select"
  on public.os_slo_owner_digest_self_serve_opt_ins for select to authenticated
  using (public.is_firm_wide_access() or owner_id=auth.uid());

grant select on public.os_slo_owner_digest_self_serve_opt_ins
  to authenticated, service_role;
revoke insert,update,delete,truncate on
  public.os_slo_owner_digest_self_serve_opt_ins
  from public,authenticated,service_role;

revoke all on function public.prevent_slo_phase50_append_only()
  from public,anon,authenticated,service_role;
revoke all on function public.record_slo_owner_digest_wow_trend_phase50(uuid)
  from public,authenticated;
revoke all on function public.set_slo_owner_digest_self_serve_opt_in_phase50(
  uuid,uuid,boolean,text
) from public;
revoke all on function public.list_slo_owner_digest_self_serve_failures_phase50(
  uuid,uuid,integer
) from public;
revoke all on function public.get_slo_phase50_owner_digest_report()
  from public,anon;

grant execute on function public.phase50_slo_safe_detail(jsonb),
  public.get_slo_phase50_owner_digest_report()
  to authenticated, service_role;
grant execute on function public.record_slo_owner_digest_wow_trend_phase50(uuid)
  to service_role;
grant execute on function public.set_slo_owner_digest_self_serve_opt_in_phase50(
  uuid,uuid,boolean,text
) to authenticated, service_role;
grant execute on function public.list_slo_owner_digest_self_serve_failures_phase50(
  uuid,uuid,integer
) to authenticated, service_role;
