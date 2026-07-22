-- Phase 49: autopilot dry-run dashboards and cohort promotion audit exports
-- over Phase 48 evidence. Apply after phase48_marketing_revenue_ops.sql.
-- Safe to re-run.
-- Never stores secret values — hashes, counts, statuses, and safe metadata only.
-- Never mutates snapshot retirement tables. NEVER auto-approves money corrections.
-- Dry-run snapshots NEVER call any cohort auto-reject promoting RPC; they only
-- read/evaluate the existing gate (never_calls_promote). Audit exports are
-- read + append-only receipts and never mutate promotion state.

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

-- Bootstrap Phase 48 safe-metadata helper if prior Marketing SQL was skipped.
create or replace function public.phase48_marketing_ops_safe_metadata(p_detail jsonb)
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

create or replace function public.phase49_marketing_ops_safe_metadata(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select public.phase48_marketing_ops_safe_metadata(p_detail);
$$;

-- ---------------------------------------------------------------------------
-- Append-only autopilot dry-run snapshots. Read-only simulation of what the
-- Phase 48 autopilot would do next tick — NEVER calls promote/auto-reject.
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_autopilot_dry_run_snapshots (
  dry_run_id uuid primary key default gen_random_uuid(),
  dry_run_key text not null unique
    check (dry_run_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  cohort_id uuid not null
    references public.os_marketing_revenue_promotion_cohorts(cohort_id),
  gate_passed boolean not null default false,
  consecutive_healthy_windows integer not null
    check (consecutive_healthy_windows >= 0),
  windows_required integer not null
    check (windows_required between 1 and 30),
  predicted_status text not null check (predicted_status in
    ('would_promote','would_block','would_wait')),
  block_reason text,
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  actor_id uuid,
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (not (metadata ?| array[
    'authorization','cookie','set-cookie','token','secret','signature','jwt',
    'credential','password','payload','body','value','env_value','url'
  ])),
  check (
    (predicted_status = 'would_promote' and block_reason is null)
    or (predicted_status in ('would_block','would_wait'))
  )
);

create index if not exists os_mkt_rev_dry_run_created_idx
  on public.os_marketing_revenue_autopilot_dry_run_snapshots(created_at desc);
create index if not exists os_mkt_rev_dry_run_cohort_idx
  on public.os_marketing_revenue_autopilot_dry_run_snapshots(cohort_id, created_at desc);
create index if not exists os_mkt_rev_dry_run_status_idx
  on public.os_marketing_revenue_autopilot_dry_run_snapshots(predicted_status, created_at desc);

alter table public.os_marketing_revenue_autopilot_dry_run_snapshots
  enable row level security;
drop policy if exists "os_mkt_rev_dry_run_select"
  on public.os_marketing_revenue_autopilot_dry_run_snapshots;
create policy "os_mkt_rev_dry_run_select"
  on public.os_marketing_revenue_autopilot_dry_run_snapshots for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_marketing_revenue_autopilot_dry_run_snapshots
  from public, anon, authenticated;
grant select on public.os_marketing_revenue_autopilot_dry_run_snapshots
  to authenticated;

-- ---------------------------------------------------------------------------
-- Append-only cohort promotion audit export receipts. Read + append-only —
-- never mutates promotion/autopilot state, only records what was exported.
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_cohort_promotion_audit_exports (
  export_id uuid primary key default gen_random_uuid(),
  export_key text not null unique
    check (export_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  entity_id text references public.entities(entity_id),
  window_days integer not null check (window_days between 1 and 365),
  promotions_included integer not null default 0
    check (promotions_included >= 0),
  autopilot_runs_included integer not null default 0
    check (autopilot_runs_included >= 0),
  dry_run_snapshots_included integer not null default 0
    check (dry_run_snapshots_included >= 0),
  export_sha256 text not null check (export_sha256 ~ '^[0-9a-f]{64}$'),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  exported_by uuid,
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (not (metadata ?| array[
    'authorization','cookie','set-cookie','token','secret','signature','jwt',
    'credential','password','payload','body','value','env_value','url'
  ]))
);

create index if not exists os_mkt_rev_audit_export_created_idx
  on public.os_marketing_revenue_cohort_promotion_audit_exports(created_at desc);
create index if not exists os_mkt_rev_audit_export_entity_idx
  on public.os_marketing_revenue_cohort_promotion_audit_exports(entity_id, created_at desc);

alter table public.os_marketing_revenue_cohort_promotion_audit_exports
  enable row level security;
drop policy if exists "os_mkt_rev_audit_export_select"
  on public.os_marketing_revenue_cohort_promotion_audit_exports;
create policy "os_mkt_rev_audit_export_select"
  on public.os_marketing_revenue_cohort_promotion_audit_exports for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_marketing_revenue_cohort_promotion_audit_exports
  from public, anon, authenticated;
grant select on public.os_marketing_revenue_cohort_promotion_audit_exports
  to authenticated;

-- ---------------------------------------------------------------------------
-- Phase 49 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_phase49_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  entity_id text references public.entities(entity_id),
  source_id uuid,
  cohort_id uuid,
  alert_kind text not null,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null default 'critical' check (severity = 'critical'),
  destination_key text not null check (destination_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  delivery_status text not null check (delivery_status in
    ('delivered','skipped_no_webhook','failed','recorded')),
  response_code integer check (response_code is null or response_code between 100 and 599),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_mkt_rev_p49_alert_kind_check
    check (alert_kind in (
      'autopilot_dry_run_would_promote',
      'autopilot_dry_run_would_block',
      'cohort_promotion_audit_exported'
    )),
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (not (metadata ?| array[
    'authorization','cookie','set-cookie','token','secret','signature','jwt',
    'credential','password','payload','body','value','env_value','url'
  ]))
);

create index if not exists os_mkt_rev_p49_alert_created_idx
  on public.os_marketing_revenue_phase49_ops_alerts(created_at desc);
create index if not exists os_mkt_rev_p49_alert_kind_idx
  on public.os_marketing_revenue_phase49_ops_alerts(alert_kind, created_at desc);

alter table public.os_marketing_revenue_phase49_ops_alerts
  enable row level security;
drop policy if exists "os_mkt_rev_p49_alert_select"
  on public.os_marketing_revenue_phase49_ops_alerts;
create policy "os_mkt_rev_p49_alert_select"
  on public.os_marketing_revenue_phase49_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_marketing_revenue_phase49_ops_alerts
  from public, anon, authenticated;
grant select on public.os_marketing_revenue_phase49_ops_alerts
  to authenticated;

create or replace function public.reject_marketing_phase49_ops_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Marketing revenue Phase 49 ops evidence is append-only';
end;
$$;

drop trigger if exists os_mkt_rev_dry_run_immutable
  on public.os_marketing_revenue_autopilot_dry_run_snapshots;
create trigger os_mkt_rev_dry_run_immutable
  before update or delete on public.os_marketing_revenue_autopilot_dry_run_snapshots
  for each row execute function public.reject_marketing_phase49_ops_mutation();
drop trigger if exists os_mkt_rev_dry_run_no_truncate
  on public.os_marketing_revenue_autopilot_dry_run_snapshots;
create trigger os_mkt_rev_dry_run_no_truncate
  before truncate on public.os_marketing_revenue_autopilot_dry_run_snapshots
  for each statement execute function public.reject_marketing_phase49_ops_mutation();

drop trigger if exists os_mkt_rev_audit_export_immutable
  on public.os_marketing_revenue_cohort_promotion_audit_exports;
create trigger os_mkt_rev_audit_export_immutable
  before update or delete on public.os_marketing_revenue_cohort_promotion_audit_exports
  for each row execute function public.reject_marketing_phase49_ops_mutation();
drop trigger if exists os_mkt_rev_audit_export_no_truncate
  on public.os_marketing_revenue_cohort_promotion_audit_exports;
create trigger os_mkt_rev_audit_export_no_truncate
  before truncate on public.os_marketing_revenue_cohort_promotion_audit_exports
  for each statement execute function public.reject_marketing_phase49_ops_mutation();

drop trigger if exists os_mkt_rev_p49_alert_immutable
  on public.os_marketing_revenue_phase49_ops_alerts;
create trigger os_mkt_rev_p49_alert_immutable
  before update or delete on public.os_marketing_revenue_phase49_ops_alerts
  for each row execute function public.reject_marketing_phase49_ops_mutation();
drop trigger if exists os_mkt_rev_p49_alert_no_truncate
  on public.os_marketing_revenue_phase49_ops_alerts;
create trigger os_mkt_rev_p49_alert_no_truncate
  before truncate on public.os_marketing_revenue_phase49_ops_alerts
  for each statement execute function public.reject_marketing_phase49_ops_mutation();

-- ---------------------------------------------------------------------------
-- Record a dry-run snapshot for every active cohort: predicts what the
-- Phase 48 autopilot would do, WITHOUT calling promote. NEVER auto-approves
-- money. This is a read + append-only simulation over existing evidence.
-- ---------------------------------------------------------------------------
create or replace function public.record_marketing_autopilot_dry_run_snapshot_phase49(
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_payload->'metadata', '{}'::jsonb);
  v_actor uuid := nullif(p_payload->>'actor_id','')::uuid;
  v_defaults jsonb := public.phase48_default_autopilot_thresholds();
  v_required integer;
  v_cohort public.os_marketing_revenue_promotion_cohorts%rowtype;
  v_gate jsonb;
  v_consec integer;
  v_prior record;
  v_status text;
  v_reason text;
  v_hash text;
  v_key text;
  v_id uuid;
  v_bucket text := to_char(now(),'YYYYMMDD"T"HH24');
  v_snapshots integer := 0;
  v_would_promote integer := 0;
  v_would_block integer := 0;
  v_would_wait integer := 0;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Autopilot dry-run payload must be a JSON object';
  end if;
  if not public.phase49_marketing_ops_safe_metadata(v_meta) then
    raise exception 'Autopilot dry-run metadata is invalid or unsafe';
  end if;

  v_required := least(greatest(coalesce(
    nullif(p_payload->>'autopilot_consecutive_windows_required','')::integer,
    (v_defaults->>'autopilot_consecutive_windows_required')::integer,
    3), 1), 30);

  for v_cohort in
    select *
    from public.os_marketing_revenue_promotion_cohorts c
    where c.status = 'active'
      and (
        p_payload->>'entity_id' is null
        or cardinality(c.entity_ids) = 0
        or (p_payload->>'entity_id') = any (c.entity_ids)
      )
    order by c.created_at desc
    limit 50
  loop
    -- Read-only gate evaluation (never_calls_promote). Never promotes/mutates.
    v_gate := public.evaluate_marketing_cohort_promotion_gate_phase47(
      jsonb_build_object('cohort_id', v_cohort.cohort_id));

    v_consec := 0;
    if coalesce((v_gate->>'gate_passed')::boolean,false) then
      v_consec := 1;
      for v_prior in
        select r.gate_passed, r.run_status
        from public.os_marketing_revenue_cohort_autopilot_runs r
        where r.cohort_id = v_cohort.cohort_id
        order by r.created_at desc, r.run_id desc
        limit greatest(v_required - 1, 0)
      loop
        if v_prior.gate_passed is true
          and v_prior.run_status is distinct from 'blocked' then
          v_consec := v_consec + 1;
        else
          exit;
        end if;
      end loop;
    end if;

    if coalesce((v_gate->>'gate_passed')::boolean,false) is not true then
      v_status := 'would_block';
      v_reason := coalesce(v_gate->>'block_reason',
        'Cohort autopilot gate is not healthy');
      v_would_block := v_would_block + 1;
    elsif v_consec < v_required then
      v_status := 'would_wait';
      v_reason := 'Cohort gate healthy for '
        || v_consec::text || '/' || v_required::text
        || ' consecutive windows; dry run predicts wait';
      v_would_wait := v_would_wait + 1;
    else
      v_status := 'would_promote';
      v_reason := null;
      v_would_promote := v_would_promote + 1;
    end if;

    v_key := left(
      'dryrun:' || v_cohort.cohort_id::text || ':' || v_bucket,
      200);
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase49-v1',
      'kind','autopilot_dry_run',
      'cohort_id',v_cohort.cohort_id,
      'gate_passed',coalesce((v_gate->>'gate_passed')::boolean,false),
      'consecutive_healthy_windows',v_consec,
      'windows_required',v_required,
      'predicted_status',v_status
    )::text);

    insert into public.os_marketing_revenue_autopilot_dry_run_snapshots(
      dry_run_key,cohort_id,gate_passed,consecutive_healthy_windows,
      windows_required,predicted_status,block_reason,metrics_sha256,
      metadata,actor_id)
    values (
      v_key,v_cohort.cohort_id,
      coalesce((v_gate->>'gate_passed')::boolean,false),
      v_consec,v_required,v_status,left(v_reason,500),v_hash,
      v_meta || jsonb_build_object(
        'contract_version','phase49-v1',
        'gate',v_gate,
        'never_calls_promote',true,
        'dry_run',true,
        'never_auto_approves_money',true),
      v_actor)
    on conflict (dry_run_key) do nothing
    returning dry_run_id into v_id;

    if v_id is not null then
      v_snapshots := v_snapshots + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'version','phase49-v1',
    'snapshots_recorded',v_snapshots,
    'would_promote_count',v_would_promote,
    'would_block_count',v_would_block,
    'would_wait_count',v_would_wait,
    'never_calls_promote',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Export a read + append-only audit receipt of cohort promotion + autopilot
-- activity over a window. Never mutates promotion/autopilot rows.
-- ---------------------------------------------------------------------------
create or replace function public.export_marketing_cohort_promotion_audit_phase49(
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_payload->'metadata', '{}'::jsonb);
  v_actor uuid := nullif(p_payload->>'exported_by','')::uuid;
  v_entity text := nullif(p_payload->>'entity_id','');
  v_days integer := least(greatest(coalesce(
    nullif(p_payload->>'window_days','')::integer, 30), 1), 365);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_promotions integer := 0;
  v_autopilot_runs integer := 0;
  v_dry_runs integer := 0;
  v_export_hash text;
  v_hash text;
  v_key text;
  v_id uuid;
  v_existing public.os_marketing_revenue_cohort_promotion_audit_exports%rowtype;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Cohort promotion audit export payload must be a JSON object';
  end if;
  if not public.phase49_marketing_ops_safe_metadata(v_meta) then
    raise exception 'Cohort promotion audit export metadata is invalid or unsafe';
  end if;
  if v_entity is not null
    and not exists (select 1 from public.entities where entity_id = v_entity) then
    raise exception 'Cohort promotion audit export entity is unknown';
  end if;

  select count(*)::integer into v_promotions
  from public.os_marketing_revenue_cohort_promotions p
  join public.os_marketing_revenue_promotion_cohorts c
    on c.cohort_id = p.cohort_id
  where p.created_at >= v_since
    and (
      v_entity is null
      or cardinality(c.entity_ids) = 0
      or v_entity = any (c.entity_ids)
    );

  select count(*)::integer into v_autopilot_runs
  from public.os_marketing_revenue_cohort_autopilot_runs r
  join public.os_marketing_revenue_promotion_cohorts c
    on c.cohort_id = r.cohort_id
  where r.created_at >= v_since
    and (
      v_entity is null
      or cardinality(c.entity_ids) = 0
      or v_entity = any (c.entity_ids)
    );

  select count(*)::integer into v_dry_runs
  from public.os_marketing_revenue_autopilot_dry_run_snapshots d
  join public.os_marketing_revenue_promotion_cohorts c
    on c.cohort_id = d.cohort_id
  where d.created_at >= v_since
    and (
      v_entity is null
      or cardinality(c.entity_ids) = 0
      or v_entity = any (c.entity_ids)
    );

  v_export_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase49-v1',
    'kind','cohort_promotion_audit_export',
    'entity_id',v_entity,
    'window_days',v_days,
    'promotions_included',v_promotions,
    'autopilot_runs_included',v_autopilot_runs,
    'dry_run_snapshots_included',v_dry_runs,
    'since',v_since
  )::text);

  v_key := left(
    'auditexport:' || coalesce(v_entity,'firm') || ':' || v_days::text || ':'
      || to_char(now(),'YYYYMMDD"T"HH24'),
    200);

  v_hash := v_export_hash;

  insert into public.os_marketing_revenue_cohort_promotion_audit_exports(
    export_key,entity_id,window_days,promotions_included,
    autopilot_runs_included,dry_run_snapshots_included,export_sha256,
    metrics_sha256,metadata,exported_by)
  values (
    v_key,v_entity,v_days,v_promotions,v_autopilot_runs,v_dry_runs,
    v_export_hash,v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase49-v1',
      'read_only_export',true),
    v_actor)
  on conflict (export_key) do nothing
  returning * into v_existing;

  if v_existing.export_id is null then
    select * into v_existing
    from public.os_marketing_revenue_cohort_promotion_audit_exports
    where export_key = v_key;
    return jsonb_build_object(
      'version','phase49-v1',
      'disposition','unchanged',
      'export_id',v_existing.export_id,
      'export_key',v_existing.export_key,
      'promotions_included',v_existing.promotions_included,
      'autopilot_runs_included',v_existing.autopilot_runs_included,
      'dry_run_snapshots_included',v_existing.dry_run_snapshots_included,
      'export_sha256',v_existing.export_sha256);
  end if;

  return jsonb_build_object(
    'version','phase49-v1',
    'disposition','exported',
    'export_id',v_existing.export_id,
    'export_key',v_existing.export_key,
    'promotions_included',v_existing.promotions_included,
    'autopilot_runs_included',v_existing.autopilot_runs_included,
    'dry_run_snapshots_included',v_existing.dry_run_snapshots_included,
    'export_sha256',v_existing.export_sha256);
end;
$$;

-- ---------------------------------------------------------------------------
-- List critical windows that still need an idempotent ops alert insert
-- ---------------------------------------------------------------------------
create or replace function public.list_marketing_revenue_phase49_critical_windows(
  p_entity_id text default null,
  p_days integer default 30,
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
  v_dry_run public.os_marketing_revenue_autopilot_dry_run_snapshots%rowtype;
  v_export public.os_marketing_revenue_cohort_promotion_audit_exports%rowtype;
  v_key text;
  v_entity text;
begin
  v_bucket := to_char(
    to_timestamp(
      (floor(extract(epoch from now()) / (v_hours * 3600.0))
        * (v_hours * 3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  select * into v_dry_run
  from public.os_marketing_revenue_autopilot_dry_run_snapshots
  where predicted_status in ('would_promote','would_block')
  order by created_at desc
  limit 1;

  if v_dry_run.dry_run_id is not null then
    select coalesce(c.entity_ids[1], p_entity_id) into v_entity
    from public.os_marketing_revenue_promotion_cohorts c
    where c.cohort_id = v_dry_run.cohort_id;

    if v_dry_run.predicted_status = 'would_promote' then
      v_key := 'dryrunpromo49:firm:' || v_bucket || 'h' || v_hours::text;
      if not exists (
        select 1 from public.os_marketing_revenue_phase49_ops_alerts a
        where a.window_key = v_key
      ) then
        v_pending := v_pending || jsonb_build_array(jsonb_build_object(
          'alert_kind','autopilot_dry_run_would_promote',
          'entity_id',v_entity,
          'cohort_id',v_dry_run.cohort_id,
          'window_key',v_key,
          'severity','critical',
          'dry_run_id',v_dry_run.dry_run_id,
          'consecutive_healthy_windows',v_dry_run.consecutive_healthy_windows,
          'windows_required',v_dry_run.windows_required,
          'metrics_sha256',v_dry_run.metrics_sha256
        ));
      end if;
    else
      v_key := 'dryrunblock49:firm:' || v_bucket || 'h' || v_hours::text;
      if not exists (
        select 1 from public.os_marketing_revenue_phase49_ops_alerts a
        where a.window_key = v_key
      ) then
        v_pending := v_pending || jsonb_build_array(jsonb_build_object(
          'alert_kind','autopilot_dry_run_would_block',
          'entity_id',v_entity,
          'cohort_id',v_dry_run.cohort_id,
          'window_key',v_key,
          'severity','critical',
          'dry_run_id',v_dry_run.dry_run_id,
          'consecutive_healthy_windows',v_dry_run.consecutive_healthy_windows,
          'windows_required',v_dry_run.windows_required,
          'metrics_sha256',v_dry_run.metrics_sha256
        ));
      end if;
    end if;
  end if;

  select * into v_export
  from public.os_marketing_revenue_cohort_promotion_audit_exports
  order by created_at desc
  limit 1;

  if v_export.export_id is not null then
    v_key := 'auditexported49:firm:' || v_export.export_id::text;
    if not exists (
      select 1 from public.os_marketing_revenue_phase49_ops_alerts a
      where a.window_key = v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','cohort_promotion_audit_exported',
        'entity_id',coalesce(v_export.entity_id, p_entity_id),
        'cohort_id',null,
        'window_key',v_key,
        'severity','critical',
        'export_id',v_export.export_id,
        'promotions_included',v_export.promotions_included,
        'autopilot_runs_included',v_export.autopilot_runs_included,
        'metrics_sha256',v_export.metrics_sha256
      ));
    end if;
  end if;

  return jsonb_build_object(
    'version','phase49-v1',
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',v_pending
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record one critical ops alert after delivery attempt (idempotent window_key)
-- ---------------------------------------------------------------------------
create or replace function public.record_marketing_revenue_phase49_ops_alert(
  p_alert jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_kind text;
  v_window text;
  v_entity text;
  v_cohort uuid;
  v_dest text;
  v_delivery text;
  v_code integer;
  v_hash text;
  v_meta jsonb;
  v_id uuid;
  v_status text;
begin
  if jsonb_typeof(coalesce(p_alert,'{}'::jsonb)) <> 'object' then
    raise exception 'Phase 49 ops alert payload must be a JSON object';
  end if;

  v_kind := coalesce(p_alert->>'alert_kind','');
  v_window := coalesce(p_alert->>'window_key','');
  v_entity := nullif(p_alert->>'entity_id','');
  v_cohort := nullif(p_alert->>'cohort_id','')::uuid;
  v_dest := coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery := coalesce(p_alert->>'delivery_status','recorded');
  v_code := nullif(p_alert->>'response_code','')::integer;
  v_meta := coalesce(p_alert->'metadata','{}'::jsonb);

  if v_kind not in (
       'autopilot_dry_run_would_promote',
       'autopilot_dry_run_would_block',
       'cohort_promotion_audit_exported'
     )
     or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
     or v_dest ~* '://|^https?'
     or v_delivery not in
       ('delivered','skipped_no_webhook','failed','recorded')
     or not public.phase49_marketing_ops_safe_metadata(v_meta) then
    raise exception 'Phase 49 ops alert contract is invalid or unsafe';
  end if;

  if v_entity is not null
    and not exists (select 1 from public.entities where entity_id = v_entity) then
    raise exception 'Phase 49 ops alert entity is unknown';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase49-v1',
    'alert_kind',v_kind,
    'entity_id',v_entity,
    'cohort_id',v_cohort,
    'window_key',v_window,
    'severity','critical',
    'destination_key',v_dest,
    'delivery_status',v_delivery,
    'response_code',v_code
  )::text);

  insert into public.os_marketing_revenue_phase49_ops_alerts(
    entity_id,cohort_id,alert_kind,window_key,severity,destination_key,
    delivery_status,response_code,metrics_sha256,metadata)
  values (
    v_entity,v_cohort,v_kind,v_window,'critical',v_dest,
    v_delivery,v_code,v_hash,
    v_meta || jsonb_build_object('contract_version','phase49-v1'))
  on conflict (window_key) do nothing
  returning alert_id, delivery_status into v_id, v_status;

  if v_id is null then
    select alert_id, delivery_status into v_id, v_status
    from public.os_marketing_revenue_phase49_ops_alerts
    where window_key = v_window;
    return jsonb_build_object(
      'version','phase49-v1',
      'alert_id',v_id,
      'window_key',v_window,
      'delivery_status',v_status,
      'inserted',false);
  end if;

  return jsonb_build_object(
    'version','phase49-v1',
    'alert_id',v_id,
    'window_key',v_window,
    'delivery_status',v_status,
    'inserted',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Hub report: dry-run health, audit export visibility, alerts
-- ---------------------------------------------------------------------------
create or replace function public.get_marketing_revenue_phase49_ops_report(
  p_entity_id text default null,
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
  v_dry_runs jsonb;
  v_exports jsonb;
  v_alerts jsonb;
  v_would_promote integer := 0;
  v_would_block integer := 0;
  v_would_wait integer := 0;
  v_exports_count integer := 0;
  v_dry_run_health text := 'unknown';
  v_audit_export_health text := 'unknown';
  v_alert_delivery text := 'none';
  v_failed boolean := false;
  v_skipped boolean := false;
  v_delivered boolean := false;
  v_recorded boolean := false;
begin
  select count(*) filter (where predicted_status = 'would_promote'),
    count(*) filter (where predicted_status = 'would_block'),
    count(*) filter (where predicted_status = 'would_wait')
  into v_would_promote, v_would_block, v_would_wait
  from public.os_marketing_revenue_autopilot_dry_run_snapshots d
  join public.os_marketing_revenue_promotion_cohorts c
    on c.cohort_id = d.cohort_id
  where d.created_at >= v_since
    and (
      p_entity_id is null
      or cardinality(c.entity_ids) = 0
      or p_entity_id = any (c.entity_ids)
    );

  select count(*)::integer into v_exports_count
  from public.os_marketing_revenue_cohort_promotion_audit_exports e
  where e.created_at >= v_since
    and (p_entity_id is null or e.entity_id = p_entity_id or e.entity_id is null);

  if v_would_promote + v_would_block + v_would_wait = 0 then
    v_dry_run_health := 'unknown';
  elsif v_would_block = 0 then
    v_dry_run_health := 'healthy';
  elsif v_would_promote > 0 then
    v_dry_run_health := 'watch';
  else
    v_dry_run_health := 'critical';
  end if;

  if v_exports_count = 0 then
    v_audit_export_health := 'unknown';
  else
    v_audit_export_health := 'healthy';
  end if;

  select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at desc), '[]'::jsonb)
  into v_dry_runs
  from (
    select dry_run_id, cohort_id, gate_passed, consecutive_healthy_windows,
      windows_required, predicted_status, block_reason, metrics_sha256, created_at
    from public.os_marketing_revenue_autopilot_dry_run_snapshots
    where created_at >= v_since
    order by created_at desc
    limit 50
  ) d;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb)
  into v_exports
  from (
    select export_id, export_key, entity_id, window_days, promotions_included,
      autopilot_runs_included, dry_run_snapshots_included, export_sha256,
      metrics_sha256, created_at
    from public.os_marketing_revenue_cohort_promotion_audit_exports
    where created_at >= v_since
    order by created_at desc
    limit 20
  ) e;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
  into v_alerts
  from (
    select alert_id, entity_id, cohort_id, alert_kind, window_key, severity,
      destination_key, delivery_status, response_code, metrics_sha256, created_at
    from public.os_marketing_revenue_phase49_ops_alerts
    order by created_at desc
    limit 20
  ) a;

  select
    bool_or(x.delivery_status = 'failed'),
    bool_or(x.delivery_status = 'skipped_no_webhook'),
    bool_or(x.delivery_status = 'delivered'),
    bool_or(x.delivery_status = 'recorded')
  into v_failed, v_skipped, v_delivered, v_recorded
  from public.os_marketing_revenue_phase49_ops_alerts x
  where x.created_at >= now() - interval '7 days';

  if coalesce(v_failed, false) then
    v_alert_delivery := 'failed';
  elsif coalesce(v_skipped, false) then
    v_alert_delivery := 'skipped_no_webhook';
  elsif coalesce(v_delivered, false) then
    v_alert_delivery := 'delivered';
  elsif coalesce(v_recorded, false) then
    v_alert_delivery := 'recorded';
  else
    v_alert_delivery := 'none';
  end if;

  return jsonb_build_object(
    'version','phase49-v1',
    'window_days',v_days,
    'dry_run_health',v_dry_run_health,
    'audit_export_health',v_audit_export_health,
    'alert_delivery',v_alert_delivery,
    'would_promote_count',v_would_promote,
    'would_block_count',v_would_block,
    'would_wait_count',v_would_wait,
    'audit_exports_count',v_exports_count,
    'dry_run_snapshots',coalesce(v_dry_runs,'[]'::jsonb),
    'audit_exports',coalesce(v_exports,'[]'::jsonb),
    'alerts',coalesce(v_alerts,'[]'::jsonb),
    'destination_key','ops_alerts',
    'never_auto_approves_money',true
  );
end;
$$;

revoke all on function public.phase49_marketing_ops_safe_metadata(jsonb)
  from public, anon, authenticated;
revoke all on function public.record_marketing_autopilot_dry_run_snapshot_phase49(jsonb)
  from public, anon, authenticated;
revoke all on function public.export_marketing_cohort_promotion_audit_phase49(jsonb)
  from public, anon, authenticated;
revoke all on function public.list_marketing_revenue_phase49_critical_windows(text,integer,integer)
  from public, anon, authenticated;
revoke all on function public.record_marketing_revenue_phase49_ops_alert(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_marketing_revenue_phase49_ops_report(text,integer)
  from public, anon, authenticated;

grant execute on function public.phase49_marketing_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.list_marketing_revenue_phase49_critical_windows(text,integer,integer)
  to authenticated, service_role;
grant execute on function public.get_marketing_revenue_phase49_ops_report(text,integer)
  to authenticated, service_role;

grant execute on function public.record_marketing_autopilot_dry_run_snapshot_phase49(jsonb)
  to service_role;
grant execute on function public.export_marketing_cohort_promotion_audit_phase49(jsonb)
  to service_role;
grant execute on function public.record_marketing_revenue_phase49_ops_alert(jsonb)
  to service_role;
grant execute on function public.os_sha256_hex(text)
  to authenticated, service_role;
