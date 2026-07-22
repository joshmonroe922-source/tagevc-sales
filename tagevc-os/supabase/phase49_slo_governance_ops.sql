-- Phase 49: per-owner digest webhook delivery success SLO tracking, surfaced
-- in the Shared Services hub. NOT a full push notification system.
-- Apply after phase48_slo_governance_ops.sql.
-- Counterfactual / governance only — never mutates os_slo_alerts evaluation
-- or production delivery paths. Scans read-only from Phase 48 delivery
-- evidence; this file creates no new delivery paths.

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

-- Bootstrap Phase 48 safe-detail helper if prior SLO SQL was skipped.
create or replace function public.phase48_slo_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body|email|webhook_url)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

create or replace function public.phase49_slo_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select public.phase48_slo_safe_detail(p_detail);
$$;

-- ---------------------------------------------------------------------------
-- Per-owner digest delivery success SLO snapshots (append-only). Rolled up
-- by owner_id (not just destination_key) so a specific owner silently
-- missing digests is directly visible.
-- ---------------------------------------------------------------------------
create table if not exists public.os_slo_owner_digest_delivery_success_slos (
  snapshot_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  window_key text not null unique,
  window_days integer not null,
  delivered_count integer not null default 0,
  failed_count integer not null default 0,
  skipped_count integer not null default 0,
  success_rate numeric(6,4),
  severity text not null default 'healthy',
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_slo_owner_digest_succ_days_check
    check (window_days between 1 and 90),
  constraint os_slo_owner_digest_succ_counts_check
    check (
      delivered_count>=0 and failed_count>=0 and skipped_count>=0
      and delivered_count<=1000000 and failed_count<=1000000
      and skipped_count<=1000000
    ),
  constraint os_slo_owner_digest_succ_rate_check
    check (success_rate is null or (success_rate>=0 and success_rate<=1)),
  constraint os_slo_owner_digest_succ_severity_check
    check (severity in ('healthy','warning','critical')),
  constraint os_slo_owner_digest_succ_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_slo_owner_digest_succ_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_slo_owner_digest_succ_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

create index if not exists os_slo_owner_digest_succ_owner_idx
  on public.os_slo_owner_digest_delivery_success_slos(owner_id,created_at desc);
create index if not exists os_slo_owner_digest_succ_severity_idx
  on public.os_slo_owner_digest_delivery_success_slos(severity,created_at desc);

create or replace function public.prevent_slo_phase49_append_only()
returns trigger language plpgsql as $$
begin raise exception '% is append-only',tg_table_name; end $$;

drop trigger if exists os_slo_owner_digest_succ_append_only
  on public.os_slo_owner_digest_delivery_success_slos;
create trigger os_slo_owner_digest_succ_append_only before update or delete
  on public.os_slo_owner_digest_delivery_success_slos for each row
  execute function public.prevent_slo_phase49_append_only();
drop trigger if exists os_slo_owner_digest_succ_no_truncate
  on public.os_slo_owner_digest_delivery_success_slos;
create trigger os_slo_owner_digest_succ_no_truncate before truncate
  on public.os_slo_owner_digest_delivery_success_slos for each statement
  execute function public.prevent_slo_phase49_append_only();

-- Scan Phase 48 delivery evidence (deliveries joined to notifications by
-- notification_id) into per-owner success SLO snapshots. Read + append-only.
create or replace function public.scan_slo_owner_digest_delivery_success_phase49(
  p_actor_id uuid default null,
  p_days integer default 30
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer:=least(greatest(coalesce(p_days,30),1),90);
  v_since timestamptz:=now()-(v_days||' days')::interval;
  v_row record;
  v_recorded integer:=0;
  v_success numeric;
  v_severity text;
  v_attempted integer;
  v_window text;
  v_hash text;
  v_owners_tracked integer:=0;
begin
  if p_actor_id is not null
     and not public.phase39_actor_authorized(p_actor_id,null,true)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Actor is not authorized to scan owner digest delivery success SLOs';
  end if;

  for v_row in
    select n.owner_id,
      count(*) filter (where d.delivery_status='delivered')::integer as delivered_count,
      count(*) filter (where d.delivery_status='failed')::integer as failed_count,
      count(*) filter (where d.delivery_status in (
        'skipped_no_webhook','skipped_not_allowlisted'
      ))::integer as skipped_count
    from public.os_slo_digest_notification_deliveries d
    join public.os_slo_handoff_digest_notifications n
      on n.notification_id=d.notification_id
    where d.created_at>=v_since
    group by n.owner_id
    order by n.owner_id
    limit 200
  loop
    v_attempted:=v_row.delivered_count+v_row.failed_count;
    if v_attempted=0 then
      v_success:=null;
      v_severity:='healthy';
    else
      v_success:=round(
        (v_row.delivered_count::numeric / v_attempted::numeric),4
      );
      if v_success<0.8000 then
        v_severity:='critical';
      elsif v_success<0.9500 then
        v_severity:='warning';
      else
        v_severity:='healthy';
      end if;
    end if;

    v_window:='phase49:owner_digest_succ:'||v_row.owner_id::text||':'||
      to_char(now() at time zone 'utc','YYYY-MM-DD')||':'||v_days::text;

    if exists (
      select 1 from public.os_slo_owner_digest_delivery_success_slos s
      where s.window_key=v_window
    ) then
      continue;
    end if;

    v_hash:=public.os_sha256_hex(jsonb_build_object(
      'contract_version','phase49-v1',
      'delivered',v_row.delivered_count,
      'owner_id',v_row.owner_id,
      'failed',v_row.failed_count,
      'severity',v_severity,
      'skipped',v_row.skipped_count,
      'success_rate',v_success,
      'window_days',v_days,
      'window_key',v_window
    )::text);

    insert into public.os_slo_owner_digest_delivery_success_slos(
      owner_id,window_key,window_days,delivered_count,failed_count,
      skipped_count,success_rate,severity,metrics_sha256,detail
    ) values (
      v_row.owner_id,v_window,v_days,
      v_row.delivered_count,v_row.failed_count,v_row.skipped_count,
      v_success,v_severity,v_hash,
      jsonb_build_object(
        'contract_version','phase49-v1',
        'metric','owner_digest_delivery_success_rate',
        'warning_threshold',0.9500,
        'critical_threshold',0.8000,
        'source','scan_slo_owner_digest_delivery_success_phase49'
      )
    );
    v_recorded:=v_recorded+1;
    v_owners_tracked:=v_owners_tracked+1;
  end loop;

  return jsonb_build_object(
    'ok',true,
    'owner_slo_snapshots_recorded',v_recorded,
    'owners_tracked',v_owners_tracked,
    'window_days',v_days,
    'production_alerts_mutated',false,
    'full_push',false,
    'contract_version','phase49-v1'
  );
end $$;

-- Hub report: owner-level success/failure rate visibility.
create or replace function public.get_slo_phase49_owner_digest_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_recent jsonb:='[]'::jsonb;
  v_healthy integer:=0;
  v_warning integer:=0;
  v_critical integer:=0;
  v_owners_tracked integer:=0;
  v_overall_rate numeric;
begin
  if not public.is_firm_wide_access()
     and auth.role() is distinct from 'service_role' then
    raise exception 'Firm-wide access required for SLO Phase 49 owner digest report';
  end if;

  select coalesce(jsonb_agg(row_to_json(y)::jsonb order by y.created_at desc),'[]'::jsonb)
    into v_recent
  from (
    select t.* from (
      select distinct on (s.owner_id)
        s.snapshot_id,
        s.owner_id,
        s.window_days,
        s.delivered_count,
        s.failed_count,
        s.skipped_count,
        s.success_rate,
        s.severity,
        s.created_at
      from public.os_slo_owner_digest_delivery_success_slos s
      where s.created_at>=now()-interval '30 days'
      order by s.owner_id, s.created_at desc
    ) t
    order by t.created_at desc
    limit 40
  ) y;

  select
    count(*) filter (where severity='healthy'),
    count(*) filter (where severity='warning'),
    count(*) filter (where severity='critical'),
    count(*)
  into v_healthy,v_warning,v_critical,v_owners_tracked
  from (
    select distinct on (owner_id) owner_id, severity
    from public.os_slo_owner_digest_delivery_success_slos
    where created_at>=now()-interval '30 days'
    order by owner_id, created_at desc
  ) x;

  select round(
    sum(delivered_count)::numeric / nullif(sum(delivered_count+failed_count),0),4
  ) into v_overall_rate
  from (
    select distinct on (owner_id) owner_id, delivered_count, failed_count
    from public.os_slo_owner_digest_delivery_success_slos
    where created_at>=now()-interval '30 days'
    order by owner_id, created_at desc
  ) x;

  return jsonb_build_object(
    'owners_tracked_30d',v_owners_tracked,
    'owners_healthy_30d',v_healthy,
    'owners_warning_30d',v_warning,
    'owners_critical_30d',v_critical,
    'overall_success_rate_30d',v_overall_rate,
    'recent_owner_slos',v_recent,
    'production_alerts_mutated',false,
    'full_push',false,
    'live_succession_mutated',false,
    'contract_version','phase49-v1'
  );
end $$;

alter table public.os_slo_owner_digest_delivery_success_slos enable row level security;

drop policy if exists "os_slo_owner_digest_succ_select"
  on public.os_slo_owner_digest_delivery_success_slos;
create policy "os_slo_owner_digest_succ_select"
  on public.os_slo_owner_digest_delivery_success_slos for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_slo_owner_digest_delivery_success_slos
  to authenticated, service_role;
revoke insert,update,delete,truncate on
  public.os_slo_owner_digest_delivery_success_slos
  from public,authenticated,service_role;

revoke all on function public.prevent_slo_phase49_append_only()
  from public,anon,authenticated,service_role;
revoke all on function public.scan_slo_owner_digest_delivery_success_phase49(
  uuid,integer
) from public,authenticated;
revoke all on function public.get_slo_phase49_owner_digest_report()
  from public,anon;

grant execute on function public.phase49_slo_safe_detail(jsonb),
  public.get_slo_phase49_owner_digest_report()
  to authenticated, service_role;
grant execute on function public.scan_slo_owner_digest_delivery_success_phase49(
  uuid,integer
) to service_role;
