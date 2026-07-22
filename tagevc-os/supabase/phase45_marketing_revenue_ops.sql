-- Phase 45: marketing revenue auto-reject rule tuning, webhook delivery SLOs,
-- and correction/validation workflow monitoring over Phase 43+44 evidence.
-- Apply after phase44_marketing_revenue_ops.sql. Safe to re-run.
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
-- Append-only auto-reject rule versions (activation = new row)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_auto_reject_rule_versions (
  version_id uuid primary key default gen_random_uuid(),
  version_no integer not null check (version_no >= 1),
  rule_key text not null
    check (rule_key ~ '^[a-z][a-z0-9_]{2,62}$'),
  thresholds jsonb not null default '{}'::jsonb,
  status text not null check (status in ('proposed','active')),
  proposed_version_id uuid
    references public.os_marketing_revenue_auto_reject_rule_versions(version_id),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  created_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  unique (rule_key, version_no),
  check (jsonb_typeof(thresholds) = 'object'),
  check (pg_column_size(thresholds) <= 2048),
  check (not (thresholds ?| array[
    'authorization','cookie','set-cookie','token','secret','signature','jwt',
    'credential','password','payload','body','value','env_value','url'
  ])),
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (not (metadata ?| array[
    'authorization','cookie','set-cookie','token','secret','signature','jwt',
    'credential','password','payload','body','value','env_value','url'
  ])),
  check (
    (status = 'proposed' and proposed_version_id is null)
    or (status = 'active')
  )
);

create index if not exists os_mkt_rev_auto_reject_rule_key_idx
  on public.os_marketing_revenue_auto_reject_rule_versions
    (rule_key, version_no desc);
create index if not exists os_mkt_rev_auto_reject_rule_active_idx
  on public.os_marketing_revenue_auto_reject_rule_versions
    (rule_key, created_at desc)
  where status = 'active';

alter table public.os_marketing_revenue_auto_reject_rule_versions
  enable row level security;

-- ---------------------------------------------------------------------------
-- Append-only webhook delivery SLO snapshots (Phase 43+44 alerts)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_webhook_delivery_slo_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text references public.entities(entity_id),
  window_start timestamptz not null,
  window_end timestamptz not null,
  delivered_count integer not null check (delivered_count >= 0),
  failed_count integer not null check (failed_count >= 0),
  skipped_count integer not null check (skipped_count >= 0),
  recorded_count integer not null check (recorded_count >= 0),
  success_rate numeric(8,4),
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

create index if not exists os_mkt_rev_webhook_slo_entity_idx
  on public.os_marketing_revenue_webhook_delivery_slo_snapshots
    (entity_id, created_at desc);
create index if not exists os_mkt_rev_webhook_slo_sev_idx
  on public.os_marketing_revenue_webhook_delivery_slo_snapshots
    (severity, created_at desc);

alter table public.os_marketing_revenue_webhook_delivery_slo_snapshots
  enable row level security;

-- ---------------------------------------------------------------------------
-- Append-only correction/validation workflow snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_correction_workflow_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text references public.entities(entity_id),
  pending_count integer not null check (pending_count >= 0),
  validated_passed integer not null check (validated_passed >= 0),
  validated_failed integer not null check (validated_failed >= 0),
  auto_rejected integer not null check (auto_rejected >= 0),
  oldest_pending_hours numeric,
  pass_rate numeric(8,4),
  auto_reject_rate numeric(8,4),
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

create index if not exists os_mkt_rev_corr_wf_entity_idx
  on public.os_marketing_revenue_correction_workflow_snapshots
    (entity_id, created_at desc);

alter table public.os_marketing_revenue_correction_workflow_snapshots
  enable row level security;

-- ---------------------------------------------------------------------------
-- Append-only Phase 45 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_phase45_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities(entity_id),
  source_id uuid references public.os_marketing_revenue_sources(source_id),
  alert_kind text not null check (alert_kind in
    ('webhook_delivery_critical','auto_reject_rule_tuned',
     'correction_workflow_stale','validation_fail_rate_elevated')),
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

create index if not exists os_mkt_rev_p45_ops_alert_entity_idx
  on public.os_marketing_revenue_phase45_ops_alerts
    (entity_id, created_at desc);
create index if not exists os_mkt_rev_p45_ops_alert_kind_idx
  on public.os_marketing_revenue_phase45_ops_alerts
    (alert_kind, created_at desc);

alter table public.os_marketing_revenue_phase45_ops_alerts
  enable row level security;

do $$
begin
  revoke all on public.os_marketing_revenue_auto_reject_rule_versions
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_auto_reject_rule_versions from service_role;
  grant select on public.os_marketing_revenue_auto_reject_rule_versions
    to service_role;

  revoke all on public.os_marketing_revenue_webhook_delivery_slo_snapshots
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_webhook_delivery_slo_snapshots from service_role;
  grant select on public.os_marketing_revenue_webhook_delivery_slo_snapshots
    to service_role;

  revoke all on public.os_marketing_revenue_correction_workflow_snapshots
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_correction_workflow_snapshots from service_role;
  grant select on public.os_marketing_revenue_correction_workflow_snapshots
    to service_role;

  revoke all on public.os_marketing_revenue_phase45_ops_alerts
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_phase45_ops_alerts from service_role;
  grant select on public.os_marketing_revenue_phase45_ops_alerts
    to service_role;
end $$;

create or replace function public.prevent_marketing_revenue_phase45_ops_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  raise exception 'Marketing revenue Phase 45 ops evidence is append-only';
end;
$$;

drop trigger if exists os_mkt_rev_auto_reject_rule_immutable
  on public.os_marketing_revenue_auto_reject_rule_versions;
create trigger os_mkt_rev_auto_reject_rule_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_auto_reject_rule_versions
  for each statement
  execute function public.prevent_marketing_revenue_phase45_ops_mutation();

drop trigger if exists os_mkt_rev_webhook_slo_immutable
  on public.os_marketing_revenue_webhook_delivery_slo_snapshots;
create trigger os_mkt_rev_webhook_slo_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_webhook_delivery_slo_snapshots
  for each statement
  execute function public.prevent_marketing_revenue_phase45_ops_mutation();

drop trigger if exists os_mkt_rev_corr_wf_immutable
  on public.os_marketing_revenue_correction_workflow_snapshots;
create trigger os_mkt_rev_corr_wf_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_correction_workflow_snapshots
  for each statement
  execute function public.prevent_marketing_revenue_phase45_ops_mutation();

drop trigger if exists os_mkt_rev_p45_ops_alert_immutable
  on public.os_marketing_revenue_phase45_ops_alerts;
create trigger os_mkt_rev_p45_ops_alert_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_phase45_ops_alerts
  for each statement
  execute function public.prevent_marketing_revenue_phase45_ops_mutation();

create or replace function public.phase45_marketing_ops_safe_metadata(p_detail jsonb)
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

-- Default thresholds matching Phase 44 fail-closed validation behavior.
create or replace function public.phase45_default_auto_reject_thresholds()
returns jsonb
language sql
immutable
parallel safe
as $$
  select jsonb_build_object(
    'min_reason_length', 10,
    'max_reason_length', 500,
    'auto_reject_on_contract_fail', true,
    'pending_queue_critical_count', 5,
    'pending_stale_hours', 24,
    'workflow_stale_hours', 48,
    'validation_fail_rate_warn', 0.1000,
    'validation_fail_rate_critical', 0.2500,
    'webhook_success_rate_warn', 0.9500,
    'webhook_success_rate_critical', 0.8000
  );
$$;

create or replace function public.phase45_active_auto_reject_thresholds(p_rule_key text default 'correction_contract_v1')
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_thresholds jsonb;
begin
  select thresholds into v_thresholds
  from public.os_marketing_revenue_auto_reject_rule_versions
  where rule_key = coalesce(nullif(p_rule_key,''),'correction_contract_v1')
    and status = 'active'
  order by version_no desc, created_at desc
  limit 1;

  if v_thresholds is null then
    return public.phase45_default_auto_reject_thresholds();
  end if;

  return public.phase45_default_auto_reject_thresholds() || v_thresholds;
end;
$$;

-- ---------------------------------------------------------------------------
-- Propose append-only auto-reject rule version (maker step)
-- ---------------------------------------------------------------------------
create or replace function public.propose_marketing_auto_reject_rule_phase45(
  p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rule_key text;
  v_thresholds jsonb;
  v_actor uuid;
  v_meta jsonb;
  v_next integer;
  v_hash text;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Auto-reject rule proposal must be a JSON object';
  end if;

  v_rule_key := coalesce(nullif(p_payload->>'rule_key',''),'correction_contract_v1');
  v_thresholds := coalesce(p_payload->'thresholds','{}'::jsonb);
  v_actor := nullif(p_payload->>'created_by','')::uuid;
  v_meta := coalesce(p_payload->'metadata','{}'::jsonb);

  if v_rule_key !~ '^[a-z][a-z0-9_]{2,62}$'
    or not public.phase45_marketing_ops_safe_metadata(v_thresholds)
    or not public.phase45_marketing_ops_safe_metadata(v_meta)
    or v_actor is null then
    raise exception 'Auto-reject rule proposal contract is invalid or unsafe';
  end if;

  -- Merge onto defaults and re-check safe keys only (no money approval knobs).
  v_thresholds := public.phase45_default_auto_reject_thresholds() || v_thresholds;
  if not public.phase45_marketing_ops_safe_metadata(v_thresholds) then
    raise exception 'Auto-reject thresholds failed safety checks';
  end if;

  select coalesce(max(version_no),0) + 1 into v_next
  from public.os_marketing_revenue_auto_reject_rule_versions
  where rule_key = v_rule_key;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase45-v1',
    'kind','auto_reject_rule_proposed',
    'rule_key',v_rule_key,
    'version_no',v_next,
    'thresholds',v_thresholds,
    'created_by',v_actor
  )::text);

  insert into public.os_marketing_revenue_auto_reject_rule_versions(
    version_no,rule_key,thresholds,status,proposed_version_id,
    metrics_sha256,created_by,metadata)
  values (
    v_next,v_rule_key,v_thresholds,'proposed',null,v_hash,v_actor,
    v_meta || jsonb_build_object('contract_version','phase45-v1','lifecycle','proposed'))
  returning version_id into v_id;

  return jsonb_build_object(
    'version','phase45-v1',
    'version_id',v_id,
    'version_no',v_next,
    'rule_key',v_rule_key,
    'status','proposed');
end;
$$;

-- ---------------------------------------------------------------------------
-- Activate proposed rule via new append-only row (checker step)
-- ---------------------------------------------------------------------------
create or replace function public.activate_marketing_auto_reject_rule_phase45(
  p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_proposed_id uuid;
  v_actor uuid;
  v_reason text;
  v_meta jsonb;
  v_proposed public.os_marketing_revenue_auto_reject_rule_versions%rowtype;
  v_next integer;
  v_hash text;
  v_id uuid;
  v_alert_window text;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Auto-reject rule activation must be a JSON object';
  end if;

  v_proposed_id := nullif(p_payload->>'proposed_version_id','')::uuid;
  v_actor := nullif(p_payload->>'created_by','')::uuid;
  v_reason := coalesce(p_payload->>'reason','');
  v_meta := coalesce(p_payload->'metadata','{}'::jsonb);

  if v_proposed_id is null
    or v_actor is null
    or length(v_reason) not between 10 and 500
    or not public.phase45_marketing_ops_safe_metadata(v_meta) then
    raise exception 'Auto-reject rule activation requires actor, reason, and proposed version';
  end if;

  select * into v_proposed
  from public.os_marketing_revenue_auto_reject_rule_versions
  where version_id = v_proposed_id;

  if not found or v_proposed.status is distinct from 'proposed' then
    raise exception 'Only proposed auto-reject rule versions can be activated';
  end if;

  if v_proposed.created_by is not distinct from v_actor then
    raise exception 'Maker-checker requires a different actor than the proposer';
  end if;

  select coalesce(max(version_no),0) + 1 into v_next
  from public.os_marketing_revenue_auto_reject_rule_versions
  where rule_key = v_proposed.rule_key;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase45-v1',
    'kind','auto_reject_rule_activated',
    'rule_key',v_proposed.rule_key,
    'version_no',v_next,
    'proposed_version_id',v_proposed_id,
    'thresholds',v_proposed.thresholds,
    'created_by',v_actor
  )::text);

  insert into public.os_marketing_revenue_auto_reject_rule_versions(
    version_no,rule_key,thresholds,status,proposed_version_id,
    metrics_sha256,created_by,metadata)
  values (
    v_next,v_proposed.rule_key,v_proposed.thresholds,'active',v_proposed_id,
    v_hash,v_actor,
    v_meta || jsonb_build_object(
      'contract_version','phase45-v1',
      'lifecycle','active',
      'activation_reason',left(v_reason,500),
      'proposed_version_no',v_proposed.version_no))
  returning version_id into v_id;

  -- Record tuned-rule alert against a firm entity if one exists for the actor scope.
  -- Uses a synthetic firm entity only when an entity_id is supplied in payload.
  if nullif(p_payload->>'entity_id','') is not null then
    v_alert_window := left(
      'ruletuned:' || (p_payload->>'entity_id') || ':' || v_id::text, 200);
    insert into public.os_marketing_revenue_phase45_ops_alerts(
      entity_id,source_id,alert_kind,window_key,severity,destination_key,
      delivery_status,response_code,metrics_sha256,metadata)
    values (
      p_payload->>'entity_id',
      null,
      'auto_reject_rule_tuned',
      v_alert_window,
      'critical',
      'ops_alerts',
      'recorded',
      null,
      public.os_sha256_hex(jsonb_build_object(
        'version','phase45-v1',
        'alert_kind','auto_reject_rule_tuned',
        'version_id',v_id,
        'rule_key',v_proposed.rule_key,
        'version_no',v_next
      )::text),
      jsonb_build_object(
        'contract_version','phase45-v1',
        'rule_key',v_proposed.rule_key,
        'version_no',v_next,
        'proposed_version_id',v_proposed_id
      ))
    on conflict (window_key) do nothing;
  end if;

  return jsonb_build_object(
    'version','phase45-v1',
    'version_id',v_id,
    'version_no',v_next,
    'rule_key',v_proposed.rule_key,
    'status','active',
    'proposed_version_id',v_proposed_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Fail-closed correction validation (Phase 44 path + Phase 45 thresholds)
-- NEVER auto-approves money.
-- ---------------------------------------------------------------------------
create or replace function public.validate_marketing_revenue_corrections_phase44()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_corr public.os_marketing_revenue_corrections%rowtype;
  v_prev public.os_marketing_revenue_allocations%rowtype;
  v_source public.os_marketing_revenue_sources%rowtype;
  v_row jsonb;
  v_fail text;
  v_status text;
  v_age numeric;
  v_hash text;
  v_passed integer := 0;
  v_failed integer := 0;
  v_auto_rejected integer := 0;
  v_reject_ok boolean;
  v_prev_found boolean;
  v_window_ok boolean;
  v_thresholds jsonb;
  v_min_reason integer;
  v_max_reason integer;
  v_auto_reject boolean;
  v_reason_len integer;
begin
  v_thresholds := public.phase45_active_auto_reject_thresholds('correction_contract_v1');
  v_min_reason := greatest(coalesce((v_thresholds->>'min_reason_length')::integer,10),1);
  v_max_reason := least(greatest(coalesce((v_thresholds->>'max_reason_length')::integer,500),v_min_reason),2000);
  v_auto_reject := coalesce((v_thresholds->>'auto_reject_on_contract_fail')::boolean,true);

  for v_corr in
    select c.*
    from public.os_marketing_revenue_corrections c
    where c.status = 'pending'
    order by c.created_at asc
    limit 100
  loop
    v_fail := null;
    v_reject_ok := false;
    v_prev_found := false;
    v_window_ok := true;
    v_age := round(
      extract(epoch from (now() - v_corr.created_at)) / 3600.0, 2);

    select * into v_source
    from public.os_marketing_revenue_sources
    where source_id = v_corr.source_id;
    if not found then
      continue;
    end if;

    select * into v_prev
    from public.os_marketing_revenue_allocations
    where allocation_id = v_corr.supersedes_allocation_id;
    v_prev_found := found;
    v_row := v_corr.proposed_row;
    v_reason_len := length(coalesce(v_corr.reason,''));

    begin
      if (v_row->>'cohort_window_end')::timestamptz
          < (v_row->>'cohort_window_start')::timestamptz then
        v_window_ok := false;
      end if;
    exception
      when others then
        v_window_ok := false;
    end;

    if jsonb_typeof(v_row) is distinct from 'object' then
      v_fail := 'Proposed correction row is not a JSON object';
    elsif coalesce(v_row->>'entity_id','') is distinct from v_source.entity_id then
      v_fail := 'Proposed correction entity does not match source entity';
    elsif coalesce(v_row->>'ad_account_id','') is distinct from v_source.ad_account_id then
      v_fail := 'Proposed correction ad account does not match source';
    elsif coalesce(v_row->>'external_account_id','')
        is distinct from v_source.external_account_id then
      v_fail := 'Proposed correction external account does not match source';
    elsif coalesce(v_row->>'amount_micros','') !~ '^\d{1,18}$' then
      v_fail := 'Proposed correction amount_micros fails contract regex';
    elsif coalesce(v_row->>'currency','') !~ '^[A-Z]{3}$' then
      v_fail := 'Proposed correction currency fails ISO-4217 contract';
    elsif coalesce(v_row->>'attribution_model','') not in
        ('first_touch','last_touch','linear','position_based','provider_reported') then
      v_fail := 'Proposed correction attribution_model is outside contract enum';
    elsif coalesce(v_row->>'source_payload_sha256','') !~ '^[0-9a-f]{64}$' then
      v_fail := 'Proposed correction source_payload_sha256 is not a sha256 hex';
    elsif coalesce(v_row->>'binding_sha256','') !~ '^[0-9a-f]{64}$' then
      v_fail := 'Proposed correction binding_sha256 is not a sha256 hex';
    elsif v_corr.proposed_canonical_sha256 !~ '^[0-9a-f]{64}$' then
      v_fail := 'Proposed canonical sha256 fails contract format';
    elsif v_corr.proposed_canonical_sha256
        is distinct from public.os_sha256_hex(v_row::text) then
      v_fail := 'Proposed canonical sha256 does not match proposed_row digest';
    elsif v_reason_len < v_min_reason or v_reason_len > v_max_reason then
      v_fail := 'Correction reason length is outside the configured contract';
    elsif not v_prev_found then
      v_fail := 'Correction supersedes allocation is missing';
    elsif v_prev.source_revision + 1 is distinct from v_corr.proposed_revision then
      v_fail := 'Correction lineage is stale relative to current allocation';
    elsif not v_window_ok then
      v_fail := 'Proposed correction cohort window ends before it starts';
    end if;

    if v_fail is null then
      v_status := 'passed';
      v_passed := v_passed + 1;
    else
      -- Fail-closed: reject via existing review RPC; never approve money.
      if v_auto_reject then
        begin
          perform public.approve_marketing_revenue_correction(
            v_corr.correction_id,
            null,
            'rejected',
            left('Phase45 fail-closed auto-reject: ' || v_fail, 500));
          v_reject_ok := true;
        exception
          when others then
            v_reject_ok := false;
        end;
      else
        v_reject_ok := false;
      end if;
      if v_reject_ok then
        v_status := 'auto_rejected';
        v_auto_rejected := v_auto_rejected + 1;
      else
        v_status := 'failed';
        v_failed := v_failed + 1;
      end if;
    end if;

    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase45-v1',
      'kind','correction_validation',
      'correction_id',v_corr.correction_id,
      'entity_id',v_source.entity_id,
      'validation_status',v_status,
      'fail_reason',v_fail,
      'age_hours',v_age,
      'proposed_revision',v_corr.proposed_revision
    )::text);

    insert into public.os_marketing_revenue_correction_validations(
      correction_id,entity_id,validation_status,fail_reason,age_hours,
      metrics_sha256,metadata)
    values (
      v_corr.correction_id,
      v_source.entity_id,
      v_status,
      v_fail,
      v_age,
      v_hash,
      jsonb_build_object(
        'contract_version','phase45-v1',
        'metric','correction_validation',
        'reject_applied',v_reject_ok,
        'proposed_revision',v_corr.proposed_revision,
        'rule_key','correction_contract_v1'
      ));
  end loop;

  return jsonb_build_object(
    'version','phase45-v1',
    'passed',v_passed,
    'failed',v_failed,
    'auto_rejected',v_auto_rejected);
end;
$$;

-- ---------------------------------------------------------------------------
-- Webhook delivery SLO from Phase 43 + Phase 44 alert delivery evidence
-- ---------------------------------------------------------------------------
create or replace function public.record_marketing_revenue_webhook_delivery_slo_phase45(
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
  v_thresholds jsonb := public.phase45_active_auto_reject_thresholds();
  v_warn numeric := coalesce((v_thresholds->>'webhook_success_rate_warn')::numeric,0.9500);
  v_crit numeric := coalesce((v_thresholds->>'webhook_success_rate_critical')::numeric,0.8000);
  v_inserted integer := 0;
  v_row record;
  v_success numeric;
  v_severity text;
  v_hash text;
  v_attempted integer;
begin
  for v_row in
    with deliveries as (
      select a.entity_id, a.delivery_status
      from public.os_marketing_revenue_phase43_ops_alerts a
      where a.created_at >= v_since
        and (p_entity_id is null or a.entity_id = p_entity_id)
      union all
      select a.entity_id, a.delivery_status
      from public.os_marketing_revenue_phase44_ops_alerts a
      where a.created_at >= v_since
        and (p_entity_id is null or a.entity_id = p_entity_id)
    )
    select d.entity_id,
      count(*) filter (where d.delivery_status = 'delivered')::integer delivered_count,
      count(*) filter (where d.delivery_status = 'failed')::integer failed_count,
      count(*) filter (where d.delivery_status = 'skipped_no_webhook')::integer skipped_count,
      count(*) filter (where d.delivery_status = 'recorded')::integer recorded_count
    from deliveries d
    group by d.entity_id
  loop
    v_attempted := v_row.delivered_count + v_row.failed_count;
    if v_attempted = 0 then
      v_success := null;
      v_severity := 'healthy';
    else
      v_success := round(
        (v_row.delivered_count::numeric / v_attempted::numeric), 4);
      if v_success < v_crit then
        v_severity := 'critical';
      elsif v_success < v_warn then
        v_severity := 'warning';
      else
        v_severity := 'healthy';
      end if;
    end if;

    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase45-v1',
      'kind','webhook_delivery_slo',
      'entity_id',v_row.entity_id,
      'window_days',v_days,
      'delivered',v_row.delivered_count,
      'failed',v_row.failed_count,
      'skipped',v_row.skipped_count,
      'recorded',v_row.recorded_count,
      'success_rate',v_success,
      'severity',v_severity
    )::text);

    insert into public.os_marketing_revenue_webhook_delivery_slo_snapshots(
      entity_id,window_start,window_end,delivered_count,failed_count,
      skipped_count,recorded_count,success_rate,severity,metrics_sha256,metadata)
    values (
      v_row.entity_id,v_since,now(),
      v_row.delivered_count,v_row.failed_count,v_row.skipped_count,v_row.recorded_count,
      v_success,v_severity,v_hash,
      jsonb_build_object(
        'contract_version','phase45-v1',
        'metric','webhook_delivery_success_rate',
        'sources',jsonb_build_array('phase43','phase44'),
        'warning_threshold',v_warn,
        'critical_threshold',v_crit
      ));
    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object(
    'version','phase45-v1',
    'window_days',v_days,
    'snapshots_recorded',v_inserted);
end;
$$;

-- ---------------------------------------------------------------------------
-- Correction/validation workflow monitoring snapshot
-- ---------------------------------------------------------------------------
create or replace function public.record_marketing_revenue_correction_workflow_snapshot_phase45(
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
  v_total integer;
  v_pass_rate numeric;
  v_auto_rate numeric;
  v_hash text;
begin
  for v_row in
    with entities as (
      select distinct s.entity_id
      from public.os_marketing_revenue_sources s
      where p_entity_id is null or s.entity_id = p_entity_id
    ),
    pending as (
      select s.entity_id,
        count(*)::integer pending_count,
        round(max(extract(epoch from (now() - c.created_at)) / 3600.0), 2)
          oldest_pending_hours
      from public.os_marketing_revenue_corrections c
      join public.os_marketing_revenue_sources s using (source_id)
      where c.status = 'pending'
        and (p_entity_id is null or s.entity_id = p_entity_id)
      group by s.entity_id
    ),
    validations as (
      select v.entity_id,
        count(*) filter (where v.validation_status = 'passed')::integer validated_passed,
        count(*) filter (where v.validation_status = 'failed')::integer validated_failed,
        count(*) filter (where v.validation_status = 'auto_rejected')::integer auto_rejected
      from public.os_marketing_revenue_correction_validations v
      where v.created_at >= v_since
        and (p_entity_id is null or v.entity_id = p_entity_id)
      group by v.entity_id
    )
    select e.entity_id,
      coalesce(p.pending_count,0) pending_count,
      coalesce(p.oldest_pending_hours,null) oldest_pending_hours,
      coalesce(v.validated_passed,0) validated_passed,
      coalesce(v.validated_failed,0) validated_failed,
      coalesce(v.auto_rejected,0) auto_rejected
    from entities e
    left join pending p on p.entity_id = e.entity_id
    left join validations v on v.entity_id = e.entity_id
  loop
    v_total := v_row.validated_passed + v_row.validated_failed + v_row.auto_rejected;
    if v_total = 0 then
      v_pass_rate := null;
      v_auto_rate := null;
    else
      v_pass_rate := round((v_row.validated_passed::numeric / v_total::numeric), 4);
      v_auto_rate := round((v_row.auto_rejected::numeric / v_total::numeric), 4);
    end if;

    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase45-v1',
      'kind','correction_workflow',
      'entity_id',v_row.entity_id,
      'pending',v_row.pending_count,
      'passed',v_row.validated_passed,
      'failed',v_row.validated_failed,
      'auto_rejected',v_row.auto_rejected,
      'oldest_pending_hours',v_row.oldest_pending_hours,
      'pass_rate',v_pass_rate,
      'auto_reject_rate',v_auto_rate
    )::text);

    insert into public.os_marketing_revenue_correction_workflow_snapshots(
      entity_id,pending_count,validated_passed,validated_failed,auto_rejected,
      oldest_pending_hours,pass_rate,auto_reject_rate,metrics_sha256,metadata)
    values (
      v_row.entity_id,v_row.pending_count,v_row.validated_passed,
      v_row.validated_failed,v_row.auto_rejected,v_row.oldest_pending_hours,
      v_pass_rate,v_auto_rate,v_hash,
      jsonb_build_object(
        'contract_version','phase45-v1',
        'metric','correction_workflow',
        'window_days',v_days
      ));
    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object(
    'version','phase45-v1',
    'window_days',v_days,
    'snapshots_recorded',v_inserted);
end;
$$;

-- ---------------------------------------------------------------------------
-- List critical Phase 45 windows needing idempotent ops alerts
-- ---------------------------------------------------------------------------
create or replace function public.list_marketing_revenue_phase45_critical_windows(
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
  v_thresholds jsonb := public.phase45_active_auto_reject_thresholds();
  v_stale_hours numeric := coalesce((v_thresholds->>'workflow_stale_hours')::numeric,48);
  v_fail_crit numeric := coalesce((v_thresholds->>'validation_fail_rate_critical')::numeric,0.2500);
  v_webhook jsonb;
  v_stale jsonb;
  v_fail jsonb;
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
      'alert_kind','webhook_delivery_critical',
      'entity_id',l.entity_id,
      'source_id',null,
      'window_key','whslo:'||l.entity_id||':'||v_bucket||'h'||v_hours::text,
      'severity','critical',
      'metrics_sha256',l.metrics_sha256,
      'snapshot_id',l.snapshot_id,
      'success_rate',l.success_rate,
      'delivered_count',l.delivered_count,
      'failed_count',l.failed_count
    ) order by l.entity_id)
    from (
      select s.*,
        row_number() over (
          partition by s.entity_id
          order by s.created_at desc, s.snapshot_id desc
        ) rn
      from public.os_marketing_revenue_webhook_delivery_slo_snapshots s
      where s.created_at >= v_since
        and s.severity = 'critical'
        and (p_entity_id is null or s.entity_id = p_entity_id)
    ) l
    where l.rn = 1
      and not exists (
        select 1 from public.os_marketing_revenue_phase45_ops_alerts x
        where x.window_key =
          'whslo:'||l.entity_id||':'||v_bucket||'h'||v_hours::text
      )
    limit 50
  ), '[]'::jsonb) into v_webhook;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','correction_workflow_stale',
      'entity_id',l.entity_id,
      'source_id',null,
      'window_key','wfstale:'||l.entity_id||':'||v_bucket||'h'||v_hours::text,
      'severity','critical',
      'metrics_sha256',l.metrics_sha256,
      'snapshot_id',l.snapshot_id,
      'pending_count',l.pending_count,
      'oldest_pending_hours',l.oldest_pending_hours
    ) order by l.entity_id)
    from (
      select s.*,
        row_number() over (
          partition by s.entity_id
          order by s.created_at desc, s.snapshot_id desc
        ) rn
      from public.os_marketing_revenue_correction_workflow_snapshots s
      where s.created_at >= v_since
        and coalesce(s.oldest_pending_hours,0) >= v_stale_hours
        and (p_entity_id is null or s.entity_id = p_entity_id)
    ) l
    where l.rn = 1
      and not exists (
        select 1 from public.os_marketing_revenue_phase45_ops_alerts x
        where x.window_key =
          'wfstale:'||l.entity_id||':'||v_bucket||'h'||v_hours::text
      )
    limit 50
  ), '[]'::jsonb) into v_stale;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','validation_fail_rate_elevated',
      'entity_id',l.entity_id,
      'source_id',null,
      'window_key','valfail:'||l.entity_id||':'||v_bucket||'h'||v_hours::text,
      'severity','critical',
      'metrics_sha256',l.metrics_sha256,
      'snapshot_id',l.snapshot_id,
      'validated_failed',l.validated_failed,
      'auto_rejected',l.auto_rejected,
      'pass_rate',l.pass_rate
    ) order by l.entity_id)
    from (
      select s.*,
        row_number() over (
          partition by s.entity_id
          order by s.created_at desc, s.snapshot_id desc
        ) rn,
        case
          when (s.validated_passed + s.validated_failed + s.auto_rejected) = 0 then null
          else round(
            ((s.validated_failed + s.auto_rejected)::numeric
              / (s.validated_passed + s.validated_failed + s.auto_rejected)::numeric),
            4)
        end as fail_rate
      from public.os_marketing_revenue_correction_workflow_snapshots s
      where s.created_at >= v_since
        and (p_entity_id is null or s.entity_id = p_entity_id)
    ) l
    where l.rn = 1
      and l.fail_rate is not null
      and l.fail_rate >= v_fail_crit
      and not exists (
        select 1 from public.os_marketing_revenue_phase45_ops_alerts x
        where x.window_key =
          'valfail:'||l.entity_id||':'||v_bucket||'h'||v_hours::text
      )
    limit 50
  ), '[]'::jsonb) into v_fail;

  return jsonb_build_object(
    'version','phase45-v1',
    'window_days',v_days,
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',coalesce(v_webhook,'[]'::jsonb)
      || coalesce(v_stale,'[]'::jsonb)
      || coalesce(v_fail,'[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Record one critical Phase 45 ops alert after delivery attempt
-- ---------------------------------------------------------------------------
create or replace function public.record_marketing_revenue_phase45_ops_alert(
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
      ('webhook_delivery_critical','auto_reject_rule_tuned',
       'correction_workflow_stale','validation_fail_rate_elevated')
    or v_entity = ''
    or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
    or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
    or v_dest ~* '://|^https?'
    or v_delivery not in
      ('delivered','skipped_no_webhook','failed','recorded')
    or not public.phase45_marketing_ops_safe_metadata(v_meta) then
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
    'version','phase45-v1',
    'alert_kind',v_kind,
    'entity_id',v_entity,
    'source_id',v_source,
    'window_key',v_window,
    'severity','critical',
    'destination_key',v_dest,
    'delivery_status',v_delivery,
    'response_code',v_code
  )::text);

  insert into public.os_marketing_revenue_phase45_ops_alerts(
    entity_id,source_id,alert_kind,window_key,severity,destination_key,
    delivery_status,response_code,metrics_sha256,metadata)
  values (
    v_entity,v_source,v_kind,v_window,'critical',v_dest,
    v_delivery,v_code,v_hash,
    v_meta || jsonb_build_object('contract_version','phase45-v1'))
  on conflict (window_key) do nothing
  returning alert_id, delivery_status into v_id, v_status;

  if v_id is null then
    select alert_id, delivery_status into v_id, v_status
    from public.os_marketing_revenue_phase45_ops_alerts
    where window_key = v_window;
    return jsonb_build_object(
      'version','phase45-v1',
      'alert_id',v_id,
      'window_key',v_window,
      'delivery_status',v_status,
      'inserted',false);
  end if;

  return jsonb_build_object(
    'version','phase45-v1',
    'alert_id',v_id,
    'window_key',v_window,
    'delivery_status',v_status,
    'inserted',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Hub report: webhook SLO, workflow health, active rule, alerts
-- ---------------------------------------------------------------------------
create or replace function public.get_marketing_revenue_phase45_ops_report(
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
  v_webhook jsonb;
  v_workflow jsonb;
  v_rules jsonb;
  v_alerts jsonb;
  v_webhook_health text := 'unknown';
  v_workflow_health text := 'unknown';
  v_alert_delivery text := 'none';
  v_active_rule jsonb;
  v_thresholds jsonb;
begin
  v_thresholds := public.phase45_active_auto_reject_thresholds();

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'snapshot_id',l.snapshot_id,
      'entity_id',l.entity_id,
      'window_start',l.window_start,
      'window_end',l.window_end,
      'delivered_count',l.delivered_count,
      'failed_count',l.failed_count,
      'skipped_count',l.skipped_count,
      'recorded_count',l.recorded_count,
      'success_rate',l.success_rate,
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
      from public.os_marketing_revenue_webhook_delivery_slo_snapshots s
      where s.created_at >= v_since
        and (p_entity_id is null or s.entity_id = p_entity_id)
    ) l
    where l.rn = 1
    limit 100
  ), '[]'::jsonb) into v_webhook;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'snapshot_id',l.snapshot_id,
      'entity_id',l.entity_id,
      'pending_count',l.pending_count,
      'validated_passed',l.validated_passed,
      'validated_failed',l.validated_failed,
      'auto_rejected',l.auto_rejected,
      'oldest_pending_hours',l.oldest_pending_hours,
      'pass_rate',l.pass_rate,
      'auto_reject_rate',l.auto_reject_rate,
      'metrics_sha256',l.metrics_sha256,
      'created_at',l.created_at
    ) order by l.entity_id)
    from (
      select s.*,
        row_number() over (
          partition by s.entity_id
          order by s.created_at desc, s.snapshot_id desc
        ) rn
      from public.os_marketing_revenue_correction_workflow_snapshots s
      where s.created_at >= v_since
        and (p_entity_id is null or s.entity_id = p_entity_id)
    ) l
    where l.rn = 1
    limit 100
  ), '[]'::jsonb) into v_workflow;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'version_id',r.version_id,
      'version_no',r.version_no,
      'rule_key',r.rule_key,
      'thresholds',r.thresholds,
      'status',r.status,
      'proposed_version_id',r.proposed_version_id,
      'metrics_sha256',r.metrics_sha256,
      'created_at',r.created_at,
      'created_by',r.created_by
    ) order by r.created_at desc)
    from public.os_marketing_revenue_auto_reject_rule_versions r
    where r.created_at >= v_since
    limit 50
  ), '[]'::jsonb) into v_rules;

  select coalesce((
    select jsonb_build_object(
      'version_id',r.version_id,
      'version_no',r.version_no,
      'rule_key',r.rule_key,
      'thresholds',r.thresholds,
      'status',r.status,
      'metrics_sha256',r.metrics_sha256,
      'created_at',r.created_at
    )
    from public.os_marketing_revenue_auto_reject_rule_versions r
    where r.status = 'active'
      and r.rule_key = 'correction_contract_v1'
    order by r.version_no desc, r.created_at desc
    limit 1
  ), null) into v_active_rule;

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
    from public.os_marketing_revenue_phase45_ops_alerts a
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
    from jsonb_to_recordset(coalesce(v_webhook,'[]'::jsonb))
      as x(severity text)
  ), 'unknown') into v_webhook_health;

  select coalesce((
    select case
      when bool_or(coalesce(x.oldest_pending_hours,0) >=
        coalesce((v_thresholds->>'workflow_stale_hours')::numeric,48))
        then 'critical'
      when bool_or(
        (coalesce(x.validated_failed,0) + coalesce(x.auto_rejected,0)) > 0
        and coalesce(x.pass_rate,1) <
          (1 - coalesce((v_thresholds->>'validation_fail_rate_warn')::numeric,0.10))
      ) then 'warning'
      when bool_or(coalesce(x.pending_count,0) >= 0) then 'healthy'
      else 'unknown'
    end
    from jsonb_to_recordset(coalesce(v_workflow,'[]'::jsonb))
      as x(
        pending_count integer,
        validated_failed integer,
        auto_rejected integer,
        oldest_pending_hours numeric,
        pass_rate numeric
      )
  ), 'unknown') into v_workflow_health;

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
    'version','phase45-v1',
    'window_days',v_days,
    'webhook_delivery_health',v_webhook_health,
    'workflow_health',v_workflow_health,
    'alert_delivery',v_alert_delivery,
    'active_rule',v_active_rule,
    'thresholds',v_thresholds,
    'webhook_snapshots',coalesce(v_webhook,'[]'::jsonb),
    'workflow_snapshots',coalesce(v_workflow,'[]'::jsonb),
    'rule_versions',coalesce(v_rules,'[]'::jsonb),
    'alerts',coalesce(v_alerts,'[]'::jsonb),
    'destination_key','ops_alerts');
end;
$$;

revoke all on function public.prevent_marketing_revenue_phase45_ops_mutation()
  from public, anon, authenticated;
revoke all on function public.phase45_marketing_ops_safe_metadata(jsonb)
  from public, anon, authenticated;
revoke all on function public.phase45_default_auto_reject_thresholds()
  from public, anon, authenticated;
revoke all on function public.phase45_active_auto_reject_thresholds(text)
  from public, anon, authenticated;
revoke all on function public.propose_marketing_auto_reject_rule_phase45(jsonb)
  from public, anon, authenticated;
revoke all on function public.activate_marketing_auto_reject_rule_phase45(jsonb)
  from public, anon, authenticated;
revoke all on function public.record_marketing_revenue_webhook_delivery_slo_phase45(text,integer)
  from public, anon, authenticated;
revoke all on function public.record_marketing_revenue_correction_workflow_snapshot_phase45(text,integer)
  from public, anon, authenticated;
revoke all on function public.list_marketing_revenue_phase45_critical_windows(text,integer,integer)
  from public, anon, authenticated;
revoke all on function public.record_marketing_revenue_phase45_ops_alert(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_marketing_revenue_phase45_ops_report(text,integer)
  from public, anon, authenticated;

grant execute on function public.phase45_marketing_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.phase45_default_auto_reject_thresholds()
  to authenticated, service_role;
grant execute on function public.phase45_active_auto_reject_thresholds(text)
  to authenticated, service_role;
grant execute on function public.list_marketing_revenue_phase45_critical_windows(text,integer,integer)
  to authenticated, service_role;
grant execute on function public.get_marketing_revenue_phase45_ops_report(text,integer)
  to authenticated, service_role;
grant execute on function public.propose_marketing_auto_reject_rule_phase45(jsonb)
  to authenticated, service_role;
grant execute on function public.activate_marketing_auto_reject_rule_phase45(jsonb)
  to service_role;

grant execute on function public.record_marketing_revenue_webhook_delivery_slo_phase45(text,integer)
  to service_role;
grant execute on function public.record_marketing_revenue_correction_workflow_snapshot_phase45(text,integer)
  to service_role;
grant execute on function public.record_marketing_revenue_phase45_ops_alert(jsonb)
  to service_role;
