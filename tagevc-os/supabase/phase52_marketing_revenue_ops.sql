-- Phase 52: firm-wide pending-proposals DIGEST for approvers after Phase 51
-- auto-propose soak — visibility into cohorts waiting on first/second dual
-- approval. Apply after phase51_marketing_revenue_ops.sql. Safe to re-run.
-- Never stores secret values — hashes, counts, statuses, and safe metadata
-- only. Never mutates snapshot retirement tables. NEVER auto-approves
-- money: this file only ever reads pending proposal evidence and records
-- digest snapshots/receipts. It NEVER calls
-- approve_marketing_dry_run_promote_phase50 or any money-correction approve RPC.

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

-- Bootstrap Phase 51 safe-metadata helper if prior Marketing SQL was skipped.
create or replace function public.phase51_marketing_ops_safe_metadata(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select jsonb_typeof(coalesce(p_detail, '{}'::jsonb)) = 'object'
    and pg_column_size(coalesce(p_detail, '{}'::jsonb)) <= 2048
    and not (coalesce(p_detail, '{}'::jsonb) ?| array[
      'authorization','cookie','set-cookie','token','secret','signature','jwt',
      'credential','password','payload','body','value','env_value','url'
    ]);
$$;

create or replace function public.phase52_marketing_ops_safe_metadata(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select public.phase51_marketing_ops_safe_metadata(p_detail);
$$;

-- ---------------------------------------------------------------------------
-- Append-only firm-wide pending-proposals digest snapshots. One row per
-- digest window summarizing cohorts awaiting first vs second dual-approval
-- after Phase 51 auto-propose. NEVER records an approval disposition.
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_phase52_pending_digest_snapshots (
  digest_id uuid primary key default gen_random_uuid(),
  digest_key text not null unique
    check (digest_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  awaiting_first_approval_count integer not null default 0
    check (awaiting_first_approval_count >= 0),
  awaiting_second_approval_count integer not null default 0
    check (awaiting_second_approval_count >= 0),
  total_pending_count integer not null default 0
    check (total_pending_count >= 0),
  oldest_pending_hours numeric,
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (public.phase52_marketing_ops_safe_metadata(metadata)),
  check (coalesce((metadata->>'never_auto_approves_money')::boolean,true) = true),
  check (coalesce((metadata->>'never_auto_approves')::boolean,true) = true)
);

create index if not exists os_mkt_rev_p52_digest_created_idx
  on public.os_marketing_revenue_phase52_pending_digest_snapshots(created_at desc);

alter table public.os_marketing_revenue_phase52_pending_digest_snapshots
  enable row level security;
drop policy if exists "os_mkt_rev_p52_digest_select"
  on public.os_marketing_revenue_phase52_pending_digest_snapshots;
create policy "os_mkt_rev_p52_digest_select"
  on public.os_marketing_revenue_phase52_pending_digest_snapshots for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_marketing_revenue_phase52_pending_digest_snapshots
  from public, anon, authenticated;
grant select on public.os_marketing_revenue_phase52_pending_digest_snapshots
  to authenticated;

-- ---------------------------------------------------------------------------
-- Phase 52 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_phase52_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  digest_id uuid,
  alert_kind text not null,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null default 'warning' check (severity in ('warning','critical')),
  destination_key text not null check (destination_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  delivery_status text not null check (delivery_status in
    ('delivered','skipped_no_webhook','failed','recorded')),
  response_code integer check (response_code is null or response_code between 100 and 599),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_mkt_rev_p52_alert_kind_check
    check (alert_kind in (
      'pending_proposals_digest_recorded',
      'pending_proposals_backlog_critical'
    )),
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (public.phase52_marketing_ops_safe_metadata(metadata))
);

create index if not exists os_mkt_rev_p52_alert_created_idx
  on public.os_marketing_revenue_phase52_ops_alerts(created_at desc);
create index if not exists os_mkt_rev_p52_alert_kind_idx
  on public.os_marketing_revenue_phase52_ops_alerts(alert_kind, created_at desc);

alter table public.os_marketing_revenue_phase52_ops_alerts
  enable row level security;
drop policy if exists "os_mkt_rev_p52_alert_select"
  on public.os_marketing_revenue_phase52_ops_alerts;
create policy "os_mkt_rev_p52_alert_select"
  on public.os_marketing_revenue_phase52_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_marketing_revenue_phase52_ops_alerts
  from public, anon, authenticated;
grant select on public.os_marketing_revenue_phase52_ops_alerts
  to authenticated;

create or replace function public.reject_marketing_phase52_ops_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Marketing revenue Phase 52 ops evidence is append-only';
end;
$$;

drop trigger if exists os_mkt_rev_p52_digest_immutable
  on public.os_marketing_revenue_phase52_pending_digest_snapshots;
create trigger os_mkt_rev_p52_digest_immutable
  before update or delete on public.os_marketing_revenue_phase52_pending_digest_snapshots
  for each row execute function public.reject_marketing_phase52_ops_mutation();
drop trigger if exists os_mkt_rev_p52_digest_no_truncate
  on public.os_marketing_revenue_phase52_pending_digest_snapshots;
create trigger os_mkt_rev_p52_digest_no_truncate
  before truncate on public.os_marketing_revenue_phase52_pending_digest_snapshots
  for each statement execute function public.reject_marketing_phase52_ops_mutation();

drop trigger if exists os_mkt_rev_p52_alert_immutable
  on public.os_marketing_revenue_phase52_ops_alerts;
create trigger os_mkt_rev_p52_alert_immutable
  before update or delete on public.os_marketing_revenue_phase52_ops_alerts
  for each row execute function public.reject_marketing_phase52_ops_mutation();
drop trigger if exists os_mkt_rev_p52_alert_no_truncate
  on public.os_marketing_revenue_phase52_ops_alerts;
create trigger os_mkt_rev_p52_alert_no_truncate
  before truncate on public.os_marketing_revenue_phase52_ops_alerts
  for each statement execute function public.reject_marketing_phase52_ops_mutation();

-- ---------------------------------------------------------------------------
-- List cohorts awaiting first or second dual-approval (read-only). Awaiting
-- first = pending with 0 distinct approvers; awaiting second = pending with
-- exactly 1 distinct approver. NEVER approves money.
-- ---------------------------------------------------------------------------
create or replace function public.list_marketing_pending_proposals_phase52(
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_items jsonb;
  v_first integer := 0;
  v_second integer := 0;
begin
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at asc), '[]'::jsonb)
  into v_items
  from (
    select p.proposal_id, p.cohort_id, p.status, p.created_at,
      coalesce(count(distinct a.actor_id) filter (where a.decision='approve'),0)
        as distinct_approvers,
      case
        when coalesce(count(distinct a.actor_id) filter (where a.decision='approve'),0) = 0
          then 'awaiting_first_approval'
        when coalesce(count(distinct a.actor_id) filter (where a.decision='approve'),0) = 1
          then 'awaiting_second_approval'
        else 'other'
      end as approval_stage
    from public.os_marketing_revenue_dry_run_promotion_proposals p
    left join public.os_marketing_revenue_dry_run_promotion_approvals a
      on a.proposal_id = p.proposal_id
    where p.status = 'pending'
    group by p.proposal_id, p.cohort_id, p.status, p.created_at
    having coalesce(count(distinct a.actor_id) filter (where a.decision='approve'),0) < 2
    order by p.created_at asc
    limit v_limit
  ) x;

  select
    count(*) filter (where (item->>'approval_stage') = 'awaiting_first_approval'),
    count(*) filter (where (item->>'approval_stage') = 'awaiting_second_approval')
  into v_first, v_second
  from jsonb_array_elements(coalesce(v_items,'[]'::jsonb)) item;

  return jsonb_build_object(
    'version','phase52-v1',
    'awaiting_first_approval_count',coalesce(v_first,0),
    'awaiting_second_approval_count',coalesce(v_second,0),
    'total_pending_count',coalesce(v_first,0)+coalesce(v_second,0),
    'items',coalesce(v_items,'[]'::jsonb),
    'never_auto_approves_money',true,
    'never_auto_approves',true
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record a firm-wide pending-proposals digest snapshot (idempotent per hour).
-- Read + append-only. NEVER auto-approves money.
-- ---------------------------------------------------------------------------
create or replace function public.record_marketing_pending_proposals_digest_phase52(
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_list jsonb;
  v_first integer;
  v_second integer;
  v_total integer;
  v_oldest_hours numeric;
  v_key text;
  v_hash text;
  v_row public.os_marketing_revenue_phase52_pending_digest_snapshots%rowtype;
begin
  if not public.phase52_marketing_ops_safe_metadata(v_meta) then
    raise exception 'Phase 52 pending digest metadata is invalid or unsafe';
  end if;

  v_list := public.list_marketing_pending_proposals_phase52(200);
  v_first := coalesce((v_list->>'awaiting_first_approval_count')::integer,0);
  v_second := coalesce((v_list->>'awaiting_second_approval_count')::integer,0);
  v_total := coalesce((v_list->>'total_pending_count')::integer,0);

  select extract(epoch from (now()-min((item->>'created_at')::timestamptz)))/3600.0
  into v_oldest_hours
  from jsonb_array_elements(coalesce(v_list->'items','[]'::jsonb)) item;

  v_key := left(
    'pendingdigest52:firm:' || to_char(now(),'YYYYMMDD"T"HH24'),
    200);
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase52-v1',
    'awaiting_first_approval_count',v_first,
    'awaiting_second_approval_count',v_second,
    'total_pending_count',v_total,
    'oldest_pending_hours',v_oldest_hours
  )::text);

  insert into public.os_marketing_revenue_phase52_pending_digest_snapshots(
    digest_key,awaiting_first_approval_count,awaiting_second_approval_count,
    total_pending_count,oldest_pending_hours,metrics_sha256,metadata)
  values (
    v_key,v_first,v_second,v_total,v_oldest_hours,v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase52-v1',
      'never_auto_approves_money',true,
      'never_auto_approves',true))
  on conflict (digest_key) do nothing
  returning * into v_row;

  if v_row.digest_id is null then
    select * into v_row
    from public.os_marketing_revenue_phase52_pending_digest_snapshots
    where digest_key = v_key;
    return jsonb_build_object(
      'version','phase52-v1',
      'disposition','unchanged',
      'digest_id',v_row.digest_id,
      'total_pending_count',v_row.total_pending_count,
      'never_auto_approves_money',true,
      'never_auto_approves',true);
  end if;

  return jsonb_build_object(
    'version','phase52-v1',
    'disposition','recorded',
    'digest_id',v_row.digest_id,
    'awaiting_first_approval_count',v_row.awaiting_first_approval_count,
    'awaiting_second_approval_count',v_row.awaiting_second_approval_count,
    'total_pending_count',v_row.total_pending_count,
    'oldest_pending_hours',v_row.oldest_pending_hours,
    'metrics_sha256',v_row.metrics_sha256,
    'never_auto_approves_money',true,
    'never_auto_approves',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- List critical windows that still need an idempotent ops alert insert
-- ---------------------------------------------------------------------------
create or replace function public.list_marketing_revenue_phase52_critical_windows(
  p_window_hours integer default 24,
  p_backlog_threshold integer default 5
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_hours integer := least(greatest(coalesce(p_window_hours, 24), 1), 168);
  v_threshold integer := least(greatest(coalesce(p_backlog_threshold, 5), 1), 500);
  v_bucket text;
  v_pending jsonb := '[]'::jsonb;
  v_digest public.os_marketing_revenue_phase52_pending_digest_snapshots%rowtype;
  v_key text;
begin
  v_bucket := to_char(
    to_timestamp(
      (floor(extract(epoch from now()) / (v_hours * 3600.0))
        * (v_hours * 3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  select * into v_digest
  from public.os_marketing_revenue_phase52_pending_digest_snapshots
  where created_at >= now() - make_interval(hours => v_hours)
  order by created_at desc
  limit 1;

  if v_digest.digest_id is not null then
    v_key := 'pendingdigest52recorded:' || v_digest.digest_id::text;
    if not exists (
      select 1 from public.os_marketing_revenue_phase52_ops_alerts a
      where a.window_key = v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','pending_proposals_digest_recorded',
        'digest_id',v_digest.digest_id,
        'window_key',v_key,
        'severity','warning',
        'total_pending_count',v_digest.total_pending_count,
        'metrics_sha256',v_digest.metrics_sha256
      ));
    end if;

    if v_digest.total_pending_count >= v_threshold then
      v_key := 'pendingdigest52backlog:' || v_bucket || 'h' || v_hours::text;
      if not exists (
        select 1 from public.os_marketing_revenue_phase52_ops_alerts a
        where a.window_key = v_key
      ) then
        v_pending := v_pending || jsonb_build_array(jsonb_build_object(
          'alert_kind','pending_proposals_backlog_critical',
          'digest_id',v_digest.digest_id,
          'window_key',v_key,
          'severity','critical',
          'total_pending_count',v_digest.total_pending_count,
          'metrics_sha256',v_digest.metrics_sha256
        ));
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'version','phase52-v1',
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'backlog_threshold',v_threshold,
    'pending',v_pending
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record one critical ops alert after delivery attempt (idempotent window_key)
-- ---------------------------------------------------------------------------
create or replace function public.record_marketing_revenue_phase52_ops_alert(
  p_alert jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_kind text;
  v_window text;
  v_digest uuid;
  v_dest text;
  v_delivery text;
  v_code integer;
  v_severity text;
  v_hash text;
  v_meta jsonb;
  v_id uuid;
  v_status text;
begin
  if jsonb_typeof(coalesce(p_alert,'{}'::jsonb)) <> 'object' then
    raise exception 'Phase 52 ops alert payload must be a JSON object';
  end if;

  v_kind := coalesce(p_alert->>'alert_kind','');
  v_window := coalesce(p_alert->>'window_key','');
  v_digest := nullif(p_alert->>'digest_id','')::uuid;
  v_dest := coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery := coalesce(p_alert->>'delivery_status','recorded');
  v_code := nullif(p_alert->>'response_code','')::integer;
  v_severity := coalesce(nullif(p_alert->>'severity',''),'warning');
  v_meta := coalesce(p_alert->'metadata','{}'::jsonb);

  if v_kind not in ('pending_proposals_digest_recorded','pending_proposals_backlog_critical')
     or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
     or v_dest ~* '://|^https?'
     or v_severity not in ('warning','critical')
     or v_delivery not in
       ('delivered','skipped_no_webhook','failed','recorded')
     or not public.phase52_marketing_ops_safe_metadata(v_meta) then
    raise exception 'Phase 52 ops alert contract is invalid or unsafe';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase52-v1',
    'alert_kind',v_kind,
    'digest_id',v_digest,
    'window_key',v_window,
    'severity',v_severity,
    'destination_key',v_dest,
    'delivery_status',v_delivery,
    'response_code',v_code
  )::text);

  insert into public.os_marketing_revenue_phase52_ops_alerts(
    digest_id,alert_kind,window_key,severity,destination_key,
    delivery_status,response_code,metrics_sha256,metadata)
  values (
    v_digest,v_kind,v_window,v_severity,v_dest,
    v_delivery,v_code,v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase52-v1',
      'never_auto_approves_money',true,
      'never_auto_approves',true))
  on conflict (window_key) do nothing
  returning alert_id, delivery_status into v_id, v_status;

  if v_id is null then
    select alert_id, delivery_status into v_id, v_status
    from public.os_marketing_revenue_phase52_ops_alerts
    where window_key = v_window;
    return jsonb_build_object(
      'version','phase52-v1',
      'alert_id',v_id,
      'window_key',v_window,
      'delivery_status',v_status,
      'inserted',false);
  end if;

  return jsonb_build_object(
    'version','phase52-v1',
    'alert_id',v_id,
    'window_key',v_window,
    'delivery_status',v_status,
    'inserted',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Hub report: pending-proposals digest + cohorts awaiting dual-approve
-- ---------------------------------------------------------------------------
create or replace function public.get_marketing_revenue_phase52_ops_report(
  p_days integer default 30
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 90);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_list jsonb;
  v_digests jsonb;
  v_alerts jsonb;
  v_digest_count integer := 0;
begin
  v_list := public.list_marketing_pending_proposals_phase52(50);

  select count(*) into v_digest_count
  from public.os_marketing_revenue_phase52_pending_digest_snapshots
  where created_at >= v_since;

  select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at desc), '[]'::jsonb)
  into v_digests
  from (
    select digest_id, awaiting_first_approval_count, awaiting_second_approval_count,
      total_pending_count, oldest_pending_hours, metrics_sha256, created_at
    from public.os_marketing_revenue_phase52_pending_digest_snapshots
    where created_at >= v_since
    order by created_at desc
    limit 50
  ) d;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
  into v_alerts
  from (
    select alert_id, digest_id, alert_kind, window_key,
      severity, destination_key, delivery_status, response_code,
      metrics_sha256, created_at
    from public.os_marketing_revenue_phase52_ops_alerts
    order by created_at desc
    limit 20
  ) a;

  return jsonb_build_object(
    'version','phase52-v1',
    'window_days',v_days,
    'awaiting_first_approval_count',coalesce((v_list->>'awaiting_first_approval_count')::integer,0),
    'awaiting_second_approval_count',coalesce((v_list->>'awaiting_second_approval_count')::integer,0),
    'total_pending_count',coalesce((v_list->>'total_pending_count')::integer,0),
    'pending_items',coalesce(v_list->'items','[]'::jsonb),
    'digest_snapshot_count',v_digest_count,
    'recent_digests',coalesce(v_digests,'[]'::jsonb),
    'alerts',coalesce(v_alerts,'[]'::jsonb),
    'destination_key','ops_alerts',
    'never_auto_approves_money',true,
    'never_auto_approves',true
  );
end;
$$;

revoke all on function public.phase52_marketing_ops_safe_metadata(jsonb)
  from public, anon, authenticated;
revoke all on function public.list_marketing_pending_proposals_phase52(integer)
  from public, anon, authenticated;
revoke all on function public.record_marketing_pending_proposals_digest_phase52(jsonb)
  from public, anon, authenticated;
revoke all on function public.list_marketing_revenue_phase52_critical_windows(integer,integer)
  from public, anon, authenticated;
revoke all on function public.record_marketing_revenue_phase52_ops_alert(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_marketing_revenue_phase52_ops_report(integer)
  from public, anon, authenticated;

grant execute on function public.phase52_marketing_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.list_marketing_pending_proposals_phase52(integer)
  to authenticated, service_role;
grant execute on function public.list_marketing_revenue_phase52_critical_windows(integer,integer)
  to authenticated, service_role;
grant execute on function public.get_marketing_revenue_phase52_ops_report(integer)
  to authenticated, service_role;

grant execute on function public.record_marketing_pending_proposals_digest_phase52(jsonb)
  to service_role;
grant execute on function public.record_marketing_revenue_phase52_ops_alert(jsonb)
  to service_role;
grant execute on function public.os_sha256_hex(text)
  to authenticated, service_role;
