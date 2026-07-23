-- Phase 51: auto-PROPOSE (NEVER auto-approve) dual-approve promotions for
-- cohorts that have soaked healthy for N consecutive Phase 50 cohort
-- readiness snapshots ("audit-export windows"), plus richer cohort
-- readiness + proposal status visibility. Apply after
-- phase50_marketing_revenue_ops.sql. Safe to re-run.
-- Never stores secret values — hashes, counts, statuses, and safe metadata
-- only. Never mutates snapshot retirement tables. NEVER auto-approves
-- money: this file only ever calls propose_marketing_dry_run_promote_phase50
-- (which creates a status='pending' proposal awaiting 2 DISTINCT human
-- approvers). It NEVER calls approve_marketing_dry_run_promote_phase50 or
-- any money-correction approve RPC.

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

-- Bootstrap Phase 50 safe-metadata helper if prior Marketing SQL was skipped.
create or replace function public.phase50_marketing_ops_safe_metadata(p_detail jsonb)
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

create or replace function public.phase51_marketing_ops_safe_metadata(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select public.phase50_marketing_ops_safe_metadata(p_detail);
$$;

-- ---------------------------------------------------------------------------
-- Append-only auto-propose scan runs. One row per (cohort, day) scan
-- outcome. This table NEVER records an "applied"/"approved" disposition —
-- the only dispositions here reflect whether a NEW pending proposal was
-- created via the existing Phase 50 propose RPC, or why one was not.
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_phase51_auto_propose_runs (
  run_id uuid primary key default gen_random_uuid(),
  run_key text not null unique
    check (run_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  cohort_id uuid not null
    references public.os_marketing_revenue_promotion_cohorts(cohort_id),
  consecutive_ready_snapshots integer not null default 0
    check (consecutive_ready_snapshots >= 0),
  windows_required integer not null default 0
    check (windows_required >= 0),
  disposition text not null check (disposition in (
    'proposed','skipped_not_ready','skipped_already_pending',
    'skipped_insufficient_streak','skipped_no_dry_run','error'
  )),
  proposal_id uuid,
  block_reason text,
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (public.phase51_marketing_ops_safe_metadata(metadata)),
  -- Never auto-approves money: this row can only ever describe a PROPOSE
  -- outcome (or a skip/error), never an approval or promotion outcome.
  check (coalesce((metadata->>'never_auto_approves_money')::boolean,true) = true),
  check (coalesce((metadata->>'never_auto_approves')::boolean,true) = true)
);

create index if not exists os_mkt_rev_p51_autoprop_created_idx
  on public.os_marketing_revenue_phase51_auto_propose_runs(created_at desc);
create index if not exists os_mkt_rev_p51_autoprop_cohort_idx
  on public.os_marketing_revenue_phase51_auto_propose_runs(cohort_id, created_at desc);
create index if not exists os_mkt_rev_p51_autoprop_disposition_idx
  on public.os_marketing_revenue_phase51_auto_propose_runs(disposition, created_at desc);

alter table public.os_marketing_revenue_phase51_auto_propose_runs
  enable row level security;
drop policy if exists "os_mkt_rev_p51_autoprop_select"
  on public.os_marketing_revenue_phase51_auto_propose_runs;
create policy "os_mkt_rev_p51_autoprop_select"
  on public.os_marketing_revenue_phase51_auto_propose_runs for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_marketing_revenue_phase51_auto_propose_runs
  from public, anon, authenticated;
grant select on public.os_marketing_revenue_phase51_auto_propose_runs
  to authenticated;

-- ---------------------------------------------------------------------------
-- Phase 51 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_phase51_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  cohort_id uuid,
  run_id uuid,
  proposal_id uuid,
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
  constraint os_mkt_rev_p51_alert_kind_check
    check (alert_kind in (
      'auto_propose_created',
      'auto_propose_error'
    )),
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (public.phase51_marketing_ops_safe_metadata(metadata))
);

create index if not exists os_mkt_rev_p51_alert_created_idx
  on public.os_marketing_revenue_phase51_ops_alerts(created_at desc);
create index if not exists os_mkt_rev_p51_alert_kind_idx
  on public.os_marketing_revenue_phase51_ops_alerts(alert_kind, created_at desc);

alter table public.os_marketing_revenue_phase51_ops_alerts
  enable row level security;
drop policy if exists "os_mkt_rev_p51_alert_select"
  on public.os_marketing_revenue_phase51_ops_alerts;
create policy "os_mkt_rev_p51_alert_select"
  on public.os_marketing_revenue_phase51_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_marketing_revenue_phase51_ops_alerts
  from public, anon, authenticated;
grant select on public.os_marketing_revenue_phase51_ops_alerts
  to authenticated;

create or replace function public.reject_marketing_phase51_ops_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Marketing revenue Phase 51 ops evidence is append-only';
end;
$$;

drop trigger if exists os_mkt_rev_p51_autoprop_immutable
  on public.os_marketing_revenue_phase51_auto_propose_runs;
create trigger os_mkt_rev_p51_autoprop_immutable
  before update or delete on public.os_marketing_revenue_phase51_auto_propose_runs
  for each row execute function public.reject_marketing_phase51_ops_mutation();
drop trigger if exists os_mkt_rev_p51_autoprop_no_truncate
  on public.os_marketing_revenue_phase51_auto_propose_runs;
create trigger os_mkt_rev_p51_autoprop_no_truncate
  before truncate on public.os_marketing_revenue_phase51_auto_propose_runs
  for each statement execute function public.reject_marketing_phase51_ops_mutation();

drop trigger if exists os_mkt_rev_p51_alert_immutable
  on public.os_marketing_revenue_phase51_ops_alerts;
create trigger os_mkt_rev_p51_alert_immutable
  before update or delete on public.os_marketing_revenue_phase51_ops_alerts
  for each row execute function public.reject_marketing_phase51_ops_mutation();
drop trigger if exists os_mkt_rev_p51_alert_no_truncate
  on public.os_marketing_revenue_phase51_ops_alerts;
create trigger os_mkt_rev_p51_alert_no_truncate
  before truncate on public.os_marketing_revenue_phase51_ops_alerts
  for each statement execute function public.reject_marketing_phase51_ops_mutation();

-- ---------------------------------------------------------------------------
-- Auto-PROPOSE (NEVER auto-approve) a dual-approve promotion for any active
-- cohort that has soaked healthy ('ready') for at least p_windows_required
-- consecutive Phase 50 cohort readiness snapshots. This function ONLY ever
-- calls the EXISTING Phase 50 propose_marketing_dry_run_promote_phase50 RPC
-- (which creates a status='pending' proposal). It NEVER calls
-- approve_marketing_dry_run_promote_phase50 or any promote/correction-approve
-- RPC — two distinct humans must still review and approve every promotion.
-- ---------------------------------------------------------------------------
create or replace function public.auto_propose_marketing_dry_run_promote_phase51(
  p_actor_id uuid,
  p_windows_required integer default 3
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_windows_required integer := least(greatest(coalesce(p_windows_required, 3), 1), 12);
  v_cohort record;
  v_streak integer;
  v_row public.os_marketing_revenue_cohort_readiness_snapshots%rowtype;
  v_dry_run public.os_marketing_revenue_autopilot_dry_run_snapshots%rowtype;
  v_pending_exists boolean;
  v_key text;
  v_hash text;
  v_propose_result jsonb;
  v_disposition text;
  v_proposal_id uuid;
  v_block_reason text;
  v_scanned integer := 0;
  v_proposed integer := 0;
  v_skipped integer := 0;
  v_errored integer := 0;
begin
  if p_actor_id is null then
    raise exception 'Phase 51 auto-propose requires an actor_id';
  end if;

  for v_cohort in
    select cohort_id from public.os_marketing_revenue_promotion_cohorts
    where status = 'active'
    order by created_at desc
    limit 50
  loop
    v_scanned := v_scanned + 1;
    v_key := left(
      'autopropose51:' || v_cohort.cohort_id::text || ':' ||
        to_char(now(),'YYYYMMDD'),
      200);

    -- Idempotent per cohort per day — never scans/proposes twice in one day.
    if exists (
      select 1 from public.os_marketing_revenue_phase51_auto_propose_runs r
      where r.run_key = v_key
    ) then
      continue;
    end if;

    -- Consecutive 'ready' streak over the most recent readiness snapshots.
    v_streak := 0;
    for v_row in
      select * from public.os_marketing_revenue_cohort_readiness_snapshots
      where cohort_id = v_cohort.cohort_id
      order by created_at desc
      limit v_windows_required
    loop
      if v_row.readiness_status = 'ready' then
        v_streak := v_streak + 1;
      else
        exit;
      end if;
    end loop;

    if v_streak < v_windows_required then
      insert into public.os_marketing_revenue_phase51_auto_propose_runs(
        run_key,cohort_id,consecutive_ready_snapshots,windows_required,
        disposition,metrics_sha256,metadata)
      values (
        v_key,v_cohort.cohort_id,v_streak,v_windows_required,
        'skipped_insufficient_streak',
        public.os_sha256_hex('insufficient:' || v_key),
        jsonb_build_object(
          'contract_version','phase51-v1',
          'never_auto_approves_money',true,
          'never_auto_approves',true))
      on conflict (run_key) do nothing;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select exists (
      select 1 from public.os_marketing_revenue_dry_run_promotion_proposals p
      where p.cohort_id = v_cohort.cohort_id and p.status = 'pending'
    ) into v_pending_exists;

    if v_pending_exists then
      insert into public.os_marketing_revenue_phase51_auto_propose_runs(
        run_key,cohort_id,consecutive_ready_snapshots,windows_required,
        disposition,metrics_sha256,metadata)
      values (
        v_key,v_cohort.cohort_id,v_streak,v_windows_required,
        'skipped_already_pending',
        public.os_sha256_hex('pending:' || v_key),
        jsonb_build_object(
          'contract_version','phase51-v1',
          'never_auto_approves_money',true,
          'never_auto_approves',true))
      on conflict (run_key) do nothing;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select * into v_dry_run
    from public.os_marketing_revenue_autopilot_dry_run_snapshots
    where cohort_id = v_cohort.cohort_id
    order by created_at desc
    limit 1;

    if v_dry_run.dry_run_id is null or v_dry_run.predicted_status <> 'would_promote' then
      insert into public.os_marketing_revenue_phase51_auto_propose_runs(
        run_key,cohort_id,consecutive_ready_snapshots,windows_required,
        disposition,metrics_sha256,metadata)
      values (
        v_key,v_cohort.cohort_id,v_streak,v_windows_required,
        'skipped_no_dry_run',
        public.os_sha256_hex('nodry:' || v_key),
        jsonb_build_object(
          'contract_version','phase51-v1',
          'never_auto_approves_money',true,
          'never_auto_approves',true))
      on conflict (run_key) do nothing;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- ONLY path this function may take that creates evidence beyond a scan
    -- log: PROPOSE (never approve) via the EXISTING Phase 50 propose RPC.
    begin
      v_propose_result := public.propose_marketing_dry_run_promote_phase50(
        jsonb_build_object(
          'dry_run_id', v_dry_run.dry_run_id,
          'proposed_by', p_actor_id,
          'metadata', jsonb_build_object(
            'contract_version','phase51-v1',
            'source','auto_propose_marketing_dry_run_promote_phase51',
            'never_auto_approves_money',true,
            'consecutive_ready_snapshots',v_streak
          )
        )
      );
      v_block_reason := null;
    exception when others then
      v_block_reason := sqlerrm;
      v_propose_result := null;
    end;

    if v_propose_result is null then
      insert into public.os_marketing_revenue_phase51_auto_propose_runs(
        run_key,cohort_id,consecutive_ready_snapshots,windows_required,
        disposition,block_reason,metrics_sha256,metadata)
      values (
        v_key,v_cohort.cohort_id,v_streak,v_windows_required,
        'error',left(coalesce(v_block_reason,'propose_failed'),500),
        public.os_sha256_hex('error:' || v_key),
        jsonb_build_object(
          'contract_version','phase51-v1',
          'never_auto_approves_money',true,
          'never_auto_approves',true))
      on conflict (run_key) do nothing;
      v_errored := v_errored + 1;
      continue;
    end if;

    v_disposition := coalesce(v_propose_result->>'disposition','proposed');
    v_proposal_id := nullif(v_propose_result->>'proposal_id','')::uuid;
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'contract_version','phase51-v1',
      'cohort_id',v_cohort.cohort_id,
      'proposal_id',v_proposal_id,
      'consecutive_ready_snapshots',v_streak
    )::text);

    insert into public.os_marketing_revenue_phase51_auto_propose_runs(
      run_key,cohort_id,consecutive_ready_snapshots,windows_required,
      disposition,proposal_id,metrics_sha256,metadata)
    values (
      v_key,v_cohort.cohort_id,v_streak,v_windows_required,
      'proposed',v_proposal_id,v_hash,
      jsonb_build_object(
        'contract_version','phase51-v1',
        'never_auto_approves_money',true,
        'never_auto_approves',true,
        'source_disposition',v_disposition))
    on conflict (run_key) do nothing;
    v_proposed := v_proposed + 1;
  end loop;

  return jsonb_build_object(
    'version','phase51-v1',
    'cohorts_scanned',v_scanned,
    'proposals_created',v_proposed,
    'skipped',v_skipped,
    'errored',v_errored,
    'windows_required',v_windows_required,
    'never_auto_approves_money',true,
    'never_auto_approves',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- List critical windows that still need an idempotent ops alert insert
-- ---------------------------------------------------------------------------
create or replace function public.list_marketing_revenue_phase51_critical_windows(
  p_window_hours integer default 24
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_hours integer := least(greatest(coalesce(p_window_hours, 24), 1), 168);
  v_bucket text;
  v_pending jsonb := '[]'::jsonb;
  v_run public.os_marketing_revenue_phase51_auto_propose_runs%rowtype;
  v_key text;
begin
  v_bucket := to_char(
    to_timestamp(
      (floor(extract(epoch from now()) / (v_hours * 3600.0))
        * (v_hours * 3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  for v_run in
    select * from public.os_marketing_revenue_phase51_auto_propose_runs
    where disposition = 'proposed'
      and created_at >= now() - make_interval(hours => v_hours)
    order by created_at desc
    limit 25
  loop
    v_key := 'autopropose51created:' || v_run.run_id::text;
    if not exists (
      select 1 from public.os_marketing_revenue_phase51_ops_alerts a
      where a.window_key = v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','auto_propose_created',
        'cohort_id',v_run.cohort_id,
        'run_id',v_run.run_id,
        'proposal_id',v_run.proposal_id,
        'window_key',v_key,
        'severity','warning',
        'metrics_sha256',v_run.metrics_sha256
      ));
    end if;
  end loop;

  for v_run in
    select * from public.os_marketing_revenue_phase51_auto_propose_runs
    where disposition = 'error'
      and created_at >= now() - make_interval(hours => v_hours)
    order by created_at desc
    limit 25
  loop
    v_key := 'autoproposeerror51:' || v_run.run_id::text;
    if not exists (
      select 1 from public.os_marketing_revenue_phase51_ops_alerts a
      where a.window_key = v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','auto_propose_error',
        'cohort_id',v_run.cohort_id,
        'run_id',v_run.run_id,
        'proposal_id',null,
        'window_key',v_key,
        'severity','critical',
        'metrics_sha256',v_run.metrics_sha256
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'version','phase51-v1',
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',v_pending
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record one critical ops alert after delivery attempt (idempotent window_key)
-- ---------------------------------------------------------------------------
create or replace function public.record_marketing_revenue_phase51_ops_alert(
  p_alert jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_kind text;
  v_window text;
  v_cohort uuid;
  v_run uuid;
  v_proposal uuid;
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
    raise exception 'Phase 51 ops alert payload must be a JSON object';
  end if;

  v_kind := coalesce(p_alert->>'alert_kind','');
  v_window := coalesce(p_alert->>'window_key','');
  v_cohort := nullif(p_alert->>'cohort_id','')::uuid;
  v_run := nullif(p_alert->>'run_id','')::uuid;
  v_proposal := nullif(p_alert->>'proposal_id','')::uuid;
  v_dest := coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery := coalesce(p_alert->>'delivery_status','recorded');
  v_code := nullif(p_alert->>'response_code','')::integer;
  v_severity := coalesce(nullif(p_alert->>'severity',''),'warning');
  v_meta := coalesce(p_alert->'metadata','{}'::jsonb);

  if v_kind not in ('auto_propose_created','auto_propose_error')
     or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
     or v_dest ~* '://|^https?'
     or v_severity not in ('warning','critical')
     or v_delivery not in
       ('delivered','skipped_no_webhook','failed','recorded')
     or not public.phase51_marketing_ops_safe_metadata(v_meta) then
    raise exception 'Phase 51 ops alert contract is invalid or unsafe';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase51-v1',
    'alert_kind',v_kind,
    'cohort_id',v_cohort,
    'run_id',v_run,
    'proposal_id',v_proposal,
    'window_key',v_window,
    'severity',v_severity,
    'destination_key',v_dest,
    'delivery_status',v_delivery,
    'response_code',v_code
  )::text);

  insert into public.os_marketing_revenue_phase51_ops_alerts(
    cohort_id,run_id,proposal_id,alert_kind,window_key,severity,destination_key,
    delivery_status,response_code,metrics_sha256,metadata)
  values (
    v_cohort,v_run,v_proposal,v_kind,v_window,v_severity,v_dest,
    v_delivery,v_code,v_hash,
    v_meta || jsonb_build_object('contract_version','phase51-v1'))
  on conflict (window_key) do nothing
  returning alert_id, delivery_status into v_id, v_status;

  if v_id is null then
    select alert_id, delivery_status into v_id, v_status
    from public.os_marketing_revenue_phase51_ops_alerts
    where window_key = v_window;
    return jsonb_build_object(
      'version','phase51-v1',
      'alert_id',v_id,
      'window_key',v_window,
      'delivery_status',v_status,
      'inserted',false);
  end if;

  return jsonb_build_object(
    'version','phase51-v1',
    'alert_id',v_id,
    'window_key',v_window,
    'delivery_status',v_status,
    'inserted',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Hub report: auto-propose visibility + Phase 50 cohort readiness/proposal
-- status visibility joined together, plus Phase 51 alerts.
-- ---------------------------------------------------------------------------
create or replace function public.get_marketing_revenue_phase51_ops_report(
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
  v_proposed_count integer := 0;
  v_skipped_count integer := 0;
  v_errored_count integer := 0;
  v_runs jsonb;
  v_cohort_status jsonb;
  v_alerts jsonb;
begin
  select
    count(*) filter (where disposition = 'proposed'),
    count(*) filter (where disposition like 'skipped%'),
    count(*) filter (where disposition = 'error')
  into v_proposed_count, v_skipped_count, v_errored_count
  from public.os_marketing_revenue_phase51_auto_propose_runs
  where created_at >= v_since;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb)
  into v_runs
  from (
    select run_id, cohort_id, consecutive_ready_snapshots, windows_required,
      disposition, proposal_id, block_reason, metrics_sha256, created_at
    from public.os_marketing_revenue_phase51_auto_propose_runs
    where created_at >= v_since
    order by created_at desc
    limit 50
  ) r;

  -- Cohort readiness + latest proposal status joined together for a single
  -- visibility surface (Phase 51 improves on the Phase 50 split view).
  select coalesce(jsonb_agg(to_jsonb(c) order by c.readiness_created_at desc), '[]'::jsonb)
  into v_cohort_status
  from (
    select distinct on (r.cohort_id)
      r.cohort_id,
      r.readiness_status,
      r.consecutive_healthy_windows,
      r.windows_required,
      r.readiness_created_at,
      p.proposal_id as latest_proposal_id,
      p.status as latest_proposal_status,
      p.created_at as latest_proposal_created_at
    from (
      select cohort_id, readiness_status, consecutive_healthy_windows,
        windows_required, created_at as readiness_created_at
      from public.os_marketing_revenue_cohort_readiness_snapshots
      where created_at >= v_since
    ) r
    left join lateral (
      select proposal_id, status, created_at
      from public.os_marketing_revenue_dry_run_promotion_proposals p2
      where p2.cohort_id = r.cohort_id
      order by p2.created_at desc
      limit 1
    ) p on true
    order by r.cohort_id, r.readiness_created_at desc
    limit 50
  ) c;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
  into v_alerts
  from (
    select alert_id, cohort_id, run_id, proposal_id, alert_kind, window_key,
      severity, destination_key, delivery_status, response_code,
      metrics_sha256, created_at
    from public.os_marketing_revenue_phase51_ops_alerts
    order by created_at desc
    limit 20
  ) a;

  return jsonb_build_object(
    'version','phase51-v1',
    'window_days',v_days,
    'auto_propose_created_count',v_proposed_count,
    'auto_propose_skipped_count',v_skipped_count,
    'auto_propose_errored_count',v_errored_count,
    'auto_propose_runs',coalesce(v_runs,'[]'::jsonb),
    'cohort_status',coalesce(v_cohort_status,'[]'::jsonb),
    'alerts',coalesce(v_alerts,'[]'::jsonb),
    'destination_key','ops_alerts',
    'never_auto_approves_money',true,
    'never_auto_approves',true
  );
end;
$$;

revoke all on function public.phase51_marketing_ops_safe_metadata(jsonb)
  from public, anon, authenticated;
revoke all on function public.auto_propose_marketing_dry_run_promote_phase51(uuid,integer)
  from public, anon, authenticated;
revoke all on function public.list_marketing_revenue_phase51_critical_windows(integer)
  from public, anon, authenticated;
revoke all on function public.record_marketing_revenue_phase51_ops_alert(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_marketing_revenue_phase51_ops_report(integer)
  from public, anon, authenticated;

grant execute on function public.phase51_marketing_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.list_marketing_revenue_phase51_critical_windows(integer)
  to authenticated, service_role;
grant execute on function public.get_marketing_revenue_phase51_ops_report(integer)
  to authenticated, service_role;

grant execute on function public.auto_propose_marketing_dry_run_promote_phase51(uuid,integer)
  to service_role;
grant execute on function public.record_marketing_revenue_phase51_ops_alert(jsonb)
  to service_role;
grant execute on function public.os_sha256_hex(text)
  to authenticated, service_role;
