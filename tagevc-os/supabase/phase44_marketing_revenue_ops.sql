-- Phase 44: marketing revenue correction validation, attribution conflict tracking,
-- reconciliation gap snapshots, and proactive ops alerts.
-- Apply after phase43_marketing_slo_ops_alerts.sql. Safe to re-run.
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
-- Append-only correction validation evidence
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_correction_validations (
  validation_id uuid primary key default gen_random_uuid(),
  correction_id uuid not null
    references public.os_marketing_revenue_corrections(correction_id),
  entity_id text not null references public.entities(entity_id),
  validation_status text not null check (validation_status in
    ('passed','failed','auto_rejected')),
  fail_reason text check (fail_reason is null or length(fail_reason) between 10 and 500),
  age_hours numeric not null check (age_hours >= 0),
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

create index if not exists os_mkt_rev_corr_val_entity_idx
  on public.os_marketing_revenue_correction_validations
    (entity_id, created_at desc);
create index if not exists os_mkt_rev_corr_val_corr_idx
  on public.os_marketing_revenue_correction_validations
    (correction_id, created_at desc);

alter table public.os_marketing_revenue_correction_validations
  enable row level security;

-- ---------------------------------------------------------------------------
-- Attribution model conflicts (resolution via security-definer maker-checker)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_attribution_conflicts (
  conflict_id uuid primary key default gen_random_uuid(),
  conflict_key text not null unique
    check (conflict_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  entity_id text not null references public.entities(entity_id),
  window_start timestamptz not null,
  window_end timestamptz not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  window_days integer not null check (window_days between 1 and 90),
  conflict_kind text not null check (conflict_kind in
    ('event_set_mismatch','amount_delta_threshold','model_count_gap')),
  model_digests jsonb not null default '[]'::jsonb,
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  resolution_status text not null default 'open' check (resolution_status in
    ('open','proposed','approved','rejected')),
  resolution_reason text
    check (resolution_reason is null or length(resolution_reason) between 10 and 500),
  resolved_by uuid,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (window_end >= window_start),
  check (jsonb_typeof(model_digests) = 'array'),
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (not (metadata ?| array[
    'authorization','cookie','set-cookie','token','secret','signature','jwt',
    'credential','password','payload','body','value','env_value','url'
  ]))
);

create index if not exists os_mkt_rev_attr_conflict_entity_idx
  on public.os_marketing_revenue_attribution_conflicts
    (entity_id, created_at desc);
create index if not exists os_mkt_rev_attr_conflict_status_idx
  on public.os_marketing_revenue_attribution_conflicts
    (resolution_status, created_at desc);

alter table public.os_marketing_revenue_attribution_conflicts
  enable row level security;

-- ---------------------------------------------------------------------------
-- Append-only reconciliation gap snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_reconciliation_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities(entity_id),
  source_id uuid references public.os_marketing_revenue_sources(source_id),
  reconciliation_status text not null check (reconciliation_status in
    ('complete','incomplete','failed','denominator_inconsistent','unavailable')),
  expected_count integer not null check (expected_count >= 0),
  observed_count integer not null check (observed_count >= 0),
  completeness_pct numeric,
  late_records integer not null default 0 check (late_records >= 0),
  staged_corrections integer not null default 0 check (staged_corrections >= 0),
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

create index if not exists os_mkt_rev_recon_snap_entity_idx
  on public.os_marketing_revenue_reconciliation_snapshots
    (entity_id, created_at desc);
create index if not exists os_mkt_rev_recon_snap_source_idx
  on public.os_marketing_revenue_reconciliation_snapshots
    (source_id, created_at desc);

alter table public.os_marketing_revenue_reconciliation_snapshots
  enable row level security;

-- ---------------------------------------------------------------------------
-- Append-only Phase 44 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_phase44_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities(entity_id),
  source_id uuid references public.os_marketing_revenue_sources(source_id),
  alert_kind text not null check (alert_kind in
    ('correction_queue_critical','correction_validation_failed',
     'attribution_conflict','recon_incomplete','recon_denominator_inconsistent',
     'late_records_critical')),
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

create index if not exists os_mkt_rev_p44_ops_alert_entity_idx
  on public.os_marketing_revenue_phase44_ops_alerts
    (entity_id, created_at desc);
create index if not exists os_mkt_rev_p44_ops_alert_kind_idx
  on public.os_marketing_revenue_phase44_ops_alerts
    (alert_kind, created_at desc);

alter table public.os_marketing_revenue_phase44_ops_alerts
  enable row level security;

do $$
begin
  revoke all on public.os_marketing_revenue_correction_validations
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_correction_validations from service_role;
  grant select on public.os_marketing_revenue_correction_validations
    to service_role;

  revoke all on public.os_marketing_revenue_attribution_conflicts
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_attribution_conflicts from service_role;
  grant select on public.os_marketing_revenue_attribution_conflicts
    to service_role;

  revoke all on public.os_marketing_revenue_reconciliation_snapshots
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_reconciliation_snapshots from service_role;
  grant select on public.os_marketing_revenue_reconciliation_snapshots
    to service_role;

  revoke all on public.os_marketing_revenue_phase44_ops_alerts
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_phase44_ops_alerts from service_role;
  grant select on public.os_marketing_revenue_phase44_ops_alerts
    to service_role;
end $$;

create or replace function public.prevent_marketing_revenue_phase44_ops_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  raise exception 'Marketing revenue Phase 44 ops evidence is append-only';
end;
$$;

drop trigger if exists os_mkt_rev_corr_val_immutable
  on public.os_marketing_revenue_correction_validations;
create trigger os_mkt_rev_corr_val_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_correction_validations
  for each statement
  execute function public.prevent_marketing_revenue_phase44_ops_mutation();

-- Conflicts allow resolution updates via security-definer; block delete/truncate.
drop trigger if exists os_mkt_rev_attr_conflict_immutable
  on public.os_marketing_revenue_attribution_conflicts;
create trigger os_mkt_rev_attr_conflict_immutable
  before delete or truncate
  on public.os_marketing_revenue_attribution_conflicts
  for each statement
  execute function public.prevent_marketing_revenue_phase44_ops_mutation();

drop trigger if exists os_mkt_rev_recon_snap_immutable
  on public.os_marketing_revenue_reconciliation_snapshots;
create trigger os_mkt_rev_recon_snap_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_reconciliation_snapshots
  for each statement
  execute function public.prevent_marketing_revenue_phase44_ops_mutation();

drop trigger if exists os_mkt_rev_p44_ops_alert_immutable
  on public.os_marketing_revenue_phase44_ops_alerts;
create trigger os_mkt_rev_p44_ops_alert_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_phase44_ops_alerts
  for each statement
  execute function public.prevent_marketing_revenue_phase44_ops_mutation();

create or replace function public.phase44_marketing_ops_safe_metadata(p_detail jsonb)
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

-- ---------------------------------------------------------------------------
-- Fail-closed correction contract validation (NEVER auto-approves)
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
begin
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
    elsif length(coalesce(v_corr.reason,'')) not between 10 and 500 then
      v_fail := 'Correction reason length is outside the 10-500 contract';
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
      begin
        perform public.approve_marketing_revenue_correction(
          v_corr.correction_id,
          null,
          'rejected',
          left('Phase44 fail-closed auto-reject: ' || v_fail, 500));
        v_reject_ok := true;
      exception
        when others then
          v_reject_ok := false;
      end;
      if v_reject_ok then
        v_status := 'auto_rejected';
        v_auto_rejected := v_auto_rejected + 1;
      else
        v_status := 'failed';
        v_failed := v_failed + 1;
      end if;
    end if;

    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase44-v1',
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
        'contract_version','phase44-v1',
        'metric','correction_validation',
        'reject_applied',v_reject_ok,
        'proposed_revision',v_corr.proposed_revision
      ));
  end loop;

  return jsonb_build_object(
    'version','phase44-v1',
    'passed',v_passed,
    'failed',v_failed,
    'auto_rejected',v_auto_rejected);
end;
$$;

-- ---------------------------------------------------------------------------
-- Detect attribution model conflicts from allocations
-- ---------------------------------------------------------------------------
create or replace function public.detect_marketing_revenue_attribution_conflicts_phase44(
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
  v_entity_models integer;
begin
  select count(distinct attribution_model)::integer into v_entity_models
  from public.os_marketing_revenue_allocations a
  where a.cohort_window_start >= v_since
    and (p_entity_id is null or a.entity_id = p_entity_id);

  with latest as (
    select a.*,
      row_number() over (
        partition by a.source_id,a.source_record_id,a.revenue_event_id,
          a.attribution_model,a.cohort_key
        order by a.source_revision desc, a.received_at desc
      ) rn
    from public.os_marketing_revenue_allocations a
    where a.cohort_window_start >= v_since
      and (p_entity_id is null or a.entity_id = p_entity_id)
  ),
  current_rows as (select * from latest where rn = 1),
  model_sets as (
    select entity_id,cohort_key,cohort_window_start,cohort_window_end,currency,
      attribution_window_days,attribution_model,
      count(distinct revenue_event_id)::int event_count,
      sum(amount_micros)::numeric amount_sum,
      public.os_sha256_hex(
        coalesce(jsonb_agg(distinct revenue_event_id order by revenue_event_id),
          '[]'::jsonb)::text) event_set_sha256
    from current_rows
    group by entity_id,cohort_key,cohort_window_start,cohort_window_end,
      currency,attribution_window_days,attribution_model
  ),
  grouped as (
    select entity_id,cohort_key,cohort_window_start,cohort_window_end,currency,
      attribution_window_days,
      count(*)::int model_count,
      count(distinct event_set_sha256)::int distinct_event_sets,
      max(amount_sum) - min(amount_sum) as amount_delta,
      greatest(max(amount_sum),1) as amount_max,
      jsonb_agg(jsonb_build_object(
        'attribution_model',attribution_model,
        'event_set_sha256',event_set_sha256,
        'event_count',event_count,
        'amount_sum',amount_sum::text
      ) order by attribution_model) model_digests
    from model_sets
    group by entity_id,cohort_key,cohort_window_start,cohort_window_end,
      currency,attribution_window_days
  ),
  candidates as (
    select g.*,
      'event_set_mismatch'::text conflict_kind
    from grouped g
    where g.model_count >= 2 and g.distinct_event_sets > 1
    union all
    select g.*,
      'amount_delta_threshold'::text conflict_kind
    from grouped g
    where g.model_count >= 2
      and g.distinct_event_sets = 1
      and g.amount_delta > 0
      and (g.amount_delta / g.amount_max) >= 0.01
    union all
    select g.*,
      'model_count_gap'::text conflict_kind
    from grouped g
    where g.model_count = 1
      and coalesce(v_entity_models,0) >= 2
  )
  insert into public.os_marketing_revenue_attribution_conflicts(
    conflict_key,entity_id,window_start,window_end,currency,window_days,
    conflict_kind,model_digests,metrics_sha256,resolution_status,metadata)
  select
    left(
      conflict_kind || ':' || entity_id || ':' ||
      public.os_sha256_hex(jsonb_build_object(
        'cohort_key',cohort_key,
        'window_start',cohort_window_start,
        'window_end',cohort_window_end,
        'currency',currency,
        'window_days',attribution_window_days,
        'kind',conflict_kind
      )::text),
      200),
    entity_id,
    cohort_window_start,
    cohort_window_end,
    currency,
    attribution_window_days,
    conflict_kind,
    model_digests,
    public.os_sha256_hex(jsonb_build_object(
      'version','phase44-v1',
      'conflict_kind',conflict_kind,
      'entity_id',entity_id,
      'cohort_key',cohort_key,
      'model_count',model_count,
      'distinct_event_sets',distinct_event_sets,
      'amount_delta',amount_delta
    )::text),
    'open',
    jsonb_build_object(
      'contract_version','phase44-v1',
      'cohort_key',left(cohort_key,200),
      'model_count',model_count,
      'distinct_event_sets',distinct_event_sets
    )
  from candidates
  on conflict (conflict_key) do nothing;

  get diagnostics v_inserted = row_count;

  return jsonb_build_object(
    'version','phase44-v1',
    'window_days',v_days,
    'conflicts_inserted',v_inserted);
end;
$$;

-- ---------------------------------------------------------------------------
-- Maker-checker attribution conflict resolution
-- ---------------------------------------------------------------------------
create or replace function public.propose_resolve_marketing_attribution_conflict_phase44(
  p_conflict_id uuid,
  p_resolution text,
  p_reason text,
  p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.os_marketing_revenue_attribution_conflicts%rowtype;
begin
  if p_resolution not in ('proposed','approved','rejected')
    or length(coalesce(p_reason,'')) not between 10 and 500
    or p_actor is null then
    raise exception 'Attribution conflict resolution requires actor and reason';
  end if;

  select * into v_row
  from public.os_marketing_revenue_attribution_conflicts
  where conflict_id = p_conflict_id
  for update;

  if not found then
    raise exception 'Attribution conflict is unknown';
  end if;

  if p_resolution = 'proposed' then
    if v_row.resolution_status is distinct from 'open' then
      raise exception 'Only open attribution conflicts can be proposed';
    end if;
    update public.os_marketing_revenue_attribution_conflicts
    set resolution_status = 'proposed',
      resolution_reason = p_reason,
      resolved_by = p_actor,
      resolved_at = now(),
      metadata = metadata || jsonb_build_object(
        'proposed_by',p_actor,
        'proposed_at',now())
    where conflict_id = p_conflict_id;
  elsif p_resolution in ('approved','rejected') then
    if v_row.resolution_status is distinct from 'proposed' then
      raise exception 'Only proposed attribution conflicts can be approved or rejected';
    end if;
    if v_row.resolved_by is not distinct from p_actor then
      raise exception 'Maker-checker requires a different actor than the proposer';
    end if;
    update public.os_marketing_revenue_attribution_conflicts
    set resolution_status = p_resolution,
      resolution_reason = p_reason,
      resolved_by = p_actor,
      resolved_at = now(),
      metadata = metadata || jsonb_build_object(
        'reviewed_by',p_actor,
        'reviewed_at',now(),
        'final_resolution',p_resolution)
    where conflict_id = p_conflict_id;
  end if;

  return jsonb_build_object(
    'version','phase44-v1',
    'conflict_id',p_conflict_id,
    'resolution_status',p_resolution);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reconciliation gap snapshots from source run completeness
-- ---------------------------------------------------------------------------
create or replace function public.record_marketing_revenue_reconciliation_snapshots_phase44(
  p_entity_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_since timestamptz := now() - interval '30 days';
  v_inserted integer := 0;
begin
  insert into public.os_marketing_revenue_reconciliation_snapshots(
    entity_id,source_id,reconciliation_status,expected_count,observed_count,
    completeness_pct,late_records,staged_corrections,metrics_sha256,metadata)
  select
    s.entity_id,
    s.source_id,
    case
      when count(r.run_id) filter (where r.status = 'failed') > 0 then 'failed'
      when coalesce(sum(r.expected_records),0) = coalesce(sum(r.observed_records),0)
        and count(r.run_id) > 0 then 'complete'
      when coalesce(sum(r.observed_records),0) > coalesce(sum(r.expected_records),0)
        then 'denominator_inconsistent'
      when count(r.run_id) > 0 then 'incomplete'
      else 'unavailable'
    end,
    coalesce(sum(r.expected_records),0)::integer,
    coalesce(sum(r.observed_records),0)::integer,
    case
      when coalesce(sum(r.expected_records),0) = 0 then null
      else round(100.0 * sum(r.observed_records) / sum(r.expected_records), 2)
    end,
    coalesce(sum(r.late_records),0)::integer,
    coalesce(sum(r.staged_corrections),0)::integer,
    public.os_sha256_hex(jsonb_build_object(
      'version','phase44-v1',
      'entity_id',s.entity_id,
      'source_id',s.source_id,
      'expected',coalesce(sum(r.expected_records),0),
      'observed',coalesce(sum(r.observed_records),0),
      'late',coalesce(sum(r.late_records),0),
      'staged',coalesce(sum(r.staged_corrections),0)
    )::text),
    jsonb_build_object(
      'contract_version','phase44-v1',
      'metric','reconciliation_snapshot',
      'window_days',30)
  from public.os_marketing_revenue_sources s
  left join public.os_marketing_revenue_pull_runs r
    on r.source_id = s.source_id and r.queued_at >= v_since
  where p_entity_id is null or s.entity_id = p_entity_id
  group by s.entity_id, s.source_id;

  get diagnostics v_inserted = row_count;

  return jsonb_build_object(
    'version','phase44-v1',
    'snapshots_recorded',v_inserted);
end;
$$;

-- ---------------------------------------------------------------------------
-- List critical windows that still need an idempotent ops alert insert
-- ---------------------------------------------------------------------------
create or replace function public.list_marketing_revenue_phase44_critical_windows(
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
  v_corr_queue jsonb;
  v_corr_fail jsonb;
  v_conflict jsonb;
  v_recon_inc jsonb;
  v_recon_den jsonb;
  v_late jsonb;
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
      'alert_kind','correction_queue_critical',
      'entity_id',l.entity_id,
      'source_id',null,
      'window_key','corrqueue:'||l.entity_id||':'||v_bucket||'h'||v_hours::text,
      'severity','critical',
      'metrics_sha256',l.metrics_sha256,
      'pending_count',l.pending_count,
      'max_age_hours',l.max_age_hours
    ) order by l.entity_id)
    from (
      select s.entity_id,
        count(*)::integer pending_count,
        round(max(extract(epoch from (now() - c.created_at)) / 3600.0), 2) max_age_hours,
        public.os_sha256_hex(jsonb_build_object(
          'version','phase44-v1',
          'kind','correction_queue_critical',
          'entity_id',s.entity_id,
          'pending',count(*)
        )::text) metrics_sha256
      from public.os_marketing_revenue_corrections c
      join public.os_marketing_revenue_sources s using (source_id)
      where c.status = 'pending'
        and c.created_at >= v_since
        and (p_entity_id is null or s.entity_id = p_entity_id)
      group by s.entity_id
      having count(*) >= 5
        or max(extract(epoch from (now() - c.created_at)) / 3600.0) >= 24
    ) l
    where not exists (
      select 1 from public.os_marketing_revenue_phase44_ops_alerts x
      where x.window_key =
        'corrqueue:'||l.entity_id||':'||v_bucket||'h'||v_hours::text
    )
    limit 50
  ), '[]'::jsonb) into v_corr_queue;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','correction_validation_failed',
      'entity_id',l.entity_id,
      'source_id',null,
      'window_key','corrfail:'||l.entity_id||':'||v_bucket||'h'||v_hours::text,
      'severity','critical',
      'metrics_sha256',l.metrics_sha256,
      'validation_id',l.validation_id,
      'validation_status',l.validation_status
    ) order by l.entity_id)
    from (
      select v.*,
        row_number() over (
          partition by v.entity_id
          order by v.created_at desc, v.validation_id desc
        ) rn
      from public.os_marketing_revenue_correction_validations v
      where v.created_at >= v_since
        and v.validation_status in ('failed','auto_rejected')
        and (p_entity_id is null or v.entity_id = p_entity_id)
    ) l
    where l.rn = 1
      and not exists (
        select 1 from public.os_marketing_revenue_phase44_ops_alerts x
        where x.window_key =
          'corrfail:'||l.entity_id||':'||v_bucket||'h'||v_hours::text
      )
    limit 50
  ), '[]'::jsonb) into v_corr_fail;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','attribution_conflict',
      'entity_id',l.entity_id,
      'source_id',null,
      'window_key','attrconf:'||l.conflict_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','critical',
      'metrics_sha256',l.metrics_sha256,
      'conflict_id',l.conflict_id,
      'conflict_kind',l.conflict_kind
    ) order by l.created_at desc)
    from public.os_marketing_revenue_attribution_conflicts l
    where l.created_at >= v_since
      and l.resolution_status in ('open','proposed')
      and (p_entity_id is null or l.entity_id = p_entity_id)
      and not exists (
        select 1 from public.os_marketing_revenue_phase44_ops_alerts x
        where x.window_key =
          'attrconf:'||l.conflict_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 50
  ), '[]'::jsonb) into v_conflict;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','recon_incomplete',
      'entity_id',l.entity_id,
      'source_id',l.source_id,
      'window_key','reconinc:'||l.source_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','critical',
      'metrics_sha256',l.metrics_sha256,
      'snapshot_id',l.snapshot_id,
      'reconciliation_status',l.reconciliation_status
    ) order by l.source_id)
    from (
      select s.*,
        row_number() over (
          partition by s.source_id
          order by s.created_at desc, s.snapshot_id desc
        ) rn
      from public.os_marketing_revenue_reconciliation_snapshots s
      where s.created_at >= v_since
        and s.reconciliation_status = 'incomplete'
        and (p_entity_id is null or s.entity_id = p_entity_id)
    ) l
    where l.rn = 1
      and not exists (
        select 1 from public.os_marketing_revenue_phase44_ops_alerts x
        where x.window_key =
          'reconinc:'||l.source_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 50
  ), '[]'::jsonb) into v_recon_inc;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','recon_denominator_inconsistent',
      'entity_id',l.entity_id,
      'source_id',l.source_id,
      'window_key','reconden:'||l.source_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','critical',
      'metrics_sha256',l.metrics_sha256,
      'snapshot_id',l.snapshot_id,
      'reconciliation_status',l.reconciliation_status
    ) order by l.source_id)
    from (
      select s.*,
        row_number() over (
          partition by s.source_id
          order by s.created_at desc, s.snapshot_id desc
        ) rn
      from public.os_marketing_revenue_reconciliation_snapshots s
      where s.created_at >= v_since
        and s.reconciliation_status = 'denominator_inconsistent'
        and (p_entity_id is null or s.entity_id = p_entity_id)
    ) l
    where l.rn = 1
      and not exists (
        select 1 from public.os_marketing_revenue_phase44_ops_alerts x
        where x.window_key =
          'reconden:'||l.source_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 50
  ), '[]'::jsonb) into v_recon_den;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','late_records_critical',
      'entity_id',l.entity_id,
      'source_id',l.source_id,
      'window_key','latecrit:'||l.source_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','critical',
      'metrics_sha256',l.metrics_sha256,
      'snapshot_id',l.snapshot_id,
      'late_records',l.late_records
    ) order by l.source_id)
    from (
      select s.*,
        row_number() over (
          partition by s.source_id
          order by s.created_at desc, s.snapshot_id desc
        ) rn
      from public.os_marketing_revenue_reconciliation_snapshots s
      where s.created_at >= v_since
        and s.late_records >= 10
        and (p_entity_id is null or s.entity_id = p_entity_id)
    ) l
    where l.rn = 1
      and not exists (
        select 1 from public.os_marketing_revenue_phase44_ops_alerts x
        where x.window_key =
          'latecrit:'||l.source_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 50
  ), '[]'::jsonb) into v_late;

  return jsonb_build_object(
    'version','phase44-v1',
    'window_days',v_days,
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',coalesce(v_corr_queue,'[]'::jsonb)
      || coalesce(v_corr_fail,'[]'::jsonb)
      || coalesce(v_conflict,'[]'::jsonb)
      || coalesce(v_recon_inc,'[]'::jsonb)
      || coalesce(v_recon_den,'[]'::jsonb)
      || coalesce(v_late,'[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Record one critical ops alert after delivery attempt (idempotent window_key)
-- ---------------------------------------------------------------------------
create or replace function public.record_marketing_revenue_phase44_ops_alert(
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
      ('correction_queue_critical','correction_validation_failed',
       'attribution_conflict','recon_incomplete','recon_denominator_inconsistent',
       'late_records_critical')
    or v_entity = ''
    or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
    or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
    or v_dest ~* '://|^https?'
    or v_delivery not in
      ('delivered','skipped_no_webhook','failed','recorded')
    or not public.phase44_marketing_ops_safe_metadata(v_meta) then
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
    'version','phase44-v1',
    'alert_kind',v_kind,
    'entity_id',v_entity,
    'source_id',v_source,
    'window_key',v_window,
    'severity','critical',
    'destination_key',v_dest,
    'delivery_status',v_delivery,
    'response_code',v_code
  )::text);

  insert into public.os_marketing_revenue_phase44_ops_alerts(
    entity_id,source_id,alert_kind,window_key,severity,destination_key,
    delivery_status,response_code,metrics_sha256,metadata)
  values (
    v_entity,v_source,v_kind,v_window,'critical',v_dest,
    v_delivery,v_code,v_hash,
    v_meta || jsonb_build_object('contract_version','phase44-v1'))
  on conflict (window_key) do nothing
  returning alert_id, delivery_status into v_id, v_status;

  if v_id is null then
    select alert_id, delivery_status into v_id, v_status
    from public.os_marketing_revenue_phase44_ops_alerts
    where window_key = v_window;
    return jsonb_build_object(
      'version','phase44-v1',
      'alert_id',v_id,
      'window_key',v_window,
      'delivery_status',v_status,
      'inserted',false);
  end if;

  return jsonb_build_object(
    'version','phase44-v1',
    'alert_id',v_id,
    'window_key',v_window,
    'delivery_status',v_status,
    'inserted',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Hub report: correction validation, conflicts, recon, alert delivery
-- ---------------------------------------------------------------------------
create or replace function public.get_marketing_revenue_phase44_ops_report(
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
  v_validations jsonb;
  v_conflicts jsonb;
  v_snapshots jsonb;
  v_alerts jsonb;
  v_corr_health text := 'unknown';
  v_recon_health text := 'unknown';
  v_alert_delivery text := 'none';
  v_conflict_open integer := 0;
begin
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'validation_id',v.validation_id,
      'correction_id',v.correction_id,
      'entity_id',v.entity_id,
      'validation_status',v.validation_status,
      'fail_reason',v.fail_reason,
      'age_hours',v.age_hours,
      'metrics_sha256',v.metrics_sha256,
      'created_at',v.created_at
    ) order by v.created_at desc)
    from public.os_marketing_revenue_correction_validations v
    where v.created_at >= v_since
      and (p_entity_id is null or v.entity_id = p_entity_id)
    limit 50
  ), '[]'::jsonb) into v_validations;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'conflict_id',c.conflict_id,
      'conflict_key',c.conflict_key,
      'entity_id',c.entity_id,
      'window_start',c.window_start,
      'window_end',c.window_end,
      'currency',c.currency,
      'window_days',c.window_days,
      'conflict_kind',c.conflict_kind,
      'model_digests',c.model_digests,
      'metrics_sha256',c.metrics_sha256,
      'resolution_status',c.resolution_status,
      'resolution_reason',c.resolution_reason,
      'resolved_by',c.resolved_by,
      'resolved_at',c.resolved_at,
      'created_at',c.created_at
    ) order by c.created_at desc)
    from public.os_marketing_revenue_attribution_conflicts c
    where c.created_at >= v_since
      and (p_entity_id is null or c.entity_id = p_entity_id)
    limit 50
  ), '[]'::jsonb) into v_conflicts;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'snapshot_id',l.snapshot_id,
      'entity_id',l.entity_id,
      'source_id',l.source_id,
      'reconciliation_status',l.reconciliation_status,
      'expected_count',l.expected_count,
      'observed_count',l.observed_count,
      'completeness_pct',l.completeness_pct,
      'late_records',l.late_records,
      'staged_corrections',l.staged_corrections,
      'metrics_sha256',l.metrics_sha256,
      'created_at',l.created_at
    ) order by l.reconciliation_status, l.source_id)
    from (
      select s.*,
        row_number() over (
          partition by s.source_id
          order by s.created_at desc, s.snapshot_id desc
        ) rn
      from public.os_marketing_revenue_reconciliation_snapshots s
      where s.created_at >= v_since
        and (p_entity_id is null or s.entity_id = p_entity_id)
    ) l
    where l.rn = 1
    limit 100
  ), '[]'::jsonb) into v_snapshots;

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
    from public.os_marketing_revenue_phase44_ops_alerts a
    where a.created_at >= v_since
      and (p_entity_id is null or a.entity_id = p_entity_id)
    limit 50
  ), '[]'::jsonb) into v_alerts;

  select coalesce((
    select case
      when bool_or(x.validation_status in ('failed','auto_rejected'))
        then 'critical'
      when bool_or(x.validation_status = 'passed') then 'healthy'
      else 'unknown'
    end
    from jsonb_to_recordset(coalesce(v_validations,'[]'::jsonb))
      as x(validation_status text)
  ), 'unknown') into v_corr_health;

  select count(*)::integer into v_conflict_open
  from jsonb_to_recordset(coalesce(v_conflicts,'[]'::jsonb))
    as x(resolution_status text)
  where x.resolution_status in ('open','proposed');

  select coalesce((
    select case
      when bool_or(x.reconciliation_status in
        ('failed','denominator_inconsistent')) then 'critical'
      when bool_or(x.reconciliation_status = 'incomplete') then 'warning'
      when bool_or(x.reconciliation_status = 'complete') then 'healthy'
      else 'unknown'
    end
    from jsonb_to_recordset(coalesce(v_snapshots,'[]'::jsonb))
      as x(reconciliation_status text)
  ), 'unknown') into v_recon_health;

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
    'version','phase44-v1',
    'window_days',v_days,
    'correction_validation_health',v_corr_health,
    'conflict_open_count',v_conflict_open,
    'recon_health',v_recon_health,
    'alert_delivery',v_alert_delivery,
    'validations',coalesce(v_validations,'[]'::jsonb),
    'conflicts',coalesce(v_conflicts,'[]'::jsonb),
    'snapshots',coalesce(v_snapshots,'[]'::jsonb),
    'alerts',coalesce(v_alerts,'[]'::jsonb),
    'destination_key','ops_alerts');
end;
$$;

revoke all on function public.prevent_marketing_revenue_phase44_ops_mutation()
  from public, anon, authenticated;
revoke all on function public.phase44_marketing_ops_safe_metadata(jsonb)
  from public, anon, authenticated;
revoke all on function public.validate_marketing_revenue_corrections_phase44()
  from public, anon, authenticated;
revoke all on function public.detect_marketing_revenue_attribution_conflicts_phase44(text,integer)
  from public, anon, authenticated;
revoke all on function public.propose_resolve_marketing_attribution_conflict_phase44(uuid,text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.record_marketing_revenue_reconciliation_snapshots_phase44(text)
  from public, anon, authenticated;
revoke all on function public.list_marketing_revenue_phase44_critical_windows(text,integer,integer)
  from public, anon, authenticated;
revoke all on function public.record_marketing_revenue_phase44_ops_alert(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_marketing_revenue_phase44_ops_report(text,integer)
  from public, anon, authenticated;

grant execute on function public.phase44_marketing_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.list_marketing_revenue_phase44_critical_windows(text,integer,integer)
  to authenticated, service_role;
grant execute on function public.get_marketing_revenue_phase44_ops_report(text,integer)
  to authenticated, service_role;
grant execute on function public.propose_resolve_marketing_attribution_conflict_phase44(uuid,text,text,uuid)
  to authenticated, service_role;

grant execute on function public.validate_marketing_revenue_corrections_phase44()
  to service_role;
grant execute on function public.detect_marketing_revenue_attribution_conflicts_phase44(text,integer)
  to service_role;
grant execute on function public.record_marketing_revenue_reconciliation_snapshots_phase44(text)
  to service_role;
grant execute on function public.record_marketing_revenue_phase44_ops_alert(jsonb)
  to service_role;
