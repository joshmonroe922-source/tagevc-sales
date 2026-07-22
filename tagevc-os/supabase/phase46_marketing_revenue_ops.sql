-- Phase 46: marketing revenue auto-reject promotion gates, rule performance
-- snapshots, and webhook reliability trends over Phase 45 evidence.
-- Apply after phase45_marketing_revenue_ops.sql. Safe to re-run.
-- Never stores secret values — hashes, counts, statuses, and safe metadata only.
-- Never mutates snapshot retirement tables. NEVER auto-approves money corrections.

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
-- Append-only auto-reject promotion evidence (gate + activate)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_auto_reject_promotions (
  promotion_id uuid primary key default gen_random_uuid(),
  rule_version_id uuid
    references public.os_marketing_revenue_auto_reject_rule_versions(version_id),
  version_no integer check (version_no is null or version_no >= 1),
  webhook_slo_windows_required integer not null
    check (webhook_slo_windows_required between 1 and 30),
  webhook_slo_windows_healthy integer not null
    check (webhook_slo_windows_healthy >= 0),
  promotion_status text not null check (promotion_status in
    ('blocked','promoted','rejected')),
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
    (promotion_status = 'promoted' and rule_version_id is not null
      and version_no is not null and block_reason is null)
    or (promotion_status in ('blocked','rejected'))
  )
);

create index if not exists os_mkt_rev_auto_reject_promo_created_idx
  on public.os_marketing_revenue_auto_reject_promotions
    (created_at desc);
create index if not exists os_mkt_rev_auto_reject_promo_status_idx
  on public.os_marketing_revenue_auto_reject_promotions
    (promotion_status, created_at desc);

alter table public.os_marketing_revenue_auto_reject_promotions
  enable row level security;

-- ---------------------------------------------------------------------------
-- Append-only auto-reject rule performance snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_auto_reject_performance_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text references public.entities(entity_id),
  rule_version_id uuid
    references public.os_marketing_revenue_auto_reject_rule_versions(version_id),
  rule_key text not null
    check (rule_key ~ '^[a-z][a-z0-9_]{2,62}$'),
  version_no integer,
  auto_reject_count integer not null check (auto_reject_count >= 0),
  validation_pass_count integer not null check (validation_pass_count >= 0),
  fail_count integer not null check (fail_count >= 0),
  auto_reject_rate numeric(8,4),
  validation_pass_rate numeric(8,4),
  fail_rate numeric(8,4),
  precision_rate numeric(8,4),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (not (metadata ?| array[
    'authorization','cookie','set-cookie','token','secret','signature','jwt',
    'credential','password','payload','body','value','env_value','url'
  ]))
);

create index if not exists os_mkt_rev_auto_reject_perf_entity_idx
  on public.os_marketing_revenue_auto_reject_performance_snapshots
    (entity_id, created_at desc);
create index if not exists os_mkt_rev_auto_reject_perf_rule_idx
  on public.os_marketing_revenue_auto_reject_performance_snapshots
    (rule_key, created_at desc);

alter table public.os_marketing_revenue_auto_reject_performance_snapshots
  enable row level security;

-- ---------------------------------------------------------------------------
-- Append-only webhook reliability trend snapshots (over Phase 45 SLOs)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_webhook_reliability_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text references public.entities(entity_id),
  window_start timestamptz not null,
  window_end timestamptz not null,
  rolling_success_rate numeric(8,4),
  consecutive_healthy_windows integer not null
    check (consecutive_healthy_windows >= 0),
  windows_sampled integer not null check (windows_sampled >= 0),
  severity text not null check (severity in ('healthy','warning','critical')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (window_end >= window_start),
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (not (metadata ?| array[
    'authorization','cookie','set-cookie','token','secret','signature','jwt',
    'credential','password','payload','body','value','env_value','url'
  ]))
);

create index if not exists os_mkt_rev_webhook_rel_entity_idx
  on public.os_marketing_revenue_webhook_reliability_snapshots
    (entity_id, created_at desc);
create index if not exists os_mkt_rev_webhook_rel_sev_idx
  on public.os_marketing_revenue_webhook_reliability_snapshots
    (severity, created_at desc);

alter table public.os_marketing_revenue_webhook_reliability_snapshots
  enable row level security;

-- ---------------------------------------------------------------------------
-- Append-only Phase 46 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_phase46_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities(entity_id),
  source_id uuid references public.os_marketing_revenue_sources(source_id),
  alert_kind text not null check (alert_kind in
    ('auto_reject_promotion_blocked','auto_reject_promoted',
     'webhook_reliability_degraded','rule_performance_anomaly')),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null check (severity = 'critical'),
  destination_key text not null
    check (destination_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  delivery_status text not null check (delivery_status in
    ('delivered','skipped_no_webhook','failed','recorded')),
  response_code integer check (response_code is null or response_code between 100 and 599),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (not (metadata ?| array[
    'authorization','cookie','set-cookie','token','secret','signature','jwt',
    'credential','password','payload','body','value','env_value','url'
  ]))
);

create index if not exists os_mkt_rev_p46_ops_alert_entity_idx
  on public.os_marketing_revenue_phase46_ops_alerts
    (entity_id, created_at desc);
create index if not exists os_mkt_rev_p46_ops_alert_kind_idx
  on public.os_marketing_revenue_phase46_ops_alerts
    (alert_kind, created_at desc);

alter table public.os_marketing_revenue_phase46_ops_alerts
  enable row level security;

do $$
begin
  revoke all on public.os_marketing_revenue_auto_reject_promotions
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_auto_reject_promotions from service_role;
  grant select on public.os_marketing_revenue_auto_reject_promotions
    to service_role;

  revoke all on public.os_marketing_revenue_auto_reject_performance_snapshots
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_auto_reject_performance_snapshots
    from service_role;
  grant select on public.os_marketing_revenue_auto_reject_performance_snapshots
    to service_role;

  revoke all on public.os_marketing_revenue_webhook_reliability_snapshots
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_webhook_reliability_snapshots
    from service_role;
  grant select on public.os_marketing_revenue_webhook_reliability_snapshots
    to service_role;

  revoke all on public.os_marketing_revenue_phase46_ops_alerts
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_phase46_ops_alerts from service_role;
  grant select on public.os_marketing_revenue_phase46_ops_alerts
    to service_role;
end $$;

create or replace function public.prevent_marketing_revenue_phase46_ops_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  raise exception 'Marketing revenue Phase 46 ops evidence is append-only';
end;
$$;

drop trigger if exists os_mkt_rev_auto_reject_promo_immutable
  on public.os_marketing_revenue_auto_reject_promotions;
create trigger os_mkt_rev_auto_reject_promo_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_auto_reject_promotions
  for each statement
  execute function public.prevent_marketing_revenue_phase46_ops_mutation();

drop trigger if exists os_mkt_rev_auto_reject_perf_immutable
  on public.os_marketing_revenue_auto_reject_performance_snapshots;
create trigger os_mkt_rev_auto_reject_perf_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_auto_reject_performance_snapshots
  for each statement
  execute function public.prevent_marketing_revenue_phase46_ops_mutation();

drop trigger if exists os_mkt_rev_webhook_rel_immutable
  on public.os_marketing_revenue_webhook_reliability_snapshots;
create trigger os_mkt_rev_webhook_rel_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_webhook_reliability_snapshots
  for each statement
  execute function public.prevent_marketing_revenue_phase46_ops_mutation();

drop trigger if exists os_mkt_rev_p46_ops_alert_immutable
  on public.os_marketing_revenue_phase46_ops_alerts;
create trigger os_mkt_rev_p46_ops_alert_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_phase46_ops_alerts
  for each statement
  execute function public.prevent_marketing_revenue_phase46_ops_mutation();

create or replace function public.phase46_marketing_ops_safe_metadata(p_detail jsonb)
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

create or replace function public.phase46_default_promotion_thresholds()
returns jsonb
language sql
immutable
parallel safe
as $$
  select jsonb_build_object(
    'webhook_slo_windows_required', 3,
    'webhook_success_rate_warn', 0.9500,
    'webhook_success_rate_critical', 0.8000,
    'rule_fail_rate_warn', 0.1000,
    'rule_fail_rate_critical', 0.2500,
    'rule_auto_reject_rate_warn', 0.5000,
    'rule_auto_reject_rate_critical', 0.7500
  );
$$;

-- ---------------------------------------------------------------------------
-- Gate: N consecutive healthy Phase 45 webhook delivery SLO snapshots
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_marketing_auto_reject_promotion_gate_phase46(
  p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_entity text;
  v_required integer;
  v_thresholds jsonb;
  v_defaults jsonb := public.phase46_default_promotion_thresholds();
  v_lookback integer;
  v_healthy integer := 0;
  v_sampled integer := 0;
  v_row record;
  v_pass boolean := false;
  v_reason text;
  v_latest_severity text;
  v_latest_rate numeric;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Promotion gate payload must be a JSON object';
  end if;

  v_entity := nullif(p_payload->>'entity_id','');
  v_thresholds := public.phase45_active_auto_reject_thresholds()
    || v_defaults
    || coalesce(p_payload->'thresholds','{}'::jsonb);
  v_required := least(greatest(coalesce(
    nullif(p_payload->>'webhook_slo_windows_required','')::integer,
    (v_thresholds->>'webhook_slo_windows_required')::integer,
    3), 1), 30);
  v_lookback := least(greatest(v_required * 3, v_required), 90);

  for v_row in
    select s.severity, s.success_rate, s.created_at, s.snapshot_id
    from public.os_marketing_revenue_webhook_delivery_slo_snapshots s
    where (v_entity is null or s.entity_id = v_entity)
    order by s.created_at desc, s.snapshot_id desc
    limit v_lookback
  loop
    v_sampled := v_sampled + 1;
    if v_sampled = 1 then
      v_latest_severity := v_row.severity;
      v_latest_rate := v_row.success_rate;
    end if;
    if v_row.severity is not distinct from 'healthy' then
      v_healthy := v_healthy + 1;
    else
      -- Consecutive streak ends at first non-healthy window.
      exit;
    end if;
    if v_healthy >= v_required then
      exit;
    end if;
  end loop;

  v_pass := (v_healthy >= v_required);

  if v_sampled = 0 then
    v_reason := 'No webhook delivery SLO snapshots available for promotion gate';
  elsif not v_pass then
    v_reason := 'Webhook delivery SLOs lack '
      || v_required::text
      || ' consecutive healthy cooldown windows (healthy='
      || v_healthy::text
      || ', sampled='
      || v_sampled::text
      || ')';
  else
    v_reason := null;
  end if;

  return jsonb_build_object(
    'version','phase46-v1',
    'gate_passed',v_pass,
    'entity_id',v_entity,
    'webhook_slo_windows_required',v_required,
    'webhook_slo_windows_healthy',v_healthy,
    'windows_sampled',v_sampled,
    'latest_severity',v_latest_severity,
    'latest_success_rate',v_latest_rate,
    'block_reason',v_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- Promote: activate Phase 45 rule ONLY when webhook SLO gate passes
-- ---------------------------------------------------------------------------
create or replace function public.promote_marketing_auto_reject_rule_phase46(
  p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_gate jsonb;
  v_required integer;
  v_healthy integer;
  v_reason text;
  v_actor uuid;
  v_entity text;
  v_meta jsonb;
  v_hash text;
  v_promo_id uuid;
  v_activated jsonb;
  v_alert_window text;
  v_status text;
  v_version_id uuid;
  v_version_no integer;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Auto-reject rule promotion must be a JSON object';
  end if;

  v_actor := nullif(p_payload->>'created_by','')::uuid;
  v_entity := nullif(p_payload->>'entity_id','');
  v_meta := coalesce(p_payload->'metadata','{}'::jsonb);

  if v_actor is null
    or not public.phase46_marketing_ops_safe_metadata(v_meta) then
    raise exception 'Auto-reject rule promotion requires actor and safe metadata';
  end if;

  v_gate := public.evaluate_marketing_auto_reject_promotion_gate_phase46(
    jsonb_build_object(
      'entity_id',v_entity,
      'webhook_slo_windows_required',p_payload->>'webhook_slo_windows_required',
      'thresholds',coalesce(p_payload->'thresholds','{}'::jsonb)
    ));
  v_required := coalesce((v_gate->>'webhook_slo_windows_required')::integer,3);
  v_healthy := coalesce((v_gate->>'webhook_slo_windows_healthy')::integer,0);
  v_reason := v_gate->>'block_reason';

  if coalesce((v_gate->>'gate_passed')::boolean,false) is not true then
    v_status := 'blocked';
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase46-v1',
      'kind','auto_reject_promotion_blocked',
      'proposed_version_id',p_payload->>'proposed_version_id',
      'required',v_required,
      'healthy',v_healthy,
      'block_reason',v_reason,
      'actor_id',v_actor
    )::text);

    insert into public.os_marketing_revenue_auto_reject_promotions(
      rule_version_id,version_no,webhook_slo_windows_required,
      webhook_slo_windows_healthy,promotion_status,block_reason,
      metrics_sha256,metadata,actor_id)
    values (
      null,null,v_required,v_healthy,'blocked',left(coalesce(v_reason,''),500),
      v_hash,
      v_meta || jsonb_build_object(
        'contract_version','phase46-v1',
        'gate',v_gate,
        'proposed_version_id',p_payload->>'proposed_version_id'),
      v_actor)
    returning promotion_id into v_promo_id;

    if v_entity is not null then
      v_alert_window := left(
        'promoblock:' || v_entity || ':' || v_promo_id::text, 200);
      insert into public.os_marketing_revenue_phase46_ops_alerts(
        entity_id,source_id,alert_kind,window_key,severity,destination_key,
        delivery_status,response_code,metrics_sha256,metadata)
      values (
        v_entity,null,'auto_reject_promotion_blocked',v_alert_window,'critical',
        'ops_alerts','recorded',null,v_hash,
        jsonb_build_object(
          'contract_version','phase46-v1',
          'promotion_id',v_promo_id,
          'required',v_required,
          'healthy',v_healthy
        ))
      on conflict (window_key) do nothing;
    end if;

    return jsonb_build_object(
      'version','phase46-v1',
      'promotion_id',v_promo_id,
      'promotion_status','blocked',
      'gate',v_gate,
      'block_reason',v_reason);
  end if;

  -- Gate passed: wrap Phase 45 activate (maker-checker + never auto-approve money).
  v_activated := public.activate_marketing_auto_reject_rule_phase45(p_payload);
  v_version_id := nullif(v_activated->>'version_id','')::uuid;
  v_version_no := nullif(v_activated->>'version_no','')::integer;
  v_status := 'promoted';

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase46-v1',
    'kind','auto_reject_promoted',
    'rule_version_id',v_version_id,
    'version_no',v_version_no,
    'required',v_required,
    'healthy',v_healthy,
    'actor_id',v_actor
  )::text);

  insert into public.os_marketing_revenue_auto_reject_promotions(
    rule_version_id,version_no,webhook_slo_windows_required,
    webhook_slo_windows_healthy,promotion_status,block_reason,
    metrics_sha256,metadata,actor_id)
  values (
    v_version_id,v_version_no,v_required,v_healthy,'promoted',null,v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase46-v1',
      'gate',v_gate,
      'activation',v_activated),
    v_actor)
  returning promotion_id into v_promo_id;

  if v_entity is not null then
    v_alert_window := left(
      'promoted:' || v_entity || ':' || v_promo_id::text, 200);
    insert into public.os_marketing_revenue_phase46_ops_alerts(
      entity_id,source_id,alert_kind,window_key,severity,destination_key,
      delivery_status,response_code,metrics_sha256,metadata)
    values (
      v_entity,null,'auto_reject_promoted',v_alert_window,'critical',
      'ops_alerts','recorded',null,v_hash,
      jsonb_build_object(
        'contract_version','phase46-v1',
        'promotion_id',v_promo_id,
        'rule_version_id',v_version_id,
        'version_no',v_version_no
      ))
    on conflict (window_key) do nothing;
  end if;

  return jsonb_build_object(
    'version','phase46-v1',
    'promotion_id',v_promo_id,
    'promotion_status',v_status,
    'gate',v_gate,
    'activation',v_activated,
    'rule_version_id',v_version_id,
    'version_no',v_version_no);
end;
$$;

-- ---------------------------------------------------------------------------
-- Auto-reject rule performance snapshot (precision-ish rates)
-- ---------------------------------------------------------------------------
create or replace function public.record_marketing_auto_reject_performance_snapshot_phase46(
  p_entity_id text,
  p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_days integer := least(greatest(coalesce(p_days,30),1),90);
  v_since timestamptz := now() - make_interval(
    days => least(greatest(coalesce(p_days,30),1),90));
  v_inserted integer := 0;
  v_row record;
  v_active public.os_marketing_revenue_auto_reject_rule_versions%rowtype;
  v_total integer;
  v_auto_rate numeric;
  v_pass_rate numeric;
  v_fail_rate numeric;
  v_precision numeric;
  v_hash text;
begin
  select * into v_active
  from public.os_marketing_revenue_auto_reject_rule_versions r
  where r.status = 'active'
    and r.rule_key = 'correction_contract_v1'
  order by r.version_no desc, r.created_at desc
  limit 1;

  for v_row in
    with entities as (
      select distinct s.entity_id
      from public.os_marketing_revenue_sources s
      where p_entity_id is null or s.entity_id = p_entity_id
    ),
    validations as (
      select v.entity_id,
        count(*) filter (where v.validation_status = 'auto_rejected')::integer
          auto_reject_count,
        count(*) filter (where v.validation_status = 'passed')::integer
          validation_pass_count,
        count(*) filter (where v.validation_status = 'failed')::integer
          fail_count
      from public.os_marketing_revenue_correction_validations v
      where v.created_at >= v_since
        and (p_entity_id is null or v.entity_id = p_entity_id)
      group by v.entity_id
    )
    select e.entity_id,
      coalesce(v.auto_reject_count,0) auto_reject_count,
      coalesce(v.validation_pass_count,0) validation_pass_count,
      coalesce(v.fail_count,0) fail_count
    from entities e
    left join validations v on v.entity_id = e.entity_id
  loop
    v_total := v_row.auto_reject_count + v_row.validation_pass_count
      + v_row.fail_count;
    if v_total = 0 then
      v_auto_rate := null;
      v_pass_rate := null;
      v_fail_rate := null;
      v_precision := null;
    else
      v_auto_rate := round(
        (v_row.auto_reject_count::numeric / v_total::numeric), 4);
      v_pass_rate := round(
        (v_row.validation_pass_count::numeric / v_total::numeric), 4);
      v_fail_rate := round(
        (v_row.fail_count::numeric / v_total::numeric), 4);
      -- Precision-ish: share of non-pass outcomes that were auto-rejected
      -- (fail-closed signal), null when no reject/fail outcomes exist.
      if (v_row.auto_reject_count + v_row.fail_count) = 0 then
        v_precision := null;
      else
        v_precision := round(
          (v_row.auto_reject_count::numeric
            / (v_row.auto_reject_count + v_row.fail_count)::numeric), 4);
      end if;
    end if;

    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase46-v1',
      'kind','auto_reject_performance',
      'entity_id',v_row.entity_id,
      'rule_key',coalesce(v_active.rule_key,'correction_contract_v1'),
      'version_no',v_active.version_no,
      'auto_reject_count',v_row.auto_reject_count,
      'validation_pass_count',v_row.validation_pass_count,
      'fail_count',v_row.fail_count,
      'auto_reject_rate',v_auto_rate,
      'validation_pass_rate',v_pass_rate,
      'fail_rate',v_fail_rate,
      'precision_rate',v_precision
    )::text);

    insert into public.os_marketing_revenue_auto_reject_performance_snapshots(
      entity_id,rule_version_id,rule_key,version_no,auto_reject_count,
      validation_pass_count,fail_count,auto_reject_rate,validation_pass_rate,
      fail_rate,precision_rate,metrics_sha256,metadata)
    values (
      v_row.entity_id,v_active.version_id,
      coalesce(v_active.rule_key,'correction_contract_v1'),
      v_active.version_no,v_row.auto_reject_count,v_row.validation_pass_count,
      v_row.fail_count,v_auto_rate,v_pass_rate,v_fail_rate,v_precision,v_hash,
      jsonb_build_object(
        'contract_version','phase46-v1',
        'metric','auto_reject_performance',
        'window_days',v_days
      ));
    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object(
    'version','phase46-v1',
    'window_days',v_days,
    'snapshots_recorded',v_inserted);
end;
$$;

-- ---------------------------------------------------------------------------
-- Webhook reliability trends from Phase 45 delivery SLO snapshots
-- ---------------------------------------------------------------------------
create or replace function public.record_marketing_webhook_reliability_snapshot_phase46(
  p_entity_id text,
  p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_days integer := least(greatest(coalesce(p_days,30),1),90);
  v_since timestamptz := now() - make_interval(
    days => least(greatest(coalesce(p_days,30),1),90));
  v_defaults jsonb := public.phase46_default_promotion_thresholds();
  v_thresholds jsonb := public.phase45_active_auto_reject_thresholds() || v_defaults;
  v_required integer := least(greatest(coalesce(
    (v_thresholds->>'webhook_slo_windows_required')::integer,3),1),30);
  v_warn numeric := coalesce((v_thresholds->>'webhook_success_rate_warn')::numeric,0.9500);
  v_crit numeric := coalesce((v_thresholds->>'webhook_success_rate_critical')::numeric,0.8000);
  v_inserted integer := 0;
  v_entity text;
  v_consec integer;
  v_sampled integer;
  v_rolling numeric;
  v_severity text;
  v_hash text;
  v_slo record;
begin
  for v_entity in
    select distinct s.entity_id
    from public.os_marketing_revenue_webhook_delivery_slo_snapshots s
    where s.created_at >= v_since
      and s.entity_id is not null
      and (p_entity_id is null or s.entity_id = p_entity_id)
  loop
    v_consec := 0;
    v_sampled := 0;
    v_rolling := null;

    select
      case
        when sum(coalesce(x.delivered_count,0) + coalesce(x.failed_count,0)) = 0
          then null
        else round(
          (sum(coalesce(x.delivered_count,0))::numeric
            / sum(coalesce(x.delivered_count,0) + coalesce(x.failed_count,0))::numeric),
          4)
      end
    into v_rolling
    from public.os_marketing_revenue_webhook_delivery_slo_snapshots x
    where x.entity_id = v_entity
      and x.created_at >= v_since;

    for v_slo in
      select s.severity
      from public.os_marketing_revenue_webhook_delivery_slo_snapshots s
      where s.entity_id = v_entity
        and s.created_at >= v_since
      order by s.created_at desc, s.snapshot_id desc
      limit greatest(v_required * 3, 10)
    loop
      v_sampled := v_sampled + 1;
      if v_slo.severity is not distinct from 'healthy' then
        v_consec := v_consec + 1;
      else
        exit;
      end if;
    end loop;

    if v_consec < v_required
      or (v_rolling is not null and v_rolling < v_crit) then
      v_severity := 'critical';
    elsif v_rolling is not null and v_rolling < v_warn then
      v_severity := 'warning';
    else
      v_severity := 'healthy';
    end if;

    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase46-v1',
      'kind','webhook_reliability',
      'entity_id',v_entity,
      'rolling_success_rate',v_rolling,
      'consecutive_healthy_windows',v_consec,
      'windows_sampled',v_sampled,
      'required',v_required,
      'severity',v_severity
    )::text);

    insert into public.os_marketing_revenue_webhook_reliability_snapshots(
      entity_id,window_start,window_end,rolling_success_rate,
      consecutive_healthy_windows,windows_sampled,severity,metrics_sha256,metadata)
    values (
      v_entity,v_since,now(),v_rolling,v_consec,v_sampled,v_severity,v_hash,
      jsonb_build_object(
        'contract_version','phase46-v1',
        'metric','webhook_reliability',
        'windows_required',v_required,
        'warning_threshold',v_warn,
        'critical_threshold',v_crit
      ));
    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object(
    'version','phase46-v1',
    'window_days',v_days,
    'snapshots_recorded',v_inserted);
end;
$$;

-- ---------------------------------------------------------------------------
-- List critical Phase 46 windows needing idempotent ops alerts
-- ---------------------------------------------------------------------------
create or replace function public.list_marketing_revenue_phase46_critical_windows(
  p_entity_id text,
  p_days integer default 30,
  p_window_hours integer default 24)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_days integer := least(greatest(coalesce(p_days,30),1),90);
  v_hours integer := least(greatest(coalesce(p_window_hours,24),1),168);
  v_bucket text;
  v_since timestamptz := now() - make_interval(
    days => least(greatest(coalesce(p_days,30),1),90));
  v_defaults jsonb := public.phase46_default_promotion_thresholds();
  v_thresholds jsonb := public.phase45_active_auto_reject_thresholds() || v_defaults;
  v_fail_crit numeric := coalesce(
    (v_thresholds->>'rule_fail_rate_critical')::numeric,0.2500);
  v_auto_crit numeric := coalesce(
    (v_thresholds->>'rule_auto_reject_rate_critical')::numeric,0.7500);
  v_rel jsonb;
  v_perf jsonb;
begin
  v_bucket := to_char(
    to_timestamp(
      (floor(extract(epoch from now()) / (v_hours * 3600.0))
        * (v_hours * 3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','webhook_reliability_degraded',
      'entity_id',l.entity_id,
      'source_id',null,
      'window_key','whrel:'||l.entity_id||':'||v_bucket||'h'||v_hours::text,
      'severity','critical',
      'metrics_sha256',l.metrics_sha256,
      'snapshot_id',l.snapshot_id,
      'rolling_success_rate',l.rolling_success_rate,
      'consecutive_healthy_windows',l.consecutive_healthy_windows
    ) order by l.entity_id)
    from (
      select s.*,
        row_number() over (
          partition by s.entity_id
          order by s.created_at desc, s.snapshot_id desc
        ) rn
      from public.os_marketing_revenue_webhook_reliability_snapshots s
      where s.created_at >= v_since
        and s.severity = 'critical'
        and (p_entity_id is null or s.entity_id = p_entity_id)
    ) l
    where l.rn = 1
      and not exists (
        select 1 from public.os_marketing_revenue_phase46_ops_alerts x
        where x.window_key =
          'whrel:'||l.entity_id||':'||v_bucket||'h'||v_hours::text
      )
    limit 50
  ), '[]'::jsonb) into v_rel;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','rule_performance_anomaly',
      'entity_id',l.entity_id,
      'source_id',null,
      'window_key','ruleperf:'||l.entity_id||':'||v_bucket||'h'||v_hours::text,
      'severity','critical',
      'metrics_sha256',l.metrics_sha256,
      'snapshot_id',l.snapshot_id,
      'fail_rate',l.fail_rate,
      'auto_reject_rate',l.auto_reject_rate,
      'precision_rate',l.precision_rate
    ) order by l.entity_id)
    from (
      select s.*,
        row_number() over (
          partition by s.entity_id
          order by s.created_at desc, s.snapshot_id desc
        ) rn
      from public.os_marketing_revenue_auto_reject_performance_snapshots s
      where s.created_at >= v_since
        and (p_entity_id is null or s.entity_id = p_entity_id)
        and (
          coalesce(s.fail_rate,0) >= v_fail_crit
          or coalesce(s.auto_reject_rate,0) >= v_auto_crit
        )
    ) l
    where l.rn = 1
      and not exists (
        select 1 from public.os_marketing_revenue_phase46_ops_alerts x
        where x.window_key =
          'ruleperf:'||l.entity_id||':'||v_bucket||'h'||v_hours::text
      )
    limit 50
  ), '[]'::jsonb) into v_perf;

  return jsonb_build_object(
    'version','phase46-v1',
    'window_days',v_days,
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',coalesce(v_rel,'[]'::jsonb) || coalesce(v_perf,'[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Record one critical Phase 46 ops alert after delivery attempt
-- ---------------------------------------------------------------------------
create or replace function public.record_marketing_revenue_phase46_ops_alert(
  p_alert jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_kind text;
  v_entity text;
  v_source uuid;
  v_window text;
  v_dest text;
  v_delivery text;
  v_code integer;
  v_hash text;
  v_meta jsonb;
  v_id uuid;
  v_status text;
begin
  if jsonb_typeof(coalesce(p_alert,'{}'::jsonb)) <> 'object' then
    raise exception 'Ops alert payload must be a JSON object';
  end if;

  v_kind := coalesce(p_alert->>'alert_kind','');
  v_entity := coalesce(p_alert->>'entity_id','');
  v_source := nullif(p_alert->>'source_id','')::uuid;
  v_window := coalesce(p_alert->>'window_key','');
  v_dest := coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery := coalesce(p_alert->>'delivery_status','recorded');
  v_code := nullif(p_alert->>'response_code','')::integer;
  v_meta := coalesce(p_alert->'metadata','{}'::jsonb);

  if v_kind not in
      ('auto_reject_promotion_blocked','auto_reject_promoted',
       'webhook_reliability_degraded','rule_performance_anomaly')
    or v_entity = ''
    or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
    or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
    or v_dest ~* '://|^https?'
    or v_delivery not in
      ('delivered','skipped_no_webhook','failed','recorded')
    or not public.phase46_marketing_ops_safe_metadata(v_meta) then
    raise exception 'Ops alert contract is invalid or unsafe';
  end if;

  if not exists (select 1 from public.entities where entity_id = v_entity) then
    raise exception 'Ops alert entity is unknown';
  end if;

  if v_source is not null and not exists (
    select 1 from public.os_marketing_revenue_sources
    where source_id = v_source and entity_id = v_entity
  ) then
    raise exception 'Ops alert source/entity mismatch';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase46-v1',
    'alert_kind',v_kind,
    'entity_id',v_entity,
    'source_id',v_source,
    'window_key',v_window,
    'severity','critical',
    'destination_key',v_dest,
    'delivery_status',v_delivery,
    'response_code',v_code
  )::text);

  insert into public.os_marketing_revenue_phase46_ops_alerts(
    entity_id,source_id,alert_kind,window_key,severity,destination_key,
    delivery_status,response_code,metrics_sha256,metadata)
  values (
    v_entity,v_source,v_kind,v_window,'critical',v_dest,
    v_delivery,v_code,v_hash,
    v_meta || jsonb_build_object('contract_version','phase46-v1'))
  on conflict (window_key) do nothing
  returning alert_id, delivery_status into v_id, v_status;

  if v_id is null then
    select alert_id, delivery_status into v_id, v_status
    from public.os_marketing_revenue_phase46_ops_alerts
    where window_key = v_window;
    return jsonb_build_object(
      'version','phase46-v1',
      'alert_id',v_id,
      'window_key',v_window,
      'delivery_status',v_status,
      'inserted',false);
  end if;

  return jsonb_build_object(
    'version','phase46-v1',
    'alert_id',v_id,
    'window_key',v_window,
    'delivery_status',v_status,
    'inserted',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Hub report: promotion gate, reliability, rule performance, alerts
-- ---------------------------------------------------------------------------
create or replace function public.get_marketing_revenue_phase46_ops_report(
  p_entity_id text,
  p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_days integer := least(greatest(coalesce(p_days,30),1),90);
  v_since timestamptz := now() - make_interval(
    days => least(greatest(coalesce(p_days,30),1),90));
  v_gate jsonb;
  v_promotions jsonb;
  v_perf jsonb;
  v_rel jsonb;
  v_alerts jsonb;
  v_gate_health text := 'unknown';
  v_rel_health text := 'unknown';
  v_perf_health text := 'unknown';
  v_alert_delivery text := 'none';
  v_defaults jsonb := public.phase46_default_promotion_thresholds();
  v_thresholds jsonb;
begin
  v_thresholds := public.phase45_active_auto_reject_thresholds() || v_defaults;
  v_gate := public.evaluate_marketing_auto_reject_promotion_gate_phase46(
    jsonb_build_object(
      'entity_id',p_entity_id,
      'thresholds',v_defaults
    ));

  if coalesce((v_gate->>'gate_passed')::boolean,false) then
    v_gate_health := 'healthy';
  elsif coalesce((v_gate->>'windows_sampled')::integer,0) = 0 then
    v_gate_health := 'unknown';
  else
    v_gate_health := 'critical';
  end if;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'promotion_id',p.promotion_id,
      'rule_version_id',p.rule_version_id,
      'version_no',p.version_no,
      'webhook_slo_windows_required',p.webhook_slo_windows_required,
      'webhook_slo_windows_healthy',p.webhook_slo_windows_healthy,
      'promotion_status',p.promotion_status,
      'block_reason',p.block_reason,
      'metrics_sha256',p.metrics_sha256,
      'created_at',p.created_at,
      'actor_id',p.actor_id
    ) order by p.created_at desc)
    from public.os_marketing_revenue_auto_reject_promotions p
    where p.created_at >= v_since
    limit 50
  ), '[]'::jsonb) into v_promotions;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'snapshot_id',l.snapshot_id,
      'entity_id',l.entity_id,
      'rule_version_id',l.rule_version_id,
      'rule_key',l.rule_key,
      'version_no',l.version_no,
      'auto_reject_count',l.auto_reject_count,
      'validation_pass_count',l.validation_pass_count,
      'fail_count',l.fail_count,
      'auto_reject_rate',l.auto_reject_rate,
      'validation_pass_rate',l.validation_pass_rate,
      'fail_rate',l.fail_rate,
      'precision_rate',l.precision_rate,
      'metrics_sha256',l.metrics_sha256,
      'created_at',l.created_at
    ) order by l.entity_id)
    from (
      select s.*,
        row_number() over (
          partition by s.entity_id
          order by s.created_at desc, s.snapshot_id desc
        ) rn
      from public.os_marketing_revenue_auto_reject_performance_snapshots s
      where s.created_at >= v_since
        and (p_entity_id is null or s.entity_id = p_entity_id)
    ) l
    where l.rn = 1
    limit 100
  ), '[]'::jsonb) into v_perf;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'snapshot_id',l.snapshot_id,
      'entity_id',l.entity_id,
      'window_start',l.window_start,
      'window_end',l.window_end,
      'rolling_success_rate',l.rolling_success_rate,
      'consecutive_healthy_windows',l.consecutive_healthy_windows,
      'windows_sampled',l.windows_sampled,
      'severity',l.severity,
      'metrics_sha256',l.metrics_sha256,
      'created_at',l.created_at
    ) order by l.severity, l.entity_id)
    from (
      select s.*,
        row_number() over (
          partition by s.entity_id
          order by s.created_at desc, s.snapshot_id desc
        ) rn
      from public.os_marketing_revenue_webhook_reliability_snapshots s
      where s.created_at >= v_since
        and (p_entity_id is null or s.entity_id = p_entity_id)
    ) l
    where l.rn = 1
    limit 100
  ), '[]'::jsonb) into v_rel;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_id',a.alert_id,
      'entity_id',a.entity_id,
      'source_id',a.source_id,
      'alert_kind',a.alert_kind,
      'window_key',a.window_key,
      'severity',a.severity,
      'destination_key',a.destination_key,
      'delivery_status',a.delivery_status,
      'response_code',a.response_code,
      'metrics_sha256',a.metrics_sha256,
      'created_at',a.created_at
    ) order by a.created_at desc)
    from public.os_marketing_revenue_phase46_ops_alerts a
    where a.created_at >= v_since
      and (p_entity_id is null or a.entity_id = p_entity_id)
    limit 50
  ), '[]'::jsonb) into v_alerts;

  select coalesce((
    select case
      when bool_or(x.severity = 'critical') then 'critical'
      when bool_or(x.severity = 'warning') then 'warning'
      when bool_or(x.severity = 'healthy') then 'healthy'
      else 'unknown'
    end
    from jsonb_to_recordset(coalesce(v_rel,'[]'::jsonb))
      as x(severity text)
  ), 'unknown') into v_rel_health;

  select coalesce((
    select case
      when bool_or(
        coalesce(x.fail_rate,0) >=
          coalesce((v_thresholds->>'rule_fail_rate_critical')::numeric,0.25)
        or coalesce(x.auto_reject_rate,0) >=
          coalesce((v_thresholds->>'rule_auto_reject_rate_critical')::numeric,0.75)
      ) then 'critical'
      when bool_or(
        coalesce(x.fail_rate,0) >=
          coalesce((v_thresholds->>'rule_fail_rate_warn')::numeric,0.10)
        or coalesce(x.auto_reject_rate,0) >=
          coalesce((v_thresholds->>'rule_auto_reject_rate_warn')::numeric,0.50)
      ) then 'warning'
      when bool_or(coalesce(x.auto_reject_count,0) >= 0) then 'healthy'
      else 'unknown'
    end
    from jsonb_to_recordset(coalesce(v_perf,'[]'::jsonb))
      as x(
        auto_reject_count integer,
        fail_rate numeric,
        auto_reject_rate numeric
      )
  ), 'unknown') into v_perf_health;

  select coalesce((
    select case
      when bool_or(x.delivery_status = 'failed') then 'failed'
      when bool_or(x.delivery_status = 'skipped_no_webhook') then 'skipped_no_webhook'
      when bool_or(x.delivery_status = 'delivered') then 'delivered'
      when bool_or(x.delivery_status = 'recorded') then 'recorded'
      else 'none'
    end
    from jsonb_to_recordset(coalesce(v_alerts,'[]'::jsonb))
      as x(delivery_status text)
  ), 'none') into v_alert_delivery;

  return jsonb_build_object(
    'version','phase46-v1',
    'window_days',v_days,
    'promotion_gate_health',v_gate_health,
    'webhook_reliability_health',v_rel_health,
    'rule_performance_health',v_perf_health,
    'alert_delivery',v_alert_delivery,
    'promotion_gate',v_gate,
    'thresholds',v_thresholds,
    'promotions',coalesce(v_promotions,'[]'::jsonb),
    'performance_snapshots',coalesce(v_perf,'[]'::jsonb),
    'reliability_snapshots',coalesce(v_rel,'[]'::jsonb),
    'alerts',coalesce(v_alerts,'[]'::jsonb),
    'destination_key','ops_alerts');
end;
$$;

revoke all on function public.prevent_marketing_revenue_phase46_ops_mutation()
  from public, anon, authenticated;
revoke all on function public.phase46_marketing_ops_safe_metadata(jsonb)
  from public, anon, authenticated;
revoke all on function public.phase46_default_promotion_thresholds()
  from public, anon, authenticated;
revoke all on function public.evaluate_marketing_auto_reject_promotion_gate_phase46(jsonb)
  from public, anon, authenticated;
revoke all on function public.promote_marketing_auto_reject_rule_phase46(jsonb)
  from public, anon, authenticated;
revoke all on function public.record_marketing_auto_reject_performance_snapshot_phase46(text,integer)
  from public, anon, authenticated;
revoke all on function public.record_marketing_webhook_reliability_snapshot_phase46(text,integer)
  from public, anon, authenticated;
revoke all on function public.list_marketing_revenue_phase46_critical_windows(text,integer,integer)
  from public, anon, authenticated;
revoke all on function public.record_marketing_revenue_phase46_ops_alert(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_marketing_revenue_phase46_ops_report(text,integer)
  from public, anon, authenticated;

grant execute on function public.phase46_marketing_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.phase46_default_promotion_thresholds()
  to authenticated, service_role;
grant execute on function public.evaluate_marketing_auto_reject_promotion_gate_phase46(jsonb)
  to authenticated, service_role;
grant execute on function public.list_marketing_revenue_phase46_critical_windows(text,integer,integer)
  to authenticated, service_role;
grant execute on function public.get_marketing_revenue_phase46_ops_report(text,integer)
  to authenticated, service_role;

grant execute on function public.promote_marketing_auto_reject_rule_phase46(jsonb)
  to service_role;
grant execute on function public.record_marketing_auto_reject_performance_snapshot_phase46(text,integer)
  to service_role;
grant execute on function public.record_marketing_webhook_reliability_snapshot_phase46(text,integer)
  to service_role;
grant execute on function public.record_marketing_revenue_phase46_ops_alert(jsonb)
  to service_role;
