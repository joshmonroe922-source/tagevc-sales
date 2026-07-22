-- Phase 50: page/alert visibility on protected_branch_cutover_blocked events,
-- CI --check enforcement evidence for cutover-adjacent PRs, and continued
-- Stage 4e soak tracking. Apply after phase49_snapshot_cutover_ops.sql.
-- Public-key metadata / branch / path names only — never store private keys.
-- qualification_eligible / attestation_eligible / production_relation_mutated
-- remain false always. This file NEVER references the retired snapshot
-- store table.

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

create or replace function public.phase50_snapshot_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body|private_key|webhook_url)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

-- ---------------------------------------------------------------------------
-- Page/alert receipts (append-only) for Phase 49's
-- 'protected_branch_cutover_blocked' ops alerts. A receipt is recorded after
-- an allowlisted webhook (or in-app) delivery attempt targeting a specific
-- Phase 49 alert. Never mutates the Phase 49 alert row; purely additive
-- visibility that a human/on-call channel was notified.
-- ---------------------------------------------------------------------------
create table if not exists public.os_snapshot_phase50_page_receipts (
  receipt_id uuid primary key default gen_random_uuid(),
  alert_id uuid not null
    references public.os_snapshot_phase49_ops_alerts(alert_id),
  destination_key text not null,
  delivery_status text not null,
  response_code integer,
  window_key text not null unique,
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint os_snapshot_p50_page_destination_check
    check (destination_key ~ '^[a-z0-9][a-z0-9._-]{1,63}$'),
  constraint os_snapshot_p50_page_status_check
    check (delivery_status in ('sent','failed','skipped')),
  constraint os_snapshot_p50_page_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_snapshot_p50_page_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_p50_page_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

create index if not exists os_snapshot_p50_page_alert_idx
  on public.os_snapshot_phase50_page_receipts(alert_id,created_at desc);

-- ---------------------------------------------------------------------------
-- CI --check enforcement evidence (append-only) for cutover-adjacent PRs.
-- Recorded by CI (service_role) after running
-- `node scripts/ci-snapshot-cutover-accept.mjs --check` (or the phase50
-- companion) against a PR's changed paths.
-- ---------------------------------------------------------------------------
create table if not exists public.os_snapshot_phase50_ci_check_enforcement_events (
  event_id uuid primary key default gen_random_uuid(),
  run_key text not null,
  cutover_adjacent boolean not null,
  check_passed boolean not null,
  paths_matched jsonb not null default '[]'::jsonb,
  window_key text not null unique,
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id),
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint os_snapshot_p50_ci_run_key_check
    check (run_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,119}$'),
  constraint os_snapshot_p50_ci_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_snapshot_p50_ci_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_p50_ci_paths_check
    check (jsonb_typeof(paths_matched)='array' and pg_column_size(paths_matched)<=4096),
  constraint os_snapshot_p50_ci_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_p50_ci_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);

create index if not exists os_snapshot_p50_ci_check_passed_idx
  on public.os_snapshot_phase50_ci_check_enforcement_events(check_passed,created_at desc);

-- ---------------------------------------------------------------------------
-- Stage 4e soak status snapshots (append-only) — periodic rollups of Phase
-- 49 enforcement-event health, continuing the Stage 4e soak observation.
-- ---------------------------------------------------------------------------
create table if not exists public.os_snapshot_phase50_soak_status_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  window_key text not null unique,
  enforcement_events_7d integer not null default 0,
  allowed_7d integer not null default 0,
  blocked_7d integer not null default 0,
  blocked_rate numeric(6,4),
  soak_health text not null default 'healthy',
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_snapshot_p50_soak_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_snapshot_p50_soak_health_check
    check (soak_health in ('healthy','watch','at_risk')),
  constraint os_snapshot_p50_soak_rate_check
    check (blocked_rate is null or (blocked_rate>=0 and blocked_rate<=1)),
  constraint os_snapshot_p50_soak_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_p50_soak_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

create table if not exists public.os_snapshot_phase50_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  alert_kind text not null,
  reference_id uuid,
  window_key text not null unique,
  severity text not null default 'warning',
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint os_snapshot_p50_alert_kind_check
    check (alert_kind in (
      'ci_check_missing_on_cutover_adjacent_pr',
      'page_delivery_failed',
      'soak_at_risk'
    )),
  constraint os_snapshot_p50_alert_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_snapshot_p50_alert_severity_check
    check (severity in ('warning','critical')),
  constraint os_snapshot_p50_alert_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_p50_alert_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_p50_alert_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);

create or replace function public.prevent_snapshot_phase50_append_only()
returns trigger language plpgsql as $$
begin raise exception '% is append-only',tg_table_name; end $$;

drop trigger if exists os_snapshot_p50_page_immutable
  on public.os_snapshot_phase50_page_receipts;
create trigger os_snapshot_p50_page_immutable
  before update or delete or truncate
  on public.os_snapshot_phase50_page_receipts for each statement
  execute function public.prevent_snapshot_phase50_append_only();

drop trigger if exists os_snapshot_p50_ci_check_immutable
  on public.os_snapshot_phase50_ci_check_enforcement_events;
create trigger os_snapshot_p50_ci_check_immutable
  before update or delete or truncate
  on public.os_snapshot_phase50_ci_check_enforcement_events for each statement
  execute function public.prevent_snapshot_phase50_append_only();

drop trigger if exists os_snapshot_p50_soak_immutable
  on public.os_snapshot_phase50_soak_status_snapshots;
create trigger os_snapshot_p50_soak_immutable
  before update or delete or truncate
  on public.os_snapshot_phase50_soak_status_snapshots for each statement
  execute function public.prevent_snapshot_phase50_append_only();

drop trigger if exists os_snapshot_p50_ops_alert_immutable
  on public.os_snapshot_phase50_ops_alerts;
create trigger os_snapshot_p50_ops_alert_immutable
  before update or delete or truncate
  on public.os_snapshot_phase50_ops_alerts for each statement
  execute function public.prevent_snapshot_phase50_append_only();

-- Pure, deterministic path classifier: is this repo-relative path
-- "cutover-adjacent" (i.e. should require the CI --check gate before merge)?
create or replace function public.snapshot_path_is_cutover_adjacent_phase50(
  p_path text
) returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  select coalesce(p_path,'') ~* (
    '(^|/)supabase/phase[0-9]+_snapshot_cutover_ops\.sql$' || '|' ||
    '(^|/)scripts/ci-snapshot-cutover-accept(-[a-z0-9-]+)?\.mjs$' || '|' ||
    '(^|/)src/lib/data/snapshot-retirement-phase[0-9]+\.ts$'
  );
$$;

-- Record a page/alert delivery receipt for an existing Phase 49
-- 'protected_branch_cutover_blocked' alert. Delivery itself (webhook fetch)
-- happens in the TS worker against the Phase 48 allowlist pattern; this RPC
-- only persists the outcome. Never mutates the underlying Phase 49 alert.
create or replace function public.page_snapshot_protected_branch_cutover_blocked_phase50(
  p_actor_id uuid,
  p_alert_id uuid,
  p_destination_key text,
  p_delivery_status text,
  p_response_code integer default null,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alert public.os_snapshot_phase49_ops_alerts%rowtype;
  v_window text;
  v_hash text;
  v_id uuid;
  v_safe_detail jsonb:=coalesce(p_detail,'{}'::jsonb);
begin
  if not public.phase40_snapshot_actor_authorized(p_actor_id,null)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Phase 50 page receipt authorization failed';
  end if;
  if p_delivery_status not in ('sent','failed','skipped') then
    raise exception 'Invalid Phase 50 page delivery status';
  end if;
  if not public.phase50_snapshot_safe_detail(v_safe_detail) then
    raise exception 'Phase 50 page receipt detail failed safe-metadata checks';
  end if;

  select * into v_alert from public.os_snapshot_phase49_ops_alerts
    where alert_id=p_alert_id and alert_kind='protected_branch_cutover_blocked';
  if not found then
    raise exception 'Alert was not found or is not a protected_branch_cutover_blocked alert';
  end if;

  v_window:='phase50:page:'||p_alert_id::text||':'||coalesce(p_destination_key,'');
  v_hash:=public.os_sha256_hex(jsonb_build_object(
    'alert_id',p_alert_id,
    'contract_version','phase50-v1',
    'delivery_status',p_delivery_status,
    'destination_key',p_destination_key,
    'window_key',v_window
  )::text);

  insert into public.os_snapshot_phase50_page_receipts(
    alert_id,destination_key,delivery_status,response_code,window_key,
    metrics_sha256,detail,actor_id
  ) values (
    p_alert_id,p_destination_key,p_delivery_status,p_response_code,v_window,
    v_hash,
    jsonb_build_object(
      'contract_version','phase50-v1',
      'source','page_snapshot_protected_branch_cutover_blocked_phase50'
    ) || v_safe_detail,
    p_actor_id
  )
  on conflict (window_key) do nothing
  returning receipt_id into v_id;

  if v_id is null then
    select receipt_id into v_id from public.os_snapshot_phase50_page_receipts
      where window_key=v_window;
  end if;

  if p_delivery_status='failed' then
    insert into public.os_snapshot_phase50_ops_alerts(
      alert_kind,reference_id,window_key,severity,metrics_sha256,detail,
      qualification_eligible,attestation_eligible,production_relation_mutated
    ) values (
      'page_delivery_failed',p_alert_id,'phase50:alert:page-fail:'||v_window,
      'warning',v_hash,
      jsonb_build_object(
        'contract_version','phase50-v1',
        'source','page_snapshot_protected_branch_cutover_blocked_phase50'
      ),
      false,false,false
    ) on conflict (window_key) do nothing;
  end if;

  return jsonb_build_object(
    'receipt_id',v_id,
    'alert_id',p_alert_id,
    'delivery_status',p_delivery_status,
    'contract_version','phase50-v1',
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false
  );
end $$;

-- Record CI --check enforcement evidence for a PR/run against its changed
-- paths. Service-role only (called from CI). Raises an ops alert when a
-- cutover-adjacent path was touched but the check did not pass.
create or replace function public.record_snapshot_phase50_ci_check_enforcement(
  p_actor_id uuid,
  p_run_key text,
  p_paths jsonb,
  p_check_passed boolean,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
  v_cutover_adjacent boolean:=false;
  v_matched jsonb:='[]'::jsonb;
  v_window text;
  v_hash text;
  v_id uuid;
  v_safe_detail jsonb:=coalesce(p_detail,'{}'::jsonb);
begin
  if auth.role() is distinct from 'service_role'
     and not public.phase40_snapshot_actor_authorized(p_actor_id,null) then
    raise exception 'Phase 50 CI check enforcement recording is service-role/firm-wide only';
  end if;
  if jsonb_typeof(p_paths) is distinct from 'array' then
    raise exception 'Phase 50 CI check enforcement requires a JSON array of paths';
  end if;
  if not public.phase50_snapshot_safe_detail(v_safe_detail) then
    raise exception 'Phase 50 CI check enforcement detail failed safe-metadata checks';
  end if;

  for v_path in select jsonb_array_elements_text(p_paths)
  loop
    if public.snapshot_path_is_cutover_adjacent_phase50(v_path) then
      v_cutover_adjacent:=true;
      v_matched:=v_matched || to_jsonb(v_path);
    end if;
  end loop;

  v_window:='phase50:ci_check:'||coalesce(p_run_key,'')||':'||
    to_char(now() at time zone 'utc','YYYY-MM-DD-HH24-MI-SS')||':'||gen_random_uuid()::text;
  v_hash:=public.os_sha256_hex(jsonb_build_object(
    'check_passed',p_check_passed,
    'contract_version','phase50-v1',
    'cutover_adjacent',v_cutover_adjacent,
    'run_key',p_run_key,
    'window_key',v_window
  )::text);

  insert into public.os_snapshot_phase50_ci_check_enforcement_events(
    run_key,cutover_adjacent,check_passed,paths_matched,window_key,
    metrics_sha256,detail,actor_id,
    qualification_eligible,attestation_eligible,production_relation_mutated
  ) values (
    coalesce(nullif(trim(p_run_key),''),'local:'||gen_random_uuid()::text),
    v_cutover_adjacent,p_check_passed,v_matched,v_window,
    v_hash,
    jsonb_build_object(
      'contract_version','phase50-v1',
      'source','record_snapshot_phase50_ci_check_enforcement'
    ) || v_safe_detail,
    p_actor_id,false,false,false
  ) returning event_id into v_id;

  if v_cutover_adjacent and not p_check_passed then
    insert into public.os_snapshot_phase50_ops_alerts(
      alert_kind,reference_id,window_key,severity,metrics_sha256,detail,
      qualification_eligible,attestation_eligible,production_relation_mutated
    ) values (
      'ci_check_missing_on_cutover_adjacent_pr',v_id,'phase50:alert:'||v_window,
      'critical',v_hash,
      jsonb_build_object(
        'contract_version','phase50-v1',
        'run_key',p_run_key,
        'source','record_snapshot_phase50_ci_check_enforcement'
      ),
      false,false,false
    ) on conflict (window_key) do nothing;
  end if;

  return jsonb_build_object(
    'event_id',v_id,
    'cutover_adjacent',v_cutover_adjacent,
    'check_passed',p_check_passed,
    'paths_matched',v_matched,
    'contract_version','phase50-v1',
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false
  );
end $$;

-- Continue Stage 4e soak observation: roll up the last 7 days of Phase 49
-- enforcement events into an append-only health snapshot. Read + append-
-- only — never mutates enforcement or production alert evaluation.
create or replace function public.record_snapshot_phase50_soak_status(
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer:=0;
  v_allowed integer:=0;
  v_blocked integer:=0;
  v_rate numeric;
  v_health text;
  v_window text;
  v_hash text;
  v_id uuid;
begin
  if p_actor_id is not null
     and not public.phase40_snapshot_actor_authorized(p_actor_id,null)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Phase 50 soak status recording authorization failed';
  end if;

  select count(*),
    count(*) filter (where decision='allowed'),
    count(*) filter (where decision='blocked')
  into v_total,v_allowed,v_blocked
  from public.os_snapshot_phase49_cutover_enforcement_events
  where created_at>=now()-interval '7 days';

  v_rate:=case when v_total>0 then round(v_blocked::numeric/v_total,4) else null end;

  if v_rate is null then
    v_health:='healthy';
  elsif v_rate>0.2000 then
    v_health:='at_risk';
  elsif v_rate>0.0500 then
    v_health:='watch';
  else
    v_health:='healthy';
  end if;

  v_window:='phase50:soak:'||to_char(now() at time zone 'utc','YYYY-MM-DD');
  if exists (
    select 1 from public.os_snapshot_phase50_soak_status_snapshots s
    where s.window_key=v_window
  ) then
    select snapshot_id into v_id from public.os_snapshot_phase50_soak_status_snapshots
      where window_key=v_window;
    return jsonb_build_object(
      'snapshot_id',v_id,
      'already_recorded_today',true,
      'contract_version','phase50-v1'
    );
  end if;

  v_hash:=public.os_sha256_hex(jsonb_build_object(
    'blocked_7d',v_blocked,
    'contract_version','phase50-v1',
    'enforcement_events_7d',v_total,
    'soak_health',v_health,
    'window_key',v_window
  )::text);

  insert into public.os_snapshot_phase50_soak_status_snapshots(
    window_key,enforcement_events_7d,allowed_7d,blocked_7d,blocked_rate,
    soak_health,metrics_sha256,detail
  ) values (
    v_window,v_total,v_allowed,v_blocked,v_rate,v_health,v_hash,
    jsonb_build_object(
      'contract_version','phase50-v1',
      'stage','4e',
      'source','record_snapshot_phase50_soak_status'
    )
  ) returning snapshot_id into v_id;

  if v_health='at_risk' then
    insert into public.os_snapshot_phase50_ops_alerts(
      alert_kind,reference_id,window_key,severity,metrics_sha256,detail,
      qualification_eligible,attestation_eligible,production_relation_mutated
    ) values (
      'soak_at_risk',v_id,'phase50:alert:'||v_window,'critical',v_hash,
      jsonb_build_object(
        'contract_version','phase50-v1',
        'blocked_rate',v_rate,
        'source','record_snapshot_phase50_soak_status'
      ),
      false,false,false
    ) on conflict (window_key) do nothing;
  end if;

  return jsonb_build_object(
    'snapshot_id',v_id,
    'enforcement_events_7d',v_total,
    'allowed_7d',v_allowed,
    'blocked_7d',v_blocked,
    'blocked_rate',v_rate,
    'soak_health',v_health,
    'stage','4e',
    'contract_version','phase50-v1'
  );
end $$;

-- Visibility: unpaged 'protected_branch_cutover_blocked' alerts, plus
-- recent Phase 50 ops alerts (ci-check-missing / page-failed / soak-at-risk).
create or replace function public.list_snapshot_phase50_critical_windows(
  p_window_hours integer default 24
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'unpaged_blocked_alerts',
    coalesce((
      select jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc)
      from (
        select a.alert_id, a.rotation_id, a.severity, a.created_at
        from public.os_snapshot_phase49_ops_alerts a
        where a.alert_kind='protected_branch_cutover_blocked'
          and a.created_at>=now()-((least(greatest(coalesce(p_window_hours,24),1),168))||' hours')::interval
          and not exists (
            select 1 from public.os_snapshot_phase50_page_receipts r
            where r.alert_id=a.alert_id and r.delivery_status='sent'
          )
        order by a.created_at desc
        limit 100
      ) t
    ),'[]'::jsonb),
    'recent_phase50_alerts',
    coalesce((
      select jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc)
      from (
        select b.alert_id, b.alert_kind, b.reference_id, b.severity, b.created_at
        from public.os_snapshot_phase50_ops_alerts b
        where b.created_at>=now()-((least(greatest(coalesce(p_window_hours,24),1),168))||' hours')::interval
        order by b.created_at desc
        limit 100
      ) t
    ),'[]'::jsonb)
  );
$$;

create or replace function public.get_snapshot_phase50_ops_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_recent_soak jsonb:='[]'::jsonb;
  v_recent_ci jsonb:='[]'::jsonb;
begin
  if not public.is_firm_wide_access()
     and auth.role() is distinct from 'service_role' then
    raise exception 'Firm-wide access required for Snapshot Phase 50 ops report';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc),'[]'::jsonb)
    into v_recent_soak
  from (
    select snapshot_id, enforcement_events_7d, allowed_7d, blocked_7d,
      blocked_rate, soak_health, created_at
    from public.os_snapshot_phase50_soak_status_snapshots
    order by created_at desc
    limit 14
  ) t;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc),'[]'::jsonb)
    into v_recent_ci
  from (
    select event_id, run_key, cutover_adjacent, check_passed, created_at
    from public.os_snapshot_phase50_ci_check_enforcement_events
    order by created_at desc
    limit 20
  ) t;

  return jsonb_build_object(
    'blocked_alerts_30d',
      (select count(*) from public.os_snapshot_phase49_ops_alerts
        where alert_kind='protected_branch_cutover_blocked'
          and created_at>=now()-interval '30 days'),
    'paged_receipts_30d',
      (select count(*) from public.os_snapshot_phase50_page_receipts
        where delivery_status='sent' and created_at>=now()-interval '30 days'),
    'unpaged_blocked_alerts_current',
      (select count(*) from public.os_snapshot_phase49_ops_alerts a
        where a.alert_kind='protected_branch_cutover_blocked'
          and not exists (
            select 1 from public.os_snapshot_phase50_page_receipts r
            where r.alert_id=a.alert_id and r.delivery_status='sent'
          )),
    'ci_check_enforcement_events_30d',
      (select count(*) from public.os_snapshot_phase50_ci_check_enforcement_events
        where created_at>=now()-interval '30 days'),
    'ci_check_missing_on_cutover_adjacent_30d',
      (select count(*) from public.os_snapshot_phase50_ci_check_enforcement_events
        where created_at>=now()-interval '30 days'
          and cutover_adjacent and not check_passed),
    'recent_ci_check_events',v_recent_ci,
    'recent_soak_status_snapshots',v_recent_soak,
    'stage','4e',
    'ops_alerts_30d',
      (select count(*) from public.os_snapshot_phase50_ops_alerts
        where created_at>=now()-interval '30 days'),
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false,
    'contract_version','phase50-v1'
  );
end $$;

alter table public.os_snapshot_phase50_page_receipts enable row level security;
alter table public.os_snapshot_phase50_ci_check_enforcement_events enable row level security;
alter table public.os_snapshot_phase50_soak_status_snapshots enable row level security;
alter table public.os_snapshot_phase50_ops_alerts enable row level security;

drop policy if exists "os_snapshot_p50_page_select"
  on public.os_snapshot_phase50_page_receipts;
create policy "os_snapshot_p50_page_select"
  on public.os_snapshot_phase50_page_receipts for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_p50_ci_check_select"
  on public.os_snapshot_phase50_ci_check_enforcement_events;
create policy "os_snapshot_p50_ci_check_select"
  on public.os_snapshot_phase50_ci_check_enforcement_events for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_p50_soak_select"
  on public.os_snapshot_phase50_soak_status_snapshots;
create policy "os_snapshot_p50_soak_select"
  on public.os_snapshot_phase50_soak_status_snapshots for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_p50_ops_alert_select"
  on public.os_snapshot_phase50_ops_alerts;
create policy "os_snapshot_p50_ops_alert_select"
  on public.os_snapshot_phase50_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_snapshot_phase50_page_receipts,
  public.os_snapshot_phase50_ci_check_enforcement_events,
  public.os_snapshot_phase50_soak_status_snapshots,
  public.os_snapshot_phase50_ops_alerts
  to authenticated, service_role;
revoke insert,update,delete,truncate on
  public.os_snapshot_phase50_page_receipts,
  public.os_snapshot_phase50_ci_check_enforcement_events,
  public.os_snapshot_phase50_soak_status_snapshots,
  public.os_snapshot_phase50_ops_alerts
  from public,authenticated,service_role;

revoke all on function public.prevent_snapshot_phase50_append_only()
  from public,authenticated,service_role;
revoke all on function public.page_snapshot_protected_branch_cutover_blocked_phase50(
  uuid,uuid,text,text,integer,jsonb
) from public,authenticated;
revoke all on function public.record_snapshot_phase50_ci_check_enforcement(
  uuid,text,jsonb,boolean,jsonb
) from public,authenticated;
revoke all on function public.record_snapshot_phase50_soak_status(uuid)
  from public,authenticated;
revoke all on function public.snapshot_path_is_cutover_adjacent_phase50(text)
  from public,anon;
revoke all on function public.list_snapshot_phase50_critical_windows(integer)
  from public,anon;
revoke all on function public.get_snapshot_phase50_ops_report()
  from public,anon;

grant execute on function public.phase50_snapshot_safe_detail(jsonb),
  public.snapshot_path_is_cutover_adjacent_phase50(text),
  public.list_snapshot_phase50_critical_windows(integer),
  public.get_snapshot_phase50_ops_report()
  to authenticated, service_role;
grant execute on function public.page_snapshot_protected_branch_cutover_blocked_phase50(
  uuid,uuid,text,text,integer,jsonb
) to authenticated, service_role;
grant execute on function public.record_snapshot_phase50_ci_check_enforcement(
  uuid,text,jsonb,boolean,jsonb
) to service_role;
grant execute on function public.record_snapshot_phase50_soak_status(uuid)
  to authenticated, service_role;
