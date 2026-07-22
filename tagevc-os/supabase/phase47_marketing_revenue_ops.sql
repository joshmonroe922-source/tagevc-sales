-- Phase 47: multi-entity cohort auto-reject promotion gates and attribution
-- conflict closure workflows over Phase 46 evidence.
-- Apply after phase46_marketing_revenue_ops.sql. Safe to re-run.
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
-- Promotion cohorts (firm-wide or multi-entity)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_promotion_cohorts (
  cohort_id uuid primary key default gen_random_uuid(),
  cohort_key text not null unique
    check (cohort_key ~ '^[a-z][a-z0-9_]{2,62}$'),
  entity_ids text[] not null default '{}'::text[],
  status text not null default 'active' check (status in ('active','retired')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (not (metadata ?| array[
    'authorization','cookie','set-cookie','token','secret','signature','jwt',
    'credential','password','payload','body','value','env_value','url'
  ])),
  check (
    cardinality(entity_ids) >= 0
    and cardinality(entity_ids) <= 200
  )
);

create index if not exists os_mkt_rev_promo_cohort_status_idx
  on public.os_marketing_revenue_promotion_cohorts
    (status, created_at desc);

alter table public.os_marketing_revenue_promotion_cohorts
  enable row level security;

-- ---------------------------------------------------------------------------
-- Append-only cohort-scoped auto-reject promotions
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_cohort_promotions (
  promotion_id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null
    references public.os_marketing_revenue_promotion_cohorts(cohort_id),
  rule_version_id uuid
    references public.os_marketing_revenue_auto_reject_rule_versions(version_id),
  version_no integer check (version_no is null or version_no >= 1),
  webhook_slo_windows_required integer not null
    check (webhook_slo_windows_required between 1 and 30),
  webhook_slo_windows_healthy integer not null
    check (webhook_slo_windows_healthy >= 0),
  entities_required integer not null check (entities_required >= 0),
  entities_healthy integer not null check (entities_healthy >= 0),
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

create index if not exists os_mkt_rev_cohort_promo_created_idx
  on public.os_marketing_revenue_cohort_promotions
    (created_at desc);
create index if not exists os_mkt_rev_cohort_promo_cohort_idx
  on public.os_marketing_revenue_cohort_promotions
    (cohort_id, created_at desc);
create index if not exists os_mkt_rev_cohort_promo_status_idx
  on public.os_marketing_revenue_cohort_promotions
    (promotion_status, created_at desc);

alter table public.os_marketing_revenue_cohort_promotions
  enable row level security;

-- ---------------------------------------------------------------------------
-- Append-only attribution conflict closures (maker-checker close workflow)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_attribution_conflict_closures (
  closure_id uuid primary key default gen_random_uuid(),
  conflict_id uuid not null
    references public.os_marketing_revenue_attribution_conflicts(conflict_id),
  closure_status text not null check (closure_status in
    ('proposed','approved','rejected','closed')),
  resolution_notes text not null
    check (length(resolution_notes) between 10 and 500),
  closed_by uuid not null,
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

create index if not exists os_mkt_rev_attr_closure_conflict_idx
  on public.os_marketing_revenue_attribution_conflict_closures
    (conflict_id, created_at desc);
create index if not exists os_mkt_rev_attr_closure_status_idx
  on public.os_marketing_revenue_attribution_conflict_closures
    (closure_status, created_at desc);

alter table public.os_marketing_revenue_attribution_conflict_closures
  enable row level security;

-- ---------------------------------------------------------------------------
-- Append-only Phase 47 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_phase47_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities(entity_id),
  source_id uuid references public.os_marketing_revenue_sources(source_id),
  cohort_id uuid
    references public.os_marketing_revenue_promotion_cohorts(cohort_id),
  conflict_id uuid
    references public.os_marketing_revenue_attribution_conflicts(conflict_id),
  alert_kind text not null check (alert_kind in
    ('cohort_promotion_blocked','cohort_promoted',
     'attribution_conflict_aging','conflict_closure_pending')),
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

create index if not exists os_mkt_rev_p47_ops_alert_entity_idx
  on public.os_marketing_revenue_phase47_ops_alerts
    (entity_id, created_at desc);
create index if not exists os_mkt_rev_p47_ops_alert_kind_idx
  on public.os_marketing_revenue_phase47_ops_alerts
    (alert_kind, created_at desc);

alter table public.os_marketing_revenue_phase47_ops_alerts
  enable row level security;

do $$
begin
  revoke all on public.os_marketing_revenue_promotion_cohorts
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_promotion_cohorts from service_role;
  grant select on public.os_marketing_revenue_promotion_cohorts
    to service_role;

  revoke all on public.os_marketing_revenue_cohort_promotions
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_cohort_promotions from service_role;
  grant select on public.os_marketing_revenue_cohort_promotions
    to service_role;

  revoke all on public.os_marketing_revenue_attribution_conflict_closures
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_attribution_conflict_closures
    from service_role;
  grant select on public.os_marketing_revenue_attribution_conflict_closures
    to service_role;

  revoke all on public.os_marketing_revenue_phase47_ops_alerts
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_phase47_ops_alerts from service_role;
  grant select on public.os_marketing_revenue_phase47_ops_alerts
    to service_role;
end $$;

create or replace function public.prevent_marketing_revenue_phase47_ops_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  raise exception 'Marketing revenue Phase 47 ops evidence is append-only';
end;
$$;

-- Cohorts allow status/entity updates via security-definer upsert only;
-- block deletes/truncates and direct client updates via RLS + grants.
create or replace function public.prevent_marketing_revenue_phase47_cohort_delete()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  raise exception 'Marketing revenue Phase 47 promotion cohorts cannot be deleted';
end;
$$;

drop trigger if exists os_mkt_rev_promo_cohort_no_delete
  on public.os_marketing_revenue_promotion_cohorts;
create trigger os_mkt_rev_promo_cohort_no_delete
  before delete or truncate
  on public.os_marketing_revenue_promotion_cohorts
  for each statement
  execute function public.prevent_marketing_revenue_phase47_cohort_delete();

drop trigger if exists os_mkt_rev_cohort_promo_immutable
  on public.os_marketing_revenue_cohort_promotions;
create trigger os_mkt_rev_cohort_promo_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_cohort_promotions
  for each statement
  execute function public.prevent_marketing_revenue_phase47_ops_mutation();

drop trigger if exists os_mkt_rev_attr_closure_immutable
  on public.os_marketing_revenue_attribution_conflict_closures;
create trigger os_mkt_rev_attr_closure_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_attribution_conflict_closures
  for each statement
  execute function public.prevent_marketing_revenue_phase47_ops_mutation();

drop trigger if exists os_mkt_rev_p47_ops_alert_immutable
  on public.os_marketing_revenue_phase47_ops_alerts;
create trigger os_mkt_rev_p47_ops_alert_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_phase47_ops_alerts
  for each statement
  execute function public.prevent_marketing_revenue_phase47_ops_mutation();

create or replace function public.phase47_marketing_ops_safe_metadata(p_detail jsonb)
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

create or replace function public.phase47_default_cohort_thresholds()
returns jsonb
language sql
immutable
parallel safe
as $$
  select public.phase46_default_promotion_thresholds()
    || jsonb_build_object(
      'conflict_aging_days', 7,
      'conflict_aging_hours', 168
    );
$$;

create or replace function public.phase47_normalize_entity_ids(p_entity_ids text[])
returns text[]
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_out text[] := '{}'::text[];
  v_id text;
begin
  if p_entity_ids is null then
    return '{}'::text[];
  end if;
  foreach v_id in array p_entity_ids loop
    v_id := nullif(btrim(v_id), '');
    if v_id is null then
      continue;
    end if;
    if not exists (select 1 from public.entities where entity_id = v_id) then
      raise exception 'Promotion cohort entity is unknown: %', left(v_id, 100);
    end if;
    if not (v_id = any (v_out)) then
      v_out := array_append(v_out, v_id);
    end if;
  end loop;
  if cardinality(v_out) > 200 then
    raise exception 'Promotion cohort may include at most 200 entities';
  end if;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Upsert promotion cohort (active/retired; firm-wide when entity_ids empty)
-- ---------------------------------------------------------------------------
create or replace function public.upsert_marketing_promotion_cohort_phase47(
  p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
  v_status text;
  v_ids text[];
  v_actor uuid;
  v_meta jsonb;
  v_hash text;
  v_id uuid;
  v_existing public.os_marketing_revenue_promotion_cohorts%rowtype;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Promotion cohort payload must be a JSON object';
  end if;

  v_key := coalesce(nullif(p_payload->>'cohort_key',''),'');
  v_status := coalesce(nullif(p_payload->>'status',''),'active');
  v_actor := nullif(p_payload->>'created_by','')::uuid;
  v_meta := coalesce(p_payload->'metadata','{}'::jsonb);

  if jsonb_typeof(p_payload->'entity_ids') = 'array' then
    select coalesce(array_agg(x), '{}'::text[])
    into v_ids
    from jsonb_array_elements_text(p_payload->'entity_ids') as t(x);
  elsif p_payload ? 'entity_ids'
    and jsonb_typeof(p_payload->'entity_ids') = 'string' then
    v_ids := string_to_array(p_payload->>'entity_ids', ',');
  else
    v_ids := '{}'::text[];
  end if;

  v_ids := public.phase47_normalize_entity_ids(v_ids);

  if v_key !~ '^[a-z][a-z0-9_]{2,62}$'
    or v_status not in ('active','retired')
    or v_actor is null
    or not public.phase47_marketing_ops_safe_metadata(v_meta) then
    raise exception 'Promotion cohort contract is invalid or unsafe';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase47-v1',
    'kind','promotion_cohort',
    'cohort_key',v_key,
    'entity_ids',to_jsonb(v_ids),
    'status',v_status,
    'firm_wide',cardinality(v_ids) = 0,
    'created_by',v_actor
  )::text);

  select * into v_existing
  from public.os_marketing_revenue_promotion_cohorts
  where cohort_key = v_key
  for update;

  if found then
    update public.os_marketing_revenue_promotion_cohorts
    set entity_ids = v_ids,
      status = v_status,
      metrics_sha256 = v_hash,
      metadata = v_meta || jsonb_build_object(
        'contract_version','phase47-v1',
        'firm_wide',cardinality(v_ids) = 0,
        'updated_by',v_actor,
        'updated_at',now()),
      created_by = coalesce(created_by, v_actor)
    where cohort_id = v_existing.cohort_id
    returning cohort_id into v_id;
  else
    insert into public.os_marketing_revenue_promotion_cohorts(
      cohort_key,entity_ids,status,metrics_sha256,metadata,created_by)
    values (
      v_key,v_ids,v_status,v_hash,
      v_meta || jsonb_build_object(
        'contract_version','phase47-v1',
        'firm_wide',cardinality(v_ids) = 0),
      v_actor)
    returning cohort_id into v_id;
  end if;

  return jsonb_build_object(
    'version','phase47-v1',
    'cohort_id',v_id,
    'cohort_key',v_key,
    'entity_ids',to_jsonb(v_ids),
    'status',v_status,
    'firm_wide',cardinality(v_ids) = 0,
    'metrics_sha256',v_hash);
end;
$$;

-- ---------------------------------------------------------------------------
-- Gate: healthy Phase 46 webhook SLOs across ALL cohort entities (or firm-wide)
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_marketing_cohort_promotion_gate_phase47(
  p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_cohort_id uuid;
  v_cohort public.os_marketing_revenue_promotion_cohorts%rowtype;
  v_required integer;
  v_thresholds jsonb;
  v_defaults jsonb := public.phase47_default_cohort_thresholds();
  v_entity_ids text[];
  v_entity text;
  v_gate jsonb;
  v_entity_gates jsonb := '[]'::jsonb;
  v_required_entities integer := 0;
  v_healthy_entities integer := 0;
  v_min_healthy integer := null;
  v_pass boolean := true;
  v_reason text;
  v_firm_wide boolean := false;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Cohort promotion gate payload must be a JSON object';
  end if;

  v_cohort_id := nullif(p_payload->>'cohort_id','')::uuid;
  v_thresholds := public.phase45_active_auto_reject_thresholds()
    || v_defaults
    || coalesce(p_payload->'thresholds','{}'::jsonb);
  v_required := least(greatest(coalesce(
    nullif(p_payload->>'webhook_slo_windows_required','')::integer,
    (v_thresholds->>'webhook_slo_windows_required')::integer,
    3), 1), 30);

  if v_cohort_id is not null then
    select * into v_cohort
    from public.os_marketing_revenue_promotion_cohorts
    where cohort_id = v_cohort_id;
    if not found then
      raise exception 'Promotion cohort is unknown';
    end if;
    if v_cohort.status is distinct from 'active' then
      return jsonb_build_object(
        'version','phase47-v1',
        'gate_passed',false,
        'cohort_id',v_cohort_id,
        'cohort_key',v_cohort.cohort_key,
        'firm_wide',cardinality(v_cohort.entity_ids) = 0,
        'webhook_slo_windows_required',v_required,
        'webhook_slo_windows_healthy',0,
        'entities_required',0,
        'entities_healthy',0,
        'entity_gates','[]'::jsonb,
        'block_reason','Promotion cohort is retired');
    end if;
    v_entity_ids := v_cohort.entity_ids;
  elsif jsonb_typeof(p_payload->'entity_ids') = 'array' then
    select coalesce(array_agg(x), '{}'::text[])
    into v_entity_ids
    from jsonb_array_elements_text(p_payload->'entity_ids') as t(x);
    v_entity_ids := public.phase47_normalize_entity_ids(v_entity_ids);
  else
    v_entity_ids := '{}'::text[];
  end if;

  v_firm_wide := cardinality(v_entity_ids) = 0;

  if v_firm_wide then
    select coalesce(array_agg(distinct s.entity_id order by s.entity_id), '{}'::text[])
    into v_entity_ids
    from public.os_marketing_revenue_sources s
    where s.entity_id is not null;
  end if;

  if cardinality(v_entity_ids) = 0 then
    return jsonb_build_object(
      'version','phase47-v1',
      'gate_passed',false,
      'cohort_id',v_cohort_id,
      'cohort_key',v_cohort.cohort_key,
      'firm_wide',v_firm_wide,
      'webhook_slo_windows_required',v_required,
      'webhook_slo_windows_healthy',0,
      'entities_required',0,
      'entities_healthy',0,
      'entity_gates','[]'::jsonb,
      'block_reason','No entities available for cohort promotion gate');
  end if;

  foreach v_entity in array v_entity_ids loop
    v_required_entities := v_required_entities + 1;
    v_gate := public.evaluate_marketing_auto_reject_promotion_gate_phase46(
      jsonb_build_object(
        'entity_id',v_entity,
        'webhook_slo_windows_required',v_required,
        'thresholds',v_thresholds
      ));
    v_entity_gates := v_entity_gates || jsonb_build_array(
      v_gate || jsonb_build_object('entity_id',v_entity)
    );
    if coalesce((v_gate->>'gate_passed')::boolean,false) then
      v_healthy_entities := v_healthy_entities + 1;
      if v_min_healthy is null
        or coalesce((v_gate->>'webhook_slo_windows_healthy')::integer,0)
          < v_min_healthy then
        v_min_healthy := coalesce(
          (v_gate->>'webhook_slo_windows_healthy')::integer,0);
      end if;
    else
      v_pass := false;
      if v_min_healthy is null then
        v_min_healthy := coalesce(
          (v_gate->>'webhook_slo_windows_healthy')::integer,0);
      elsif coalesce((v_gate->>'webhook_slo_windows_healthy')::integer,0)
        < v_min_healthy then
        v_min_healthy := coalesce(
          (v_gate->>'webhook_slo_windows_healthy')::integer,0);
      end if;
    end if;
  end loop;

  v_pass := v_pass and (v_healthy_entities = v_required_entities)
    and v_required_entities > 0;

  if not v_pass then
    v_reason := 'Cohort webhook delivery SLOs lack '
      || v_required::text
      || ' consecutive healthy windows across all entities (healthy_entities='
      || v_healthy_entities::text
      || '/'
      || v_required_entities::text
      || ')';
  else
    v_reason := null;
  end if;

  return jsonb_build_object(
    'version','phase47-v1',
    'gate_passed',v_pass,
    'cohort_id',v_cohort_id,
    'cohort_key',v_cohort.cohort_key,
    'firm_wide',v_firm_wide,
    'webhook_slo_windows_required',v_required,
    'webhook_slo_windows_healthy',coalesce(v_min_healthy,0),
    'entities_required',v_required_entities,
    'entities_healthy',v_healthy_entities,
    'entity_gates',v_entity_gates,
    'block_reason',v_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- Promote: activate auto-reject for cohort only when all entity gates pass
-- ---------------------------------------------------------------------------
create or replace function public.promote_marketing_auto_reject_cohort_phase47(
  p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_gate jsonb;
  v_cohort_id uuid;
  v_cohort public.os_marketing_revenue_promotion_cohorts%rowtype;
  v_actor uuid;
  v_meta jsonb;
  v_hash text;
  v_promo_id uuid;
  v_required integer;
  v_healthy integer;
  v_ent_req integer;
  v_ent_healthy integer;
  v_reason text;
  v_status text;
  v_activated jsonb;
  v_entity_results jsonb := '[]'::jsonb;
  v_entity text;
  v_entity_ids text[];
  v_one jsonb;
  v_version_id uuid;
  v_version_no integer;
  v_alert_entity text;
  v_alert_window text;
  v_firm_wide boolean;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Cohort auto-reject promotion must be a JSON object';
  end if;

  v_cohort_id := nullif(p_payload->>'cohort_id','')::uuid;
  v_actor := nullif(p_payload->>'created_by','')::uuid;
  v_meta := coalesce(p_payload->'metadata','{}'::jsonb);

  if v_cohort_id is null
    or v_actor is null
    or not public.phase47_marketing_ops_safe_metadata(v_meta) then
    raise exception 'Cohort promotion requires cohort, actor, and safe metadata';
  end if;

  select * into v_cohort
  from public.os_marketing_revenue_promotion_cohorts
  where cohort_id = v_cohort_id;
  if not found then
    raise exception 'Promotion cohort is unknown';
  end if;

  v_gate := public.evaluate_marketing_cohort_promotion_gate_phase47(
    jsonb_build_object(
      'cohort_id',v_cohort_id,
      'webhook_slo_windows_required',p_payload->>'webhook_slo_windows_required',
      'thresholds',coalesce(p_payload->'thresholds','{}'::jsonb)
    ));
  v_required := coalesce((v_gate->>'webhook_slo_windows_required')::integer,3);
  v_healthy := coalesce((v_gate->>'webhook_slo_windows_healthy')::integer,0);
  v_ent_req := coalesce((v_gate->>'entities_required')::integer,0);
  v_ent_healthy := coalesce((v_gate->>'entities_healthy')::integer,0);
  v_reason := v_gate->>'block_reason';
  v_firm_wide := coalesce((v_gate->>'firm_wide')::boolean,false);

  if coalesce((v_gate->>'gate_passed')::boolean,false) is not true then
    v_status := 'blocked';
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase47-v1',
      'kind','cohort_promotion_blocked',
      'cohort_id',v_cohort_id,
      'proposed_version_id',p_payload->>'proposed_version_id',
      'required',v_required,
      'healthy',v_healthy,
      'entities_required',v_ent_req,
      'entities_healthy',v_ent_healthy,
      'block_reason',v_reason,
      'actor_id',v_actor
    )::text);

    insert into public.os_marketing_revenue_cohort_promotions(
      cohort_id,rule_version_id,version_no,webhook_slo_windows_required,
      webhook_slo_windows_healthy,entities_required,entities_healthy,
      promotion_status,block_reason,metrics_sha256,metadata,actor_id)
    values (
      v_cohort_id,null,null,v_required,v_healthy,v_ent_req,v_ent_healthy,
      'blocked',left(coalesce(v_reason,''),500),v_hash,
      v_meta || jsonb_build_object(
        'contract_version','phase47-v1',
        'gate',v_gate,
        'proposed_version_id',p_payload->>'proposed_version_id'),
      v_actor)
    returning promotion_id into v_promo_id;

    select coalesce(v_cohort.entity_ids[1], (
      select s.entity_id from public.os_marketing_revenue_sources s
      order by s.entity_id limit 1
    )) into v_alert_entity;

    if v_alert_entity is not null then
      v_alert_window := left(
        'cpromoblock:' || v_cohort.cohort_key || ':' || v_promo_id::text, 200);
      insert into public.os_marketing_revenue_phase47_ops_alerts(
        entity_id,source_id,cohort_id,conflict_id,alert_kind,window_key,
        severity,destination_key,delivery_status,response_code,
        metrics_sha256,metadata)
      values (
        v_alert_entity,null,v_cohort_id,null,'cohort_promotion_blocked',
        v_alert_window,'critical','ops_alerts','recorded',null,v_hash,
        jsonb_build_object(
          'contract_version','phase47-v1',
          'promotion_id',v_promo_id,
          'cohort_key',v_cohort.cohort_key,
          'required',v_required,
          'healthy',v_healthy,
          'entities_required',v_ent_req,
          'entities_healthy',v_ent_healthy
        ))
      on conflict (window_key) do nothing;
    end if;

    return jsonb_build_object(
      'version','phase47-v1',
      'promotion_id',v_promo_id,
      'cohort_id',v_cohort_id,
      'promotion_status','blocked',
      'gate',v_gate,
      'block_reason',v_reason);
  end if;

  -- Gate passed: wrap Phase 46 promote once (cohort-level activate).
  -- Per-entity Phase 46 promote would re-activate the same proposed version;
  -- instead promote against a representative entity whose gate already passed,
  -- then record cohort evidence. Never auto-approves money.
  if v_firm_wide or cardinality(v_cohort.entity_ids) = 0 then
    select coalesce(array_agg(distinct s.entity_id order by s.entity_id), '{}'::text[])
    into v_entity_ids
    from public.os_marketing_revenue_sources s
    where s.entity_id is not null;
  else
    v_entity_ids := v_cohort.entity_ids;
  end if;

  v_entity := v_entity_ids[1];
  v_one := public.promote_marketing_auto_reject_rule_phase46(
    jsonb_build_object(
      'created_by',v_actor,
      'entity_id',v_entity,
      'proposed_version_id',p_payload->>'proposed_version_id',
      'webhook_slo_windows_required',v_required,
      'thresholds',coalesce(p_payload->'thresholds','{}'::jsonb),
      'metadata',v_meta || jsonb_build_object(
        'cohort_id',v_cohort_id,
        'cohort_key',v_cohort.cohort_key,
        'contract_version','phase47-v1',
        'cohort_entity_count',cardinality(v_entity_ids))
    ));
  v_entity_results := jsonb_build_array(
    v_one || jsonb_build_object('entity_id',v_entity));
  v_version_id := nullif(v_one->>'rule_version_id','')::uuid;
  v_version_no := nullif(v_one->>'version_no','')::integer;
  v_activated := v_one->'activation';

  if coalesce(v_one->>'promotion_status','') is distinct from 'promoted' then
    v_status := 'blocked';
    v_reason := coalesce(v_one->>'block_reason',
      'Phase 46 promotion did not promote after cohort gate passed');
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase47-v1',
      'kind','cohort_promotion_blocked',
      'cohort_id',v_cohort_id,
      'entity_id',v_entity,
      'block_reason',v_reason,
      'actor_id',v_actor
    )::text);
    insert into public.os_marketing_revenue_cohort_promotions(
      cohort_id,rule_version_id,version_no,webhook_slo_windows_required,
      webhook_slo_windows_healthy,entities_required,entities_healthy,
      promotion_status,block_reason,metrics_sha256,metadata,actor_id)
    values (
      v_cohort_id,null,null,v_required,v_healthy,v_ent_req,v_ent_healthy,
      'blocked',left(coalesce(v_reason,''),500),v_hash,
      v_meta || jsonb_build_object(
        'contract_version','phase47-v1',
        'gate',v_gate,
        'entity_results',v_entity_results),
      v_actor)
    returning promotion_id into v_promo_id;
    return jsonb_build_object(
      'version','phase47-v1',
      'promotion_id',v_promo_id,
      'cohort_id',v_cohort_id,
      'promotion_status','blocked',
      'gate',v_gate,
      'entity_results',v_entity_results,
      'block_reason',v_reason);
  end if;

  v_status := 'promoted';
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase47-v1',
    'kind','cohort_promoted',
    'cohort_id',v_cohort_id,
    'rule_version_id',v_version_id,
    'version_no',v_version_no,
    'required',v_required,
    'healthy',v_healthy,
    'entities_required',v_ent_req,
    'entities_healthy',v_ent_healthy,
    'actor_id',v_actor
  )::text);

  insert into public.os_marketing_revenue_cohort_promotions(
    cohort_id,rule_version_id,version_no,webhook_slo_windows_required,
    webhook_slo_windows_healthy,entities_required,entities_healthy,
    promotion_status,block_reason,metrics_sha256,metadata,actor_id)
  values (
    v_cohort_id,v_version_id,v_version_no,v_required,v_healthy,
    v_ent_req,v_ent_healthy,'promoted',null,v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase47-v1',
      'gate',v_gate,
      'entity_results',v_entity_results,
      'activation',v_activated),
    v_actor)
  returning promotion_id into v_promo_id;

  select coalesce(v_cohort.entity_ids[1], v_entity_ids[1]) into v_alert_entity;
  if v_alert_entity is not null then
    v_alert_window := left(
      'cpromoted:' || v_cohort.cohort_key || ':' || v_promo_id::text, 200);
    insert into public.os_marketing_revenue_phase47_ops_alerts(
      entity_id,source_id,cohort_id,conflict_id,alert_kind,window_key,
      severity,destination_key,delivery_status,response_code,
      metrics_sha256,metadata)
    values (
      v_alert_entity,null,v_cohort_id,null,'cohort_promoted',
      v_alert_window,'critical','ops_alerts','recorded',null,v_hash,
      jsonb_build_object(
        'contract_version','phase47-v1',
        'promotion_id',v_promo_id,
        'cohort_key',v_cohort.cohort_key,
        'rule_version_id',v_version_id,
        'version_no',v_version_no
      ))
    on conflict (window_key) do nothing;
  end if;

  return jsonb_build_object(
    'version','phase47-v1',
    'promotion_id',v_promo_id,
    'cohort_id',v_cohort_id,
    'promotion_status',v_status,
    'gate',v_gate,
    'entity_results',v_entity_results,
    'activation',v_activated,
    'rule_version_id',v_version_id,
    'version_no',v_version_no);
end;
$$;

-- ---------------------------------------------------------------------------
-- Detect + list aging open attribution conflicts
-- ---------------------------------------------------------------------------
create or replace function public.detect_marketing_attribution_conflicts_aging_phase47(
  p_entity_id text,
  p_days integer default 30,
  p_aging_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_detect jsonb;
  v_aging jsonb;
  v_days integer := least(greatest(coalesce(p_days,30),1),90);
  v_aging_days integer := least(greatest(coalesce(p_aging_days,7),1),90);
begin
  v_detect := public.detect_marketing_revenue_attribution_conflicts_phase44(
    p_entity_id, v_days);
  v_aging := public.list_marketing_open_attribution_conflicts_aging_phase47(
    p_entity_id, v_aging_days, 50);
  return jsonb_build_object(
    'version','phase47-v1',
    'window_days',v_days,
    'aging_days',v_aging_days,
    'detect',v_detect,
    'aging',v_aging);
end;
$$;

create or replace function public.list_marketing_open_attribution_conflicts_aging_phase47(
  p_entity_id text,
  p_aging_days integer default 7,
  p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_aging_days integer := least(greatest(coalesce(p_aging_days,7),1),90);
  v_limit integer := least(greatest(coalesce(p_limit,50),1),200);
  v_cutoff timestamptz := now() - make_interval(
    days => least(greatest(coalesce(p_aging_days,7),1),90));
  v_rows jsonb;
begin
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'conflict_id',l.conflict_id,
      'conflict_key',l.conflict_key,
      'entity_id',l.entity_id,
      'conflict_kind',l.conflict_kind,
      'resolution_status',l.resolution_status,
      'age_days',round(
        extract(epoch from (now() - l.created_at)) / 86400.0, 2),
      'age_hours',round(
        extract(epoch from (now() - l.created_at)) / 3600.0, 2),
      'metrics_sha256',l.metrics_sha256,
      'created_at',l.created_at,
      'has_pending_closure',l.has_pending_closure
    ) order by l.created_at asc)
    from (
      select c.*,
        exists (
          select 1
          from public.os_marketing_revenue_attribution_conflict_closures x
          where x.conflict_id = c.conflict_id
            and x.closure_status = 'proposed'
        ) as has_pending_closure
      from public.os_marketing_revenue_attribution_conflicts c
      where c.created_at <= v_cutoff
        and c.resolution_status in ('open','proposed')
        and (p_entity_id is null or c.entity_id = p_entity_id)
        and not exists (
          select 1
          from public.os_marketing_revenue_attribution_conflict_closures cl
          where cl.conflict_id = c.conflict_id
            and cl.closure_status in ('closed','approved')
        )
      order by c.created_at asc
      limit v_limit
    ) l
  ), '[]'::jsonb) into v_rows;

  return jsonb_build_object(
    'version','phase47-v1',
    'aging_days',v_aging_days,
    'cutoff',v_cutoff,
    'conflicts',coalesce(v_rows,'[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Propose close (maker) — append-only closure evidence
-- ---------------------------------------------------------------------------
create or replace function public.propose_close_marketing_attribution_conflict_phase47(
  p_conflict_id uuid,
  p_resolution_notes text,
  p_actor uuid,
  p_metadata jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.os_marketing_revenue_attribution_conflicts%rowtype;
  v_meta jsonb := coalesce(p_metadata,'{}'::jsonb);
  v_hash text;
  v_id uuid;
begin
  if p_conflict_id is null
    or p_actor is null
    or length(coalesce(p_resolution_notes,'')) not between 10 and 500
    or not public.phase47_marketing_ops_safe_metadata(v_meta) then
    raise exception 'Conflict close proposal requires actor, notes, and safe metadata';
  end if;

  select * into v_row
  from public.os_marketing_revenue_attribution_conflicts
  where conflict_id = p_conflict_id
  for update;
  if not found then
    raise exception 'Attribution conflict is unknown';
  end if;
  if v_row.resolution_status not in ('open','proposed') then
    raise exception 'Only open or proposed attribution conflicts can be closed';
  end if;
  if exists (
    select 1
    from public.os_marketing_revenue_attribution_conflict_closures c
    where c.conflict_id = p_conflict_id
      and c.closure_status in ('proposed','closed','approved')
  ) then
    raise exception 'Attribution conflict already has a pending or completed closure';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase47-v1',
    'kind','conflict_closure_proposed',
    'conflict_id',p_conflict_id,
    'closed_by',p_actor,
    'notes_sha256',public.os_sha256_hex(p_resolution_notes)
  )::text);

  insert into public.os_marketing_revenue_attribution_conflict_closures(
    conflict_id,closure_status,resolution_notes,closed_by,metrics_sha256,metadata)
  values (
    p_conflict_id,'proposed',p_resolution_notes,p_actor,v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase47-v1',
      'lifecycle','proposed',
      'entity_id',v_row.entity_id))
  returning closure_id into v_id;

  -- Align Phase 44 conflict to proposed without approving money.
  if v_row.resolution_status = 'open' then
    perform public.propose_resolve_marketing_attribution_conflict_phase44(
      p_conflict_id,'proposed',p_resolution_notes,p_actor);
  end if;

  return jsonb_build_object(
    'version','phase47-v1',
    'closure_id',v_id,
    'conflict_id',p_conflict_id,
    'closure_status','proposed',
    'metrics_sha256',v_hash);
end;
$$;

-- ---------------------------------------------------------------------------
-- Review close (checker) — dual actor; approved → closed on conflict
-- ---------------------------------------------------------------------------
create or replace function public.review_close_marketing_attribution_conflict_phase47(
  p_conflict_id uuid,
  p_decision text,
  p_resolution_notes text,
  p_actor uuid,
  p_metadata jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_proposed public.os_marketing_revenue_attribution_conflict_closures%rowtype;
  v_meta jsonb := coalesce(p_metadata,'{}'::jsonb);
  v_hash text;
  v_id uuid;
  v_status text;
  v_phase44 text;
begin
  if p_conflict_id is null
    or p_actor is null
    or p_decision not in ('approved','rejected')
    or length(coalesce(p_resolution_notes,'')) not between 10 and 500
    or not public.phase47_marketing_ops_safe_metadata(v_meta) then
    raise exception 'Conflict close review requires dual-actor decision and notes';
  end if;

  select * into v_proposed
  from public.os_marketing_revenue_attribution_conflict_closures
  where conflict_id = p_conflict_id
    and closure_status = 'proposed'
  order by created_at desc
  limit 1
  for update;
  if not found then
    raise exception 'No proposed conflict closure to review';
  end if;
  if v_proposed.closed_by is not distinct from p_actor then
    raise exception 'Maker-checker requires a different actor than the proposer';
  end if;

  if p_decision is not distinct from 'approved' then
    v_status := 'closed';
    v_phase44 := 'approved';
  else
    v_status := 'rejected';
    v_phase44 := 'rejected';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase47-v1',
    'kind','conflict_closure_' || v_status,
    'conflict_id',p_conflict_id,
    'proposed_closure_id',v_proposed.closure_id,
    'closed_by',p_actor,
    'decision',p_decision,
    'notes_sha256',public.os_sha256_hex(p_resolution_notes)
  )::text);

  insert into public.os_marketing_revenue_attribution_conflict_closures(
    conflict_id,closure_status,resolution_notes,closed_by,metrics_sha256,metadata)
  values (
    p_conflict_id,v_status,p_resolution_notes,p_actor,v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase47-v1',
      'lifecycle',v_status,
      'decision',p_decision,
      'proposed_closure_id',v_proposed.closure_id,
      'proposed_by',v_proposed.closed_by))
  returning closure_id into v_id;

  -- Mirror onto Phase 44 conflict resolution (still never auto-approves money).
  perform public.propose_resolve_marketing_attribution_conflict_phase44(
    p_conflict_id,v_phase44,p_resolution_notes,p_actor);

  return jsonb_build_object(
    'version','phase47-v1',
    'closure_id',v_id,
    'conflict_id',p_conflict_id,
    'closure_status',v_status,
    'decision',p_decision,
    'metrics_sha256',v_hash);
end;
$$;

-- ---------------------------------------------------------------------------
-- List critical Phase 47 windows needing idempotent ops alerts
-- ---------------------------------------------------------------------------
create or replace function public.list_marketing_revenue_phase47_critical_windows(
  p_entity_id text,
  p_days integer default 30,
  p_window_hours integer default 24,
  p_aging_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_days integer := least(greatest(coalesce(p_days,30),1),90);
  v_hours integer := least(greatest(coalesce(p_window_hours,24),1),168);
  v_aging_days integer := least(greatest(coalesce(p_aging_days,7),1),90);
  v_bucket text;
  v_aging jsonb;
  v_pending_closures jsonb;
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
      'alert_kind','attribution_conflict_aging',
      'entity_id',c.entity_id,
      'source_id',null,
      'cohort_id',null,
      'conflict_id',c.conflict_id,
      'window_key','attrage:'||c.conflict_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','critical',
      'metrics_sha256',c.metrics_sha256,
      'age_days',c.age_days,
      'age_hours',c.age_hours,
      'conflict_kind',c.conflict_kind,
      'resolution_status',c.resolution_status
    ) order by c.age_hours desc)
    from jsonb_to_recordset(
      coalesce(
        (public.list_marketing_open_attribution_conflicts_aging_phase47(
          p_entity_id, v_aging_days, 50))->'conflicts',
        '[]'::jsonb)
    ) as c(
      conflict_id uuid,
      conflict_key text,
      entity_id text,
      conflict_kind text,
      resolution_status text,
      age_days numeric,
      age_hours numeric,
      metrics_sha256 text,
      created_at timestamptz,
      has_pending_closure boolean
    )
    where not exists (
      select 1 from public.os_marketing_revenue_phase47_ops_alerts x
      where x.window_key =
        'attrage:'||c.conflict_id::text||':'||v_bucket||'h'||v_hours::text
    )
    limit 50
  ), '[]'::jsonb) into v_aging;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','conflict_closure_pending',
      'entity_id',coalesce(cl.metadata->>'entity_id', cf.entity_id),
      'source_id',null,
      'cohort_id',null,
      'conflict_id',cl.conflict_id,
      'window_key','attrclose:'||cl.closure_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','critical',
      'metrics_sha256',cl.metrics_sha256,
      'closure_id',cl.closure_id,
      'closure_status',cl.closure_status,
      'age_hours',round(
        extract(epoch from (now() - cl.created_at)) / 3600.0, 2)
    ) order by cl.created_at asc)
    from public.os_marketing_revenue_attribution_conflict_closures cl
    join public.os_marketing_revenue_attribution_conflicts cf
      on cf.conflict_id = cl.conflict_id
    where cl.closure_status = 'proposed'
      and cl.created_at >= now() - make_interval(days => v_days)
      and (p_entity_id is null or cf.entity_id = p_entity_id)
      and not exists (
        select 1 from public.os_marketing_revenue_phase47_ops_alerts x
        where x.window_key =
          'attrclose:'||cl.closure_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 50
  ), '[]'::jsonb) into v_pending_closures;

  return jsonb_build_object(
    'version','phase47-v1',
    'window_days',v_days,
    'window_hours',v_hours,
    'aging_days',v_aging_days,
    'window_bucket',v_bucket,
    'pending',coalesce(v_aging,'[]'::jsonb)
      || coalesce(v_pending_closures,'[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Record one critical Phase 47 ops alert after delivery attempt
-- ---------------------------------------------------------------------------
create or replace function public.record_marketing_revenue_phase47_ops_alert(
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
  v_cohort uuid;
  v_conflict uuid;
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
  v_cohort := nullif(p_alert->>'cohort_id','')::uuid;
  v_conflict := nullif(p_alert->>'conflict_id','')::uuid;
  v_window := coalesce(p_alert->>'window_key','');
  v_dest := coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery := coalesce(p_alert->>'delivery_status','recorded');
  v_code := nullif(p_alert->>'response_code','')::integer;
  v_meta := coalesce(p_alert->'metadata','{}'::jsonb);

  if v_kind not in
      ('cohort_promotion_blocked','cohort_promoted',
       'attribution_conflict_aging','conflict_closure_pending')
    or v_entity = ''
    or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
    or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
    or v_dest ~* '://|^https?'
    or v_delivery not in
      ('delivered','skipped_no_webhook','failed','recorded')
    or not public.phase47_marketing_ops_safe_metadata(v_meta) then
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
    'version','phase47-v1',
    'alert_kind',v_kind,
    'entity_id',v_entity,
    'source_id',v_source,
    'cohort_id',v_cohort,
    'conflict_id',v_conflict,
    'window_key',v_window,
    'severity','critical',
    'destination_key',v_dest,
    'delivery_status',v_delivery,
    'response_code',v_code
  )::text);

  insert into public.os_marketing_revenue_phase47_ops_alerts(
    entity_id,source_id,cohort_id,conflict_id,alert_kind,window_key,
    severity,destination_key,delivery_status,response_code,
    metrics_sha256,metadata)
  values (
    v_entity,v_source,v_cohort,v_conflict,v_kind,v_window,'critical',v_dest,
    v_delivery,v_code,v_hash,
    v_meta || jsonb_build_object('contract_version','phase47-v1'))
  on conflict (window_key) do nothing
  returning alert_id, delivery_status into v_id, v_status;

  if v_id is null then
    select alert_id, delivery_status into v_id, v_status
    from public.os_marketing_revenue_phase47_ops_alerts
    where window_key = v_window;
    return jsonb_build_object(
      'version','phase47-v1',
      'alert_id',v_id,
      'window_key',v_window,
      'delivery_status',v_status,
      'inserted',false);
  end if;

  return jsonb_build_object(
    'version','phase47-v1',
    'alert_id',v_id,
    'window_key',v_window,
    'delivery_status',v_status,
    'inserted',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Hub report: cohort gates, promotions, conflict closures, aging, alerts
-- ---------------------------------------------------------------------------
create or replace function public.get_marketing_revenue_phase47_ops_report(
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
  v_defaults jsonb := public.phase47_default_cohort_thresholds();
  v_aging_days integer := coalesce((v_defaults->>'conflict_aging_days')::integer,7);
  v_cohorts jsonb;
  v_promotions jsonb;
  v_closures jsonb;
  v_aging jsonb;
  v_alerts jsonb;
  v_sample_gate jsonb;
  v_cohort_gate_health text := 'unknown';
  v_conflict_aging_health text := 'unknown';
  v_closure_health text := 'unknown';
  v_alert_delivery text := 'none';
  v_open_aging integer := 0;
  v_pending_closures integer := 0;
begin
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'cohort_id',c.cohort_id,
      'cohort_key',c.cohort_key,
      'entity_ids',to_jsonb(c.entity_ids),
      'status',c.status,
      'firm_wide',cardinality(c.entity_ids) = 0,
      'metrics_sha256',c.metrics_sha256,
      'created_at',c.created_at,
      'created_by',c.created_by
    ) order by c.created_at desc)
    from public.os_marketing_revenue_promotion_cohorts c
    where c.status = 'active'
      and (
        p_entity_id is null
        or cardinality(c.entity_ids) = 0
        or p_entity_id = any (c.entity_ids)
      )
    limit 50
  ), '[]'::jsonb) into v_cohorts;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'promotion_id',p.promotion_id,
      'cohort_id',p.cohort_id,
      'rule_version_id',p.rule_version_id,
      'version_no',p.version_no,
      'webhook_slo_windows_required',p.webhook_slo_windows_required,
      'webhook_slo_windows_healthy',p.webhook_slo_windows_healthy,
      'entities_required',p.entities_required,
      'entities_healthy',p.entities_healthy,
      'promotion_status',p.promotion_status,
      'block_reason',p.block_reason,
      'metrics_sha256',p.metrics_sha256,
      'created_at',p.created_at,
      'actor_id',p.actor_id
    ) order by p.created_at desc)
    from public.os_marketing_revenue_cohort_promotions p
    join public.os_marketing_revenue_promotion_cohorts c
      on c.cohort_id = p.cohort_id
    where p.created_at >= v_since
      and (
        p_entity_id is null
        or cardinality(c.entity_ids) = 0
        or p_entity_id = any (c.entity_ids)
      )
    limit 50
  ), '[]'::jsonb) into v_promotions;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'closure_id',cl.closure_id,
      'conflict_id',cl.conflict_id,
      'closure_status',cl.closure_status,
      'resolution_notes',cl.resolution_notes,
      'closed_by',cl.closed_by,
      'metrics_sha256',cl.metrics_sha256,
      'created_at',cl.created_at,
      'entity_id',cf.entity_id
    ) order by cl.created_at desc)
    from public.os_marketing_revenue_attribution_conflict_closures cl
    join public.os_marketing_revenue_attribution_conflicts cf
      on cf.conflict_id = cl.conflict_id
    where cl.created_at >= v_since
      and (p_entity_id is null or cf.entity_id = p_entity_id)
    limit 50
  ), '[]'::jsonb) into v_closures;

  v_aging := public.list_marketing_open_attribution_conflicts_aging_phase47(
    p_entity_id, v_aging_days, 50);

  select coalesce(jsonb_array_length(v_aging->'conflicts'),0) into v_open_aging;

  select count(*)::integer into v_pending_closures
  from public.os_marketing_revenue_attribution_conflict_closures cl
  join public.os_marketing_revenue_attribution_conflicts cf
    on cf.conflict_id = cl.conflict_id
  where cl.closure_status = 'proposed'
    and cl.created_at >= v_since
    and (p_entity_id is null or cf.entity_id = p_entity_id);

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_id',a.alert_id,
      'entity_id',a.entity_id,
      'source_id',a.source_id,
      'cohort_id',a.cohort_id,
      'conflict_id',a.conflict_id,
      'alert_kind',a.alert_kind,
      'window_key',a.window_key,
      'severity',a.severity,
      'destination_key',a.destination_key,
      'delivery_status',a.delivery_status,
      'response_code',a.response_code,
      'metrics_sha256',a.metrics_sha256,
      'created_at',a.created_at
    ) order by a.created_at desc)
    from public.os_marketing_revenue_phase47_ops_alerts a
    where a.created_at >= v_since
      and (p_entity_id is null or a.entity_id = p_entity_id)
    limit 50
  ), '[]'::jsonb) into v_alerts;

  -- Sample gate from first active cohort (or firm-wide empty cohort semantics).
  select public.evaluate_marketing_cohort_promotion_gate_phase47(
    jsonb_build_object(
      'cohort_id',c.cohort_id,
      'thresholds',v_defaults
    ))
  into v_sample_gate
  from public.os_marketing_revenue_promotion_cohorts c
  where c.status = 'active'
    and (
      p_entity_id is null
      or cardinality(c.entity_ids) = 0
      or p_entity_id = any (c.entity_ids)
    )
  order by c.created_at desc
  limit 1;

  if v_sample_gate is null then
    v_cohort_gate_health := 'unknown';
  elsif coalesce((v_sample_gate->>'gate_passed')::boolean,false) then
    v_cohort_gate_health := 'healthy';
  elsif coalesce((v_sample_gate->>'entities_required')::integer,0) = 0 then
    v_cohort_gate_health := 'unknown';
  else
    v_cohort_gate_health := 'critical';
  end if;

  if v_open_aging = 0 then
    v_conflict_aging_health := 'healthy';
  elsif v_open_aging >= 5 then
    v_conflict_aging_health := 'critical';
  else
    v_conflict_aging_health := 'warning';
  end if;

  if v_pending_closures = 0 then
    v_closure_health := 'healthy';
  elsif v_pending_closures >= 3 then
    v_closure_health := 'critical';
  else
    v_closure_health := 'warning';
  end if;

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
    'version','phase47-v1',
    'window_days',v_days,
    'cohort_gate_health',v_cohort_gate_health,
    'conflict_aging_health',v_conflict_aging_health,
    'closure_health',v_closure_health,
    'alert_delivery',v_alert_delivery,
    'open_aging_count',v_open_aging,
    'pending_closure_count',v_pending_closures,
    'cohort_gate',v_sample_gate,
    'thresholds',v_defaults,
    'cohorts',coalesce(v_cohorts,'[]'::jsonb),
    'cohort_promotions',coalesce(v_promotions,'[]'::jsonb),
    'conflict_closures',coalesce(v_closures,'[]'::jsonb),
    'aging_conflicts',coalesce(v_aging->'conflicts','[]'::jsonb),
    'alerts',coalesce(v_alerts,'[]'::jsonb),
    'destination_key','ops_alerts');
end;
$$;

revoke all on function public.prevent_marketing_revenue_phase47_ops_mutation()
  from public, anon, authenticated;
revoke all on function public.prevent_marketing_revenue_phase47_cohort_delete()
  from public, anon, authenticated;
revoke all on function public.phase47_marketing_ops_safe_metadata(jsonb)
  from public, anon, authenticated;
revoke all on function public.phase47_default_cohort_thresholds()
  from public, anon, authenticated;
revoke all on function public.phase47_normalize_entity_ids(text[])
  from public, anon, authenticated;
revoke all on function public.upsert_marketing_promotion_cohort_phase47(jsonb)
  from public, anon, authenticated;
revoke all on function public.evaluate_marketing_cohort_promotion_gate_phase47(jsonb)
  from public, anon, authenticated;
revoke all on function public.promote_marketing_auto_reject_cohort_phase47(jsonb)
  from public, anon, authenticated;
revoke all on function public.detect_marketing_attribution_conflicts_aging_phase47(text,integer,integer)
  from public, anon, authenticated;
revoke all on function public.list_marketing_open_attribution_conflicts_aging_phase47(text,integer,integer)
  from public, anon, authenticated;
revoke all on function public.propose_close_marketing_attribution_conflict_phase47(uuid,text,uuid,jsonb)
  from public, anon, authenticated;
revoke all on function public.review_close_marketing_attribution_conflict_phase47(uuid,text,text,uuid,jsonb)
  from public, anon, authenticated;
revoke all on function public.list_marketing_revenue_phase47_critical_windows(text,integer,integer,integer)
  from public, anon, authenticated;
revoke all on function public.record_marketing_revenue_phase47_ops_alert(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_marketing_revenue_phase47_ops_report(text,integer)
  from public, anon, authenticated;

grant execute on function public.phase47_marketing_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.phase47_default_cohort_thresholds()
  to authenticated, service_role;
grant execute on function public.evaluate_marketing_cohort_promotion_gate_phase47(jsonb)
  to authenticated, service_role;
grant execute on function public.list_marketing_open_attribution_conflicts_aging_phase47(text,integer,integer)
  to authenticated, service_role;
grant execute on function public.list_marketing_revenue_phase47_critical_windows(text,integer,integer,integer)
  to authenticated, service_role;
grant execute on function public.get_marketing_revenue_phase47_ops_report(text,integer)
  to authenticated, service_role;

grant execute on function public.upsert_marketing_promotion_cohort_phase47(jsonb)
  to service_role;
grant execute on function public.promote_marketing_auto_reject_cohort_phase47(jsonb)
  to service_role;
grant execute on function public.detect_marketing_attribution_conflicts_aging_phase47(text,integer,integer)
  to service_role;
grant execute on function public.propose_close_marketing_attribution_conflict_phase47(uuid,text,uuid,jsonb)
  to authenticated, service_role;
grant execute on function public.review_close_marketing_attribution_conflict_phase47(uuid,text,text,uuid,jsonb)
  to authenticated, service_role;
grant execute on function public.record_marketing_revenue_phase47_ops_alert(jsonb)
  to service_role;
