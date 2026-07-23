-- Phase 52: firm-wide admin SUMMARY trend view for digest delivery health
-- (aggregate across owners — not per-owner only). Apply after
-- phase51_slo_governance_ops.sql. Safe to re-run.
-- Still pull-only / NOT a full push notification system: admins must
-- explicitly request the view; nothing is pushed. Counterfactual /
-- governance only — never mutates os_slo_alerts evaluation or production
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

create or replace function public.phase51_slo_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body|email|webhook_url)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

create or replace function public.phase52_slo_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select public.phase51_slo_safe_detail(p_detail);
$$;

-- ---------------------------------------------------------------------------
-- Append-only firm-wide digest delivery admin summary trend snapshots.
-- Aggregates Phase 50 WoW owner snapshots into a firm-wide success-rate
-- series for admins. Pull-only — never pushes digests.
-- ---------------------------------------------------------------------------
create table if not exists public.os_slo_firm_digest_admin_summary_trend_snapshots (
  summary_id uuid primary key default gen_random_uuid(),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  owners_aggregated integer not null default 0 check (owners_aggregated >= 0),
  current_success_rate numeric(6,4),
  prior_success_rate numeric(6,4),
  rate_delta numeric(6,4),
  trend_direction text not null default 'unknown'
    check (trend_direction in ('improving','stable','declining','unknown')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_slo_p52_summary_rate_check
    check (
      (current_success_rate is null or (current_success_rate>=0 and current_success_rate<=1))
      and (prior_success_rate is null or (prior_success_rate>=0 and prior_success_rate<=1))
    ),
  constraint os_slo_p52_summary_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase52_slo_safe_detail(detail)
    ),
  constraint os_slo_p52_summary_no_push_check
    check (coalesce((detail->>'full_push')::boolean,false)=false)
);

create index if not exists os_slo_p52_summary_created_idx
  on public.os_slo_firm_digest_admin_summary_trend_snapshots(created_at desc);

alter table public.os_slo_firm_digest_admin_summary_trend_snapshots
  enable row level security;
drop policy if exists "os_slo_p52_summary_select"
  on public.os_slo_firm_digest_admin_summary_trend_snapshots;
create policy "os_slo_p52_summary_select"
  on public.os_slo_firm_digest_admin_summary_trend_snapshots for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_slo_firm_digest_admin_summary_trend_snapshots
  from public, anon, authenticated;
grant select on public.os_slo_firm_digest_admin_summary_trend_snapshots
  to authenticated;

create or replace function public.reject_slo_phase52_ops_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'SLO Phase 52 firm digest admin summary evidence is append-only';
end;
$$;

drop trigger if exists os_slo_p52_summary_immutable
  on public.os_slo_firm_digest_admin_summary_trend_snapshots;
create trigger os_slo_p52_summary_immutable
  before update or delete on public.os_slo_firm_digest_admin_summary_trend_snapshots
  for each row execute function public.reject_slo_phase52_ops_mutation();
drop trigger if exists os_slo_p52_summary_no_truncate
  on public.os_slo_firm_digest_admin_summary_trend_snapshots;
create trigger os_slo_p52_summary_no_truncate
  before truncate on public.os_slo_firm_digest_admin_summary_trend_snapshots
  for each statement execute function public.reject_slo_phase52_ops_mutation();

-- Record a firm-wide admin summary trend point by aggregating the latest
-- Phase 50 WoW snapshots per opted-in owner. Pull-only / NOT a full push.
create or replace function public.record_slo_firm_digest_admin_summary_trend_phase52(
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owners integer := 0;
  v_current numeric;
  v_prior numeric;
  v_delta numeric;
  v_direction text := 'unknown';
  v_window text;
  v_hash text;
  v_id uuid;
begin
  if p_actor_id is not null
     and not public.phase39_actor_authorized(p_actor_id,null,true)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Phase 52 firm digest admin summary requires firm-wide actor or service_role';
  end if;

  select count(distinct s.owner_id),
    avg(s.current_success_rate),
    avg(s.prior_success_rate)
  into v_owners, v_current, v_prior
  from (
    select distinct on (w.owner_id)
      w.owner_id, w.current_success_rate, w.prior_success_rate
    from public.os_slo_owner_digest_wow_trend_snapshots w
    join public.os_slo_owner_digest_self_serve_opt_ins o
      on o.owner_id=w.owner_id
    where o.opted_in
    order by w.owner_id, w.created_at desc
  ) s;

  v_owners := coalesce(v_owners,0);
  if v_current is not null and v_prior is not null then
    v_delta := v_current - v_prior;
    if v_delta > 0.0100 then
      v_direction := 'improving';
    elsif v_delta < -0.0100 then
      v_direction := 'declining';
    else
      v_direction := 'stable';
    end if;
  end if;

  v_window := 'phase52:firmsummary:' || to_char(now() at time zone 'utc','YYYY-MM-DD');
  if exists (
    select 1 from public.os_slo_firm_digest_admin_summary_trend_snapshots t
    where t.window_key=v_window
  ) then
    select summary_id into v_id
    from public.os_slo_firm_digest_admin_summary_trend_snapshots
    where window_key=v_window;
    return jsonb_build_object(
      'summary_id',v_id,
      'already_recorded_today',true,
      'full_push',false,
      'contract_version','phase52-v1'
    );
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'contract_version','phase52-v1',
    'owners_aggregated',v_owners,
    'current_success_rate',v_current,
    'prior_success_rate',v_prior,
    'trend_direction',v_direction,
    'window_key',v_window
  )::text);

  insert into public.os_slo_firm_digest_admin_summary_trend_snapshots(
    window_key,owners_aggregated,current_success_rate,prior_success_rate,
    rate_delta,trend_direction,metrics_sha256,detail
  ) values (
    v_window,v_owners,v_current,v_prior,v_delta,v_direction,v_hash,
    jsonb_build_object(
      'contract_version','phase52-v1',
      'full_push',false,
      'source','record_slo_firm_digest_admin_summary_trend_phase52'
    )
  ) returning summary_id into v_id;

  return jsonb_build_object(
    'summary_id',v_id,
    'owners_aggregated',v_owners,
    'current_success_rate',v_current,
    'prior_success_rate',v_prior,
    'rate_delta',v_delta,
    'trend_direction',v_direction,
    'full_push',false,
    'contract_version','phase52-v1'
  );
end $$;

-- Pull-only firm-wide admin summary trend series (not per-owner).
create or replace function public.list_slo_firm_digest_admin_summary_trend_phase52(
  p_weeks integer default 8
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_weeks integer:=least(greatest(coalesce(p_weeks,8),1),26);
  v_series jsonb:='[]'::jsonb;
  v_points integer:=0;
begin
  if not public.is_firm_wide_access()
     and auth.role() is distinct from 'service_role' then
    raise exception 'Firm-wide access required for SLO Phase 52 firm digest admin summary trend';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at asc),'[]'::jsonb),
    count(*)
    into v_series, v_points
  from (
    select s.summary_id,s.owners_aggregated,s.current_success_rate,
      s.prior_success_rate,s.rate_delta,s.trend_direction,s.created_at
    from public.os_slo_firm_digest_admin_summary_trend_snapshots s
    order by s.created_at desc
    limit v_weeks
  ) t;

  return jsonb_build_object(
    'weeks_requested',v_weeks,
    'chart_ready',coalesce(v_points,0)>=2,
    'series',v_series,
    'full_push',false,
    'contract_version','phase52-v1'
  );
end $$;

create or replace function public.get_slo_phase52_firm_digest_admin_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_latest public.os_slo_firm_digest_admin_summary_trend_snapshots%rowtype;
  v_points integer:=0;
begin
  if not public.is_firm_wide_access()
     and auth.role() is distinct from 'service_role' then
    raise exception 'Firm-wide access required for SLO Phase 52 firm digest admin report';
  end if;

  select * into v_latest
  from public.os_slo_firm_digest_admin_summary_trend_snapshots
  order by created_at desc
  limit 1;

  select count(*) into v_points
  from public.os_slo_firm_digest_admin_summary_trend_snapshots;

  return jsonb_build_object(
    'owners_aggregated',coalesce(v_latest.owners_aggregated,0),
    'current_success_rate',v_latest.current_success_rate,
    'prior_success_rate',v_latest.prior_success_rate,
    'rate_delta',v_latest.rate_delta,
    'trend_direction',coalesce(v_latest.trend_direction,'unknown'),
    'summary_points',coalesce(v_points,0),
    'chart_ready',coalesce(v_points,0)>=2,
    'production_alerts_mutated',false,
    'full_push',false,
    'contract_version','phase52-v1'
  );
end $$;

revoke all on function public.record_slo_firm_digest_admin_summary_trend_phase52(uuid)
  from public,authenticated;
revoke all on function public.list_slo_firm_digest_admin_summary_trend_phase52(integer)
  from public;
revoke all on function public.get_slo_phase52_firm_digest_admin_report()
  from public,anon;

grant execute on function public.phase52_slo_safe_detail(jsonb),
  public.get_slo_phase52_firm_digest_admin_report(),
  public.list_slo_firm_digest_admin_summary_trend_phase52(integer)
  to authenticated, service_role;
grant execute on function public.record_slo_firm_digest_admin_summary_trend_phase52(uuid)
  to service_role;
