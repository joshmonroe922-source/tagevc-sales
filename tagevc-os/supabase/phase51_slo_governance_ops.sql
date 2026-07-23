-- Phase 51: per-owner trend CHARTS on the opt-in self-serve digest failure
-- view, built by reusing the existing Phase 50 week-over-week trend
-- snapshots — no new delivery paths, no new tables. Apply after
-- phase50_slo_governance_ops.sql. Safe to re-run.
-- Still pull-only / NOT a full push notification system: the owner (or a
-- firm-wide admin) must explicitly call this RPC to see the chart; nothing
-- is pushed. Counterfactual / governance only — never mutates os_slo_alerts
-- evaluation or production delivery paths.

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

-- Bootstrap Phase 50 safe-detail helper if prior SLO SQL was skipped.
create or replace function public.phase50_slo_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body|email|webhook_url)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

create or replace function public.phase51_slo_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select public.phase50_slo_safe_detail(p_detail);
$$;

-- Self-serve, pull-only per-owner TREND CHART series built from the
-- existing Phase 50 week-over-week trend snapshots. Returns rows ONLY when
-- the owner is currently opted in AND the caller is the owner themselves or
-- a firm-wide actor — identical gating to
-- list_slo_owner_digest_self_serve_failures_phase50. Never pushes anything.
create or replace function public.list_slo_owner_digest_self_serve_trend_phase51(
  p_owner_id uuid,
  p_actor_id uuid,
  p_weeks integer default 8
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_weeks integer:=least(greatest(coalesce(p_weeks,8),1),26);
  v_opted_in boolean:=false;
  v_series jsonb:='[]'::jsonb;
  v_points integer:=0;
begin
  if p_owner_id is null or p_actor_id is null then
    raise exception 'Phase 51 self-serve trend chart requires owner and actor';
  end if;
  if p_actor_id<>p_owner_id
     and not public.phase39_actor_authorized(p_actor_id,null,true)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Only the owner or a firm-wide actor may view this trend chart';
  end if;

  select opted_in into v_opted_in
  from public.os_slo_owner_digest_self_serve_opt_ins
  where owner_id=p_owner_id
  order by created_at desc
  limit 1;
  v_opted_in:=coalesce(v_opted_in,false);

  if v_opted_in then
    select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at asc),'[]'::jsonb),
      count(*)
      into v_series, v_points
    from (
      select s.trend_id,s.current_success_rate,s.prior_success_rate,
        s.rate_delta,s.trend_direction,s.severity,s.created_at
      from public.os_slo_owner_digest_wow_trend_snapshots s
      where s.owner_id=p_owner_id
      order by s.created_at desc
      limit v_weeks
    ) t;
  end if;

  return jsonb_build_object(
    'owner_id',p_owner_id,
    'opted_in',v_opted_in,
    'weeks_requested',v_weeks,
    'chart_ready',v_opted_in and coalesce(v_points,0)>=2,
    'series',v_series,
    'full_push',false,
    'contract_version','phase51-v1'
  );
end $$;

-- Hub report: extends the Phase 50 firm-wide owner digest report with the
-- count of opted-in owners whose self-serve trend chart currently has
-- enough points to render (>=2 Phase 50 WoW snapshots). Firm-wide only.
create or replace function public.get_slo_phase51_owner_digest_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_chart_ready_owners integer:=0;
  v_owners_with_any_trend integer:=0;
begin
  if not public.is_firm_wide_access()
     and auth.role() is distinct from 'service_role' then
    raise exception 'Firm-wide access required for SLO Phase 51 owner digest report';
  end if;

  select count(*) filter (where points>=2), count(*)
  into v_chart_ready_owners, v_owners_with_any_trend
  from (
    select s.owner_id, count(*) as points
    from public.os_slo_owner_digest_wow_trend_snapshots s
    join public.os_slo_owner_digest_self_serve_opt_ins o
      on o.owner_id=s.owner_id
    where o.opted_in
    group by s.owner_id
  ) x;

  return jsonb_build_object(
    'chart_ready_owner_count',coalesce(v_chart_ready_owners,0),
    'owners_with_any_trend_count',coalesce(v_owners_with_any_trend,0),
    'production_alerts_mutated',false,
    'full_push',false,
    'contract_version','phase51-v1'
  );
end $$;

revoke all on function public.list_slo_owner_digest_self_serve_trend_phase51(
  uuid,uuid,integer
) from public;
revoke all on function public.get_slo_phase51_owner_digest_report()
  from public,anon;

grant execute on function public.phase51_slo_safe_detail(jsonb),
  public.get_slo_phase51_owner_digest_report()
  to authenticated, service_role;
grant execute on function public.list_slo_owner_digest_self_serve_trend_phase51(
  uuid,uuid,integer
) to authenticated, service_role;
