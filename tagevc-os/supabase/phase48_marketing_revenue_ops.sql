-- Phase 48: cohort autopilot promotion, closed conflict-cohort archives,
-- and cohort performance visibility over Phase 47 evidence.
-- Apply after phase47_marketing_revenue_ops.sql. Safe to re-run.
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
-- Append-only cohort autopilot evaluation / promotion runs
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_cohort_autopilot_runs (
  run_id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null
    references public.os_marketing_revenue_promotion_cohorts(cohort_id),
  promotion_id uuid
    references public.os_marketing_revenue_cohort_promotions(promotion_id),
  gate_passed boolean not null default false,
  consecutive_healthy_windows integer not null
    check (consecutive_healthy_windows >= 0),
  windows_required integer not null
    check (windows_required between 1 and 30),
  run_status text not null check (run_status in
    ('waiting','promoted','blocked','skipped')),
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
    (run_status = 'promoted' and promotion_id is not null
      and gate_passed is true and block_reason is null)
    or (run_status in ('waiting','blocked','skipped'))
  )
);

create index if not exists os_mkt_rev_cohort_autopilot_created_idx
  on public.os_marketing_revenue_cohort_autopilot_runs
    (created_at desc);
create index if not exists os_mkt_rev_cohort_autopilot_cohort_idx
  on public.os_marketing_revenue_cohort_autopilot_runs
    (cohort_id, created_at desc);
create index if not exists os_mkt_rev_cohort_autopilot_status_idx
  on public.os_marketing_revenue_cohort_autopilot_runs
    (run_status, created_at desc);

alter table public.os_marketing_revenue_cohort_autopilot_runs
  enable row level security;

-- ---------------------------------------------------------------------------
-- Append-only closed attribution conflict-cohort archive receipts
-- Soft-hide: archived conflict_ids are excluded from default open lists.
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_conflict_cohort_archives (
  archive_id uuid primary key default gen_random_uuid(),
  archive_key text not null unique
    check (archive_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  entity_id text not null references public.entities(entity_id),
  conflict_kind text not null check (conflict_kind in
    ('event_set_mismatch','amount_delta_threshold','model_count_gap','mixed')),
  conflict_ids uuid[] not null default '{}'::uuid[],
  conflict_count integer not null check (conflict_count >= 1),
  closed_count integer not null check (closed_count >= 0),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  archived_by uuid,
  check (cardinality(conflict_ids) = conflict_count),
  check (cardinality(conflict_ids) between 1 and 500),
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (not (metadata ?| array[
    'authorization','cookie','set-cookie','token','secret','signature','jwt',
    'credential','password','payload','body','value','env_value','url'
  ]))
);

create index if not exists os_mkt_rev_conflict_arch_entity_idx
  on public.os_marketing_revenue_conflict_cohort_archives
    (entity_id, created_at desc);
create index if not exists os_mkt_rev_conflict_arch_kind_idx
  on public.os_marketing_revenue_conflict_cohort_archives
    (conflict_kind, created_at desc);

alter table public.os_marketing_revenue_conflict_cohort_archives
  enable row level security;

-- ---------------------------------------------------------------------------
-- Append-only cohort performance snapshots (promotion + conflict resolution)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_cohort_performance_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  cohort_id uuid
    references public.os_marketing_revenue_promotion_cohorts(cohort_id),
  entity_id text references public.entities(entity_id),
  promotions_total integer not null check (promotions_total >= 0),
  promotions_promoted integer not null check (promotions_promoted >= 0),
  promotions_blocked integer not null check (promotions_blocked >= 0),
  autopilot_runs integer not null check (autopilot_runs >= 0),
  autopilot_promoted integer not null check (autopilot_promoted >= 0),
  open_conflicts integer not null check (open_conflicts >= 0),
  closed_conflicts integer not null check (closed_conflicts >= 0),
  archived_conflicts integer not null check (archived_conflicts >= 0),
  pending_closures integer not null check (pending_closures >= 0),
  promote_rate numeric(8,4),
  close_rate numeric(8,4),
  severity text not null check (severity in ('healthy','warning','critical','unknown')),
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

create index if not exists os_mkt_rev_cohort_perf_cohort_idx
  on public.os_marketing_revenue_cohort_performance_snapshots
    (cohort_id, created_at desc);
create index if not exists os_mkt_rev_cohort_perf_entity_idx
  on public.os_marketing_revenue_cohort_performance_snapshots
    (entity_id, created_at desc);
create index if not exists os_mkt_rev_cohort_perf_sev_idx
  on public.os_marketing_revenue_cohort_performance_snapshots
    (severity, created_at desc);

alter table public.os_marketing_revenue_cohort_performance_snapshots
  enable row level security;

-- ---------------------------------------------------------------------------
-- Append-only Phase 48 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_phase48_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities(entity_id),
  source_id uuid references public.os_marketing_revenue_sources(source_id),
  cohort_id uuid
    references public.os_marketing_revenue_promotion_cohorts(cohort_id),
  archive_id uuid
    references public.os_marketing_revenue_conflict_cohort_archives(archive_id),
  alert_kind text not null check (alert_kind in
    ('autopilot_promoted','autopilot_blocked',
     'conflict_cohort_archived','cohort_performance_degraded')),
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

create index if not exists os_mkt_rev_p48_ops_alert_entity_idx
  on public.os_marketing_revenue_phase48_ops_alerts
    (entity_id, created_at desc);
create index if not exists os_mkt_rev_p48_ops_alert_kind_idx
  on public.os_marketing_revenue_phase48_ops_alerts
    (alert_kind, created_at desc);

alter table public.os_marketing_revenue_phase48_ops_alerts
  enable row level security;

do $$
begin
  revoke all on public.os_marketing_revenue_cohort_autopilot_runs
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_cohort_autopilot_runs from service_role;
  grant select on public.os_marketing_revenue_cohort_autopilot_runs
    to service_role;

  revoke all on public.os_marketing_revenue_conflict_cohort_archives
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_conflict_cohort_archives from service_role;
  grant select on public.os_marketing_revenue_conflict_cohort_archives
    to service_role;

  revoke all on public.os_marketing_revenue_cohort_performance_snapshots
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_cohort_performance_snapshots
    from service_role;
  grant select on public.os_marketing_revenue_cohort_performance_snapshots
    to service_role;

  revoke all on public.os_marketing_revenue_phase48_ops_alerts
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_phase48_ops_alerts from service_role;
  grant select on public.os_marketing_revenue_phase48_ops_alerts
    to service_role;
end $$;

create or replace function public.prevent_marketing_revenue_phase48_ops_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  raise exception 'Marketing revenue Phase 48 ops evidence is append-only';
end;
$$;

drop trigger if exists os_mkt_rev_cohort_autopilot_immutable
  on public.os_marketing_revenue_cohort_autopilot_runs;
create trigger os_mkt_rev_cohort_autopilot_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_cohort_autopilot_runs
  for each statement
  execute function public.prevent_marketing_revenue_phase48_ops_mutation();

drop trigger if exists os_mkt_rev_conflict_arch_immutable
  on public.os_marketing_revenue_conflict_cohort_archives;
create trigger os_mkt_rev_conflict_arch_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_conflict_cohort_archives
  for each statement
  execute function public.prevent_marketing_revenue_phase48_ops_mutation();

drop trigger if exists os_mkt_rev_cohort_perf_immutable
  on public.os_marketing_revenue_cohort_performance_snapshots;
create trigger os_mkt_rev_cohort_perf_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_cohort_performance_snapshots
  for each statement
  execute function public.prevent_marketing_revenue_phase48_ops_mutation();

drop trigger if exists os_mkt_rev_p48_ops_alert_immutable
  on public.os_marketing_revenue_phase48_ops_alerts;
create trigger os_mkt_rev_p48_ops_alert_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_phase48_ops_alerts
  for each statement
  execute function public.prevent_marketing_revenue_phase48_ops_mutation();

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

create or replace function public.phase48_default_autopilot_thresholds()
returns jsonb
language sql
immutable
parallel safe
as $$
  select public.phase47_default_cohort_thresholds()
    || jsonb_build_object(
      'autopilot_consecutive_windows_required', 3,
      'cohort_promote_rate_warn', 0.2500,
      'cohort_promote_rate_critical', 0.1000,
      'cohort_close_rate_warn', 0.5000,
      'cohort_close_rate_critical', 0.2500,
      'open_conflicts_warn', 5,
      'open_conflicts_critical', 15
    );
$$;

create or replace function public.phase48_conflict_is_archived(p_conflict_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.os_marketing_revenue_conflict_cohort_archives a
    where p_conflict_id = any (a.conflict_ids)
  );
$$;

-- ---------------------------------------------------------------------------
-- Soft-hide archived closed conflicts from default aging lists
-- ---------------------------------------------------------------------------
create or replace function public.list_marketing_open_attribution_conflicts_aging_phase48(
  p_entity_id text,
  p_aging_days integer default 7,
  p_limit integer default 50,
  p_include_archived boolean default false)
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
  v_include_archived boolean := coalesce(p_include_archived,false);
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
      'has_pending_closure',l.has_pending_closure,
      'archived',l.archived
    ) order by l.created_at asc)
    from (
      select c.*,
        exists (
          select 1
          from public.os_marketing_revenue_attribution_conflict_closures x
          where x.conflict_id = c.conflict_id
            and x.closure_status = 'proposed'
        ) as has_pending_closure,
        public.phase48_conflict_is_archived(c.conflict_id) as archived
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
        and (
          v_include_archived
          or not public.phase48_conflict_is_archived(c.conflict_id)
        )
      order by c.created_at asc
      limit v_limit
    ) l
  ), '[]'::jsonb) into v_rows;

  return jsonb_build_object(
    'version','phase48-v1',
    'aging_days',v_aging_days,
    'cutoff',v_cutoff,
    'include_archived',v_include_archived,
    'conflicts',coalesce(v_rows,'[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Archive closed attribution conflict cohorts (append-only receipts)
-- ---------------------------------------------------------------------------
create or replace function public.archive_marketing_closed_conflict_cohorts_phase48(
  p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text;
  v_actor uuid;
  v_meta jsonb;
  v_days integer;
  v_since timestamptz;
  v_row record;
  v_ids uuid[];
  v_count integer;
  v_closed integer;
  v_key text;
  v_hash text;
  v_id uuid;
  v_archives jsonb := '[]'::jsonb;
  v_inserted integer := 0;
  v_alert_window text;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Conflict cohort archive payload must be a JSON object';
  end if;

  v_entity := nullif(p_payload->>'entity_id','');
  v_actor := nullif(p_payload->>'archived_by','')::uuid;
  v_meta := coalesce(p_payload->'metadata','{}'::jsonb);
  v_days := least(greatest(coalesce(
    nullif(p_payload->>'days','')::integer, 30), 1), 90);
  v_since := now() - make_interval(days => v_days);

  if not public.phase48_marketing_ops_safe_metadata(v_meta) then
    raise exception 'Conflict cohort archive metadata is unsafe';
  end if;

  for v_row in
    with closable as (
      select c.conflict_id, c.entity_id, c.conflict_kind, c.metrics_sha256
      from public.os_marketing_revenue_attribution_conflicts c
      where c.created_at >= v_since
        and (v_entity is null or c.entity_id = v_entity)
        and (
          c.resolution_status in ('approved','rejected')
          or exists (
            select 1
            from public.os_marketing_revenue_attribution_conflict_closures cl
            where cl.conflict_id = c.conflict_id
              and cl.closure_status in ('closed','approved')
          )
        )
        and not public.phase48_conflict_is_archived(c.conflict_id)
    )
    select entity_id, conflict_kind,
      array_agg(conflict_id order by conflict_id) as conflict_ids,
      count(*)::integer as conflict_count
    from closable
    group by entity_id, conflict_kind
    having count(*) >= 1
    order by entity_id, conflict_kind
    limit 50
  loop
    v_ids := v_row.conflict_ids;
    v_count := v_row.conflict_count;
    v_closed := v_count;
    v_key := left(
      'carch:' || v_row.entity_id || ':' || v_row.conflict_kind || ':'
        || public.os_sha256_hex(array_to_string(v_ids::text[], ',')),
      200);
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase48-v1',
      'kind','conflict_cohort_archived',
      'entity_id',v_row.entity_id,
      'conflict_kind',v_row.conflict_kind,
      'conflict_ids',to_jsonb(v_ids),
      'conflict_count',v_count,
      'archived_by',v_actor
    )::text);

    insert into public.os_marketing_revenue_conflict_cohort_archives(
      archive_key,entity_id,conflict_kind,conflict_ids,conflict_count,
      closed_count,metrics_sha256,metadata,archived_by)
    values (
      v_key,v_row.entity_id,v_row.conflict_kind,v_ids,v_count,v_closed,v_hash,
      v_meta || jsonb_build_object(
        'contract_version','phase48-v1',
        'soft_hidden',true),
      v_actor)
    on conflict (archive_key) do nothing
    returning archive_id into v_id;

    if v_id is not null then
      v_inserted := v_inserted + 1;
      v_archives := v_archives || jsonb_build_array(jsonb_build_object(
        'archive_id',v_id,
        'archive_key',v_key,
        'entity_id',v_row.entity_id,
        'conflict_kind',v_row.conflict_kind,
        'conflict_count',v_count,
        'metrics_sha256',v_hash));

      v_alert_window := left('carchived:' || v_id::text, 200);
      insert into public.os_marketing_revenue_phase48_ops_alerts(
        entity_id,source_id,cohort_id,archive_id,alert_kind,window_key,
        severity,destination_key,delivery_status,response_code,
        metrics_sha256,metadata)
      values (
        v_row.entity_id,null,null,v_id,'conflict_cohort_archived',
        v_alert_window,'critical','ops_alerts','recorded',null,v_hash,
        jsonb_build_object(
          'contract_version','phase48-v1',
          'archive_key',v_key,
          'conflict_kind',v_row.conflict_kind,
          'conflict_count',v_count
        ))
      on conflict (window_key) do nothing;
    end if;
  end loop;

  return jsonb_build_object(
    'version','phase48-v1',
    'archives_recorded',v_inserted,
    'archives',v_archives);
end;
$$;

-- ---------------------------------------------------------------------------
-- Cohort performance snapshot (promotion + conflict resolution status)
-- ---------------------------------------------------------------------------
create or replace function public.record_marketing_cohort_performance_snapshot_phase48(
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
  v_defaults jsonb := public.phase48_default_autopilot_thresholds();
  v_inserted integer := 0;
  v_cohort public.os_marketing_revenue_promotion_cohorts%rowtype;
  v_promo_total integer;
  v_promo_ok integer;
  v_promo_blocked integer;
  v_auto_runs integer;
  v_auto_promoted integer;
  v_open integer;
  v_closed integer;
  v_archived integer;
  v_pending integer;
  v_promote_rate numeric;
  v_close_rate numeric;
  v_severity text;
  v_hash text;
  v_entity_filter text;
  v_total_conflicts integer;
begin
  for v_cohort in
    select *
    from public.os_marketing_revenue_promotion_cohorts c
    where c.status = 'active'
      and (
        p_entity_id is null
        or cardinality(c.entity_ids) = 0
        or p_entity_id = any (c.entity_ids)
      )
    order by c.created_at desc
    limit 50
  loop
    if cardinality(v_cohort.entity_ids) = 0 then
      v_entity_filter := null;
    elsif p_entity_id is not null then
      v_entity_filter := p_entity_id;
    else
      v_entity_filter := v_cohort.entity_ids[1];
    end if;

    select
      count(*)::integer,
      count(*) filter (where p.promotion_status = 'promoted')::integer,
      count(*) filter (where p.promotion_status = 'blocked')::integer
    into v_promo_total, v_promo_ok, v_promo_blocked
    from public.os_marketing_revenue_cohort_promotions p
    where p.cohort_id = v_cohort.cohort_id
      and p.created_at >= v_since;

    select
      count(*)::integer,
      count(*) filter (where r.run_status = 'promoted')::integer
    into v_auto_runs, v_auto_promoted
    from public.os_marketing_revenue_cohort_autopilot_runs r
    where r.cohort_id = v_cohort.cohort_id
      and r.created_at >= v_since;

    select count(*)::integer into v_open
    from public.os_marketing_revenue_attribution_conflicts c
    where c.resolution_status in ('open','proposed')
      and c.created_at >= v_since
      and (v_entity_filter is null or c.entity_id = v_entity_filter
        or (cardinality(v_cohort.entity_ids) > 0
          and c.entity_id = any (v_cohort.entity_ids)))
      and not public.phase48_conflict_is_archived(c.conflict_id)
      and not exists (
        select 1
        from public.os_marketing_revenue_attribution_conflict_closures cl
        where cl.conflict_id = c.conflict_id
          and cl.closure_status in ('closed','approved')
      );

    select count(*)::integer into v_closed
    from public.os_marketing_revenue_attribution_conflicts c
    where c.created_at >= v_since
      and (v_entity_filter is null or c.entity_id = v_entity_filter
        or (cardinality(v_cohort.entity_ids) > 0
          and c.entity_id = any (v_cohort.entity_ids)))
      and (
        c.resolution_status in ('approved','rejected')
        or exists (
          select 1
          from public.os_marketing_revenue_attribution_conflict_closures cl
          where cl.conflict_id = c.conflict_id
            and cl.closure_status in ('closed','approved')
        )
      );

    select coalesce(sum(a.conflict_count),0)::integer into v_archived
    from public.os_marketing_revenue_conflict_cohort_archives a
    where a.created_at >= v_since
      and (v_entity_filter is null or a.entity_id = v_entity_filter
        or (cardinality(v_cohort.entity_ids) > 0
          and a.entity_id = any (v_cohort.entity_ids)));

    select count(*)::integer into v_pending
    from public.os_marketing_revenue_attribution_conflict_closures cl
    join public.os_marketing_revenue_attribution_conflicts cf
      on cf.conflict_id = cl.conflict_id
    where cl.closure_status = 'proposed'
      and cl.created_at >= v_since
      and (v_entity_filter is null or cf.entity_id = v_entity_filter
        or (cardinality(v_cohort.entity_ids) > 0
          and cf.entity_id = any (v_cohort.entity_ids)));

    if v_promo_total = 0 then
      v_promote_rate := null;
    else
      v_promote_rate := round(
        (v_promo_ok::numeric / v_promo_total::numeric), 4);
    end if;

    v_total_conflicts := v_open + v_closed;
    if v_total_conflicts = 0 then
      v_close_rate := null;
    else
      v_close_rate := round(
        (v_closed::numeric / v_total_conflicts::numeric), 4);
    end if;

    if v_open >= coalesce((v_defaults->>'open_conflicts_critical')::integer,15)
      or (
        v_promote_rate is not null
        and v_promote_rate
          <= coalesce((v_defaults->>'cohort_promote_rate_critical')::numeric,0.1)
        and v_promo_total >= 3
      )
      or (
        v_close_rate is not null
        and v_close_rate
          <= coalesce((v_defaults->>'cohort_close_rate_critical')::numeric,0.25)
        and v_total_conflicts >= 3
      ) then
      v_severity := 'critical';
    elsif v_open >= coalesce((v_defaults->>'open_conflicts_warn')::integer,5)
      or (
        v_promote_rate is not null
        and v_promote_rate
          <= coalesce((v_defaults->>'cohort_promote_rate_warn')::numeric,0.25)
        and v_promo_total >= 3
      )
      or (
        v_close_rate is not null
        and v_close_rate
          <= coalesce((v_defaults->>'cohort_close_rate_warn')::numeric,0.5)
        and v_total_conflicts >= 3
      ) then
      v_severity := 'warning';
    elsif v_promo_total = 0 and v_total_conflicts = 0 and v_auto_runs = 0 then
      v_severity := 'unknown';
    else
      v_severity := 'healthy';
    end if;

    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase48-v1',
      'kind','cohort_performance',
      'cohort_id',v_cohort.cohort_id,
      'entity_id',v_entity_filter,
      'promotions_total',v_promo_total,
      'promotions_promoted',v_promo_ok,
      'promotions_blocked',v_promo_blocked,
      'autopilot_runs',v_auto_runs,
      'autopilot_promoted',v_auto_promoted,
      'open_conflicts',v_open,
      'closed_conflicts',v_closed,
      'archived_conflicts',v_archived,
      'pending_closures',v_pending,
      'promote_rate',v_promote_rate,
      'close_rate',v_close_rate,
      'severity',v_severity
    )::text);

    insert into public.os_marketing_revenue_cohort_performance_snapshots(
      cohort_id,entity_id,promotions_total,promotions_promoted,
      promotions_blocked,autopilot_runs,autopilot_promoted,open_conflicts,
      closed_conflicts,archived_conflicts,pending_closures,promote_rate,
      close_rate,severity,metrics_sha256,metadata)
    values (
      v_cohort.cohort_id,v_entity_filter,v_promo_total,v_promo_ok,
      v_promo_blocked,v_auto_runs,v_auto_promoted,v_open,v_closed,v_archived,
      v_pending,v_promote_rate,v_close_rate,v_severity,v_hash,
      jsonb_build_object(
        'contract_version','phase48-v1',
        'cohort_key',v_cohort.cohort_key,
        'window_days',v_days));
    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object(
    'version','phase48-v1',
    'window_days',v_days,
    'snapshots_recorded',v_inserted);
end;
$$;

-- ---------------------------------------------------------------------------
-- Run autopilot: promote only after N consecutive healthy cohort gates
-- Never auto-approves money corrections.
-- ---------------------------------------------------------------------------
create or replace function public.run_marketing_cohort_autopilot_phase48(
  p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_meta jsonb;
  v_defaults jsonb := public.phase48_default_autopilot_thresholds();
  v_required integer;
  v_cohort public.os_marketing_revenue_promotion_cohorts%rowtype;
  v_gate jsonb;
  v_consec integer;
  v_prior record;
  v_status text;
  v_reason text;
  v_hash text;
  v_run_id uuid;
  v_promo jsonb;
  v_promo_id uuid;
  v_promo_status text;
  v_results jsonb := '[]'::jsonb;
  v_alert_entity text;
  v_alert_window text;
  v_alert_kind text;
  v_runs integer := 0;
  v_promoted integer := 0;
  v_blocked integer := 0;
  v_waiting integer := 0;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Cohort autopilot payload must be a JSON object';
  end if;

  v_actor := nullif(p_payload->>'created_by','')::uuid;
  v_meta := coalesce(p_payload->'metadata','{}'::jsonb);
  v_required := least(greatest(coalesce(
    nullif(p_payload->>'autopilot_consecutive_windows_required','')::integer,
    (v_defaults->>'autopilot_consecutive_windows_required')::integer,
    3), 1), 30);

  if v_actor is null
    or not public.phase48_marketing_ops_safe_metadata(v_meta) then
    raise exception 'Cohort autopilot requires actor and safe metadata';
  end if;

  for v_cohort in
    select *
    from public.os_marketing_revenue_promotion_cohorts c
    where c.status = 'active'
      and (
        p_payload->>'cohort_id' is null
        or c.cohort_id = nullif(p_payload->>'cohort_id','')::uuid
      )
      and (
        p_payload->>'entity_id' is null
        or cardinality(c.entity_ids) = 0
        or (p_payload->>'entity_id') = any (c.entity_ids)
      )
    order by c.created_at desc
    limit 50
  loop
    v_gate := public.evaluate_marketing_cohort_promotion_gate_phase47(
      jsonb_build_object(
        'cohort_id',v_cohort.cohort_id,
        'webhook_slo_windows_required',
          p_payload->>'webhook_slo_windows_required',
        'thresholds',coalesce(p_payload->'thresholds','{}'::jsonb)
      ));

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

    v_promo_id := null;
    v_promo := null;
    v_promo_status := null;

    if coalesce((v_gate->>'gate_passed')::boolean,false) is not true then
      v_status := 'blocked';
      v_reason := coalesce(v_gate->>'block_reason',
        'Cohort autopilot gate is not healthy');
      v_blocked := v_blocked + 1;
    elsif v_consec < v_required then
      v_status := 'waiting';
      v_reason := 'Cohort gate healthy for '
        || v_consec::text
        || '/'
        || v_required::text
        || ' consecutive windows; autopilot waiting';
      v_waiting := v_waiting + 1;
    else
      -- Gate healthy for N consecutive windows: promote auto-reject only.
      -- NEVER auto-approves money corrections.
      v_promo := public.promote_marketing_auto_reject_cohort_phase47(
        jsonb_build_object(
          'cohort_id',v_cohort.cohort_id,
          'created_by',v_actor,
          'proposed_version_id',p_payload->>'proposed_version_id',
          'webhook_slo_windows_required',
            v_gate->>'webhook_slo_windows_required',
          'thresholds',coalesce(p_payload->'thresholds','{}'::jsonb),
          'metadata',v_meta || jsonb_build_object(
            'autopilot',true,
            'contract_version','phase48-v1',
            'consecutive_healthy_windows',v_consec)
        ));
      v_promo_id := nullif(v_promo->>'promotion_id','')::uuid;
      v_promo_status := v_promo->>'promotion_status';
      if v_promo_status is not distinct from 'promoted' then
        v_status := 'promoted';
        v_reason := null;
        v_promoted := v_promoted + 1;
      else
        v_status := 'blocked';
        v_reason := coalesce(v_promo->>'block_reason',
          'Cohort autopilot promotion did not promote');
        v_blocked := v_blocked + 1;
      end if;
    end if;

    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase48-v1',
      'kind','cohort_autopilot_' || v_status,
      'cohort_id',v_cohort.cohort_id,
      'gate_passed',coalesce((v_gate->>'gate_passed')::boolean,false),
      'consecutive_healthy_windows',v_consec,
      'windows_required',v_required,
      'run_status',v_status,
      'promotion_id',v_promo_id,
      'actor_id',v_actor
    )::text);

    insert into public.os_marketing_revenue_cohort_autopilot_runs(
      cohort_id,promotion_id,gate_passed,consecutive_healthy_windows,
      windows_required,run_status,block_reason,metrics_sha256,metadata,
      actor_id)
    values (
      v_cohort.cohort_id,v_promo_id,
      coalesce((v_gate->>'gate_passed')::boolean,false),
      v_consec,v_required,v_status,left(v_reason,500),v_hash,
      v_meta || jsonb_build_object(
        'contract_version','phase48-v1',
        'gate',v_gate,
        'promotion',v_promo,
        'never_auto_approves_money',true),
      v_actor)
    returning run_id into v_run_id;

    v_runs := v_runs + 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'run_id',v_run_id,
      'cohort_id',v_cohort.cohort_id,
      'cohort_key',v_cohort.cohort_key,
      'run_status',v_status,
      'consecutive_healthy_windows',v_consec,
      'windows_required',v_required,
      'promotion_id',v_promo_id,
      'block_reason',v_reason));

    if v_status is not distinct from 'promoted'
      or v_status is not distinct from 'blocked' then
      select coalesce(v_cohort.entity_ids[1], (
        select s.entity_id from public.os_marketing_revenue_sources s
        order by s.entity_id limit 1
      )) into v_alert_entity;
      if v_alert_entity is not null then
        if v_status is not distinct from 'promoted' then
          v_alert_kind := 'autopilot_promoted';
          v_alert_window := left(
            'autopromoted:' || v_cohort.cohort_key || ':' || v_run_id::text,
            200);
        else
          v_alert_kind := 'autopilot_blocked';
          v_alert_window := left(
            'autoblock:' || v_cohort.cohort_key || ':' || v_run_id::text,
            200);
        end if;
        insert into public.os_marketing_revenue_phase48_ops_alerts(
          entity_id,source_id,cohort_id,archive_id,alert_kind,window_key,
          severity,destination_key,delivery_status,response_code,
          metrics_sha256,metadata)
        values (
          v_alert_entity,null,v_cohort.cohort_id,null,v_alert_kind,
          v_alert_window,'critical','ops_alerts','recorded',null,v_hash,
          jsonb_build_object(
            'contract_version','phase48-v1',
            'run_id',v_run_id,
            'cohort_key',v_cohort.cohort_key,
            'run_status',v_status,
            'consecutive_healthy_windows',v_consec,
            'windows_required',v_required
          ))
        on conflict (window_key) do nothing;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'version','phase48-v1',
    'runs',v_runs,
    'promoted',v_promoted,
    'blocked',v_blocked,
    'waiting',v_waiting,
    'windows_required',v_required,
    'results',v_results);
end;
$$;

-- ---------------------------------------------------------------------------
-- List critical Phase 48 windows needing idempotent ops alerts
-- ---------------------------------------------------------------------------
create or replace function public.list_marketing_revenue_phase48_critical_windows(
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
  v_perf jsonb;
  v_auto jsonb;
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
      'alert_kind','cohort_performance_degraded',
      'entity_id',coalesce(s.entity_id, (
        select e.entity_id from public.entities e order by e.entity_id limit 1
      )),
      'source_id',null,
      'cohort_id',s.cohort_id,
      'archive_id',null,
      'window_key','cperf:'||s.snapshot_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','critical',
      'metrics_sha256',s.metrics_sha256,
      'snapshot_id',s.snapshot_id,
      'promote_rate',s.promote_rate,
      'close_rate',s.close_rate,
      'open_conflicts',s.open_conflicts,
      'perf_severity',s.severity
    ) order by s.created_at desc)
    from public.os_marketing_revenue_cohort_performance_snapshots s
    where s.created_at >= now() - make_interval(days => v_days)
      and s.severity = 'critical'
      and (p_entity_id is null or s.entity_id is null or s.entity_id = p_entity_id)
      and not exists (
        select 1 from public.os_marketing_revenue_phase48_ops_alerts x
        where x.window_key =
          'cperf:'||s.snapshot_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 50
  ), '[]'::jsonb) into v_perf;

  -- Surface recent blocked autopilot runs that were only recorded inline
  -- without a delivery attempt (re-alert via worker delivery path).
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','autopilot_blocked',
      'entity_id',coalesce(c.entity_ids[1], (
        select e.entity_id from public.entities e order by e.entity_id limit 1
      )),
      'source_id',null,
      'cohort_id',r.cohort_id,
      'archive_id',null,
      'window_key','autoblock:'||c.cohort_key||':'||r.run_id::text,
      'severity','critical',
      'metrics_sha256',r.metrics_sha256,
      'run_id',r.run_id,
      'run_status',r.run_status,
      'consecutive_healthy_windows',r.consecutive_healthy_windows,
      'windows_required',r.windows_required
    ) order by r.created_at desc)
    from public.os_marketing_revenue_cohort_autopilot_runs r
    join public.os_marketing_revenue_promotion_cohorts c
      on c.cohort_id = r.cohort_id
    where r.created_at >= now() - make_interval(days => v_days)
      and r.run_status = 'blocked'
      and (p_entity_id is null
        or cardinality(c.entity_ids) = 0
        or p_entity_id = any (c.entity_ids))
      and not exists (
        select 1 from public.os_marketing_revenue_phase48_ops_alerts x
        where x.window_key =
          'autoblock:'||c.cohort_key||':'||r.run_id::text
      )
    limit 50
  ), '[]'::jsonb) into v_auto;

  return jsonb_build_object(
    'version','phase48-v1',
    'window_days',v_days,
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',coalesce(v_perf,'[]'::jsonb)
      || coalesce(v_auto,'[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Record one critical Phase 48 ops alert after delivery attempt
-- ---------------------------------------------------------------------------
create or replace function public.record_marketing_revenue_phase48_ops_alert(
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
  v_archive uuid;
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
  v_archive := nullif(p_alert->>'archive_id','')::uuid;
  v_window := coalesce(p_alert->>'window_key','');
  v_dest := coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery := coalesce(p_alert->>'delivery_status','recorded');
  v_code := nullif(p_alert->>'response_code','')::integer;
  v_meta := coalesce(p_alert->'metadata','{}'::jsonb);

  if v_kind not in
      ('autopilot_promoted','autopilot_blocked',
       'conflict_cohort_archived','cohort_performance_degraded')
    or v_entity = ''
    or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
    or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
    or v_dest ~* '://|^https?'
    or v_delivery not in
      ('delivered','skipped_no_webhook','failed','recorded')
    or not public.phase48_marketing_ops_safe_metadata(v_meta) then
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
    'version','phase48-v1',
    'alert_kind',v_kind,
    'entity_id',v_entity,
    'source_id',v_source,
    'cohort_id',v_cohort,
    'archive_id',v_archive,
    'window_key',v_window,
    'severity','critical',
    'destination_key',v_dest,
    'delivery_status',v_delivery,
    'response_code',v_code
  )::text);

  insert into public.os_marketing_revenue_phase48_ops_alerts(
    entity_id,source_id,cohort_id,archive_id,alert_kind,window_key,
    severity,destination_key,delivery_status,response_code,
    metrics_sha256,metadata)
  values (
    v_entity,v_source,v_cohort,v_archive,v_kind,v_window,'critical',v_dest,
    v_delivery,v_code,v_hash,
    v_meta || jsonb_build_object('contract_version','phase48-v1'))
  on conflict (window_key) do nothing
  returning alert_id, delivery_status into v_id, v_status;

  if v_id is null then
    select alert_id, delivery_status into v_id, v_status
    from public.os_marketing_revenue_phase48_ops_alerts
    where window_key = v_window;
    return jsonb_build_object(
      'version','phase48-v1',
      'alert_id',v_id,
      'window_key',v_window,
      'delivery_status',v_status,
      'inserted',false);
  end if;

  return jsonb_build_object(
    'version','phase48-v1',
    'alert_id',v_id,
    'window_key',v_window,
    'delivery_status',v_status,
    'inserted',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Hub report: autopilot, archives, cohort performance, conflict resolution
-- ---------------------------------------------------------------------------
create or replace function public.get_marketing_revenue_phase48_ops_report(
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
  v_defaults jsonb := public.phase48_default_autopilot_thresholds();
  v_autopilot jsonb;
  v_archives jsonb;
  v_perf jsonb;
  v_alerts jsonb;
  v_aging jsonb;
  v_autopilot_health text := 'unknown';
  v_archive_health text := 'unknown';
  v_perf_health text := 'unknown';
  v_conflict_resolution_health text := 'unknown';
  v_alert_delivery text := 'none';
  v_waiting integer := 0;
  v_promoted integer := 0;
  v_blocked integer := 0;
  v_archived_count integer := 0;
  v_open_aging integer := 0;
  v_pending_closures integer := 0;
  v_latest_sev text;
begin
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'run_id',r.run_id,
      'cohort_id',r.cohort_id,
      'promotion_id',r.promotion_id,
      'gate_passed',r.gate_passed,
      'consecutive_healthy_windows',r.consecutive_healthy_windows,
      'windows_required',r.windows_required,
      'run_status',r.run_status,
      'block_reason',r.block_reason,
      'metrics_sha256',r.metrics_sha256,
      'created_at',r.created_at,
      'actor_id',r.actor_id,
      'cohort_key',c.cohort_key
    ) order by r.created_at desc)
    from public.os_marketing_revenue_cohort_autopilot_runs r
    join public.os_marketing_revenue_promotion_cohorts c
      on c.cohort_id = r.cohort_id
    where r.created_at >= v_since
      and (
        p_entity_id is null
        or cardinality(c.entity_ids) = 0
        or p_entity_id = any (c.entity_ids)
      )
    limit 50
  ), '[]'::jsonb) into v_autopilot;

  select
    count(*) filter (where x.run_status = 'waiting')::integer,
    count(*) filter (where x.run_status = 'promoted')::integer,
    count(*) filter (where x.run_status = 'blocked')::integer
  into v_waiting, v_promoted, v_blocked
  from jsonb_to_recordset(coalesce(v_autopilot,'[]'::jsonb))
    as x(run_status text);

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'archive_id',a.archive_id,
      'archive_key',a.archive_key,
      'entity_id',a.entity_id,
      'conflict_kind',a.conflict_kind,
      'conflict_ids',to_jsonb(a.conflict_ids),
      'conflict_count',a.conflict_count,
      'closed_count',a.closed_count,
      'metrics_sha256',a.metrics_sha256,
      'created_at',a.created_at,
      'archived_by',a.archived_by
    ) order by a.created_at desc)
    from public.os_marketing_revenue_conflict_cohort_archives a
    where a.created_at >= v_since
      and (p_entity_id is null or a.entity_id = p_entity_id)
    limit 50
  ), '[]'::jsonb) into v_archives;

  select coalesce(jsonb_array_length(v_archives),0) into v_archived_count;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'snapshot_id',s.snapshot_id,
      'cohort_id',s.cohort_id,
      'entity_id',s.entity_id,
      'promotions_total',s.promotions_total,
      'promotions_promoted',s.promotions_promoted,
      'promotions_blocked',s.promotions_blocked,
      'autopilot_runs',s.autopilot_runs,
      'autopilot_promoted',s.autopilot_promoted,
      'open_conflicts',s.open_conflicts,
      'closed_conflicts',s.closed_conflicts,
      'archived_conflicts',s.archived_conflicts,
      'pending_closures',s.pending_closures,
      'promote_rate',s.promote_rate,
      'close_rate',s.close_rate,
      'severity',s.severity,
      'metrics_sha256',s.metrics_sha256,
      'created_at',s.created_at
    ) order by s.created_at desc)
    from public.os_marketing_revenue_cohort_performance_snapshots s
    where s.created_at >= v_since
      and (p_entity_id is null or s.entity_id is null or s.entity_id = p_entity_id)
    limit 100
  ), '[]'::jsonb) into v_perf;

  v_aging := public.list_marketing_open_attribution_conflicts_aging_phase48(
    p_entity_id,
    coalesce((v_defaults->>'conflict_aging_days')::integer,7),
    50,
    false);

  select coalesce(jsonb_array_length(v_aging->'conflicts'),0) into v_open_aging;

  select count(*)::integer into v_pending_closures
  from public.os_marketing_revenue_attribution_conflict_closures cl
  join public.os_marketing_revenue_attribution_conflicts cf
    on cf.conflict_id = cl.conflict_id
  where cl.closure_status = 'proposed'
    and cl.created_at >= v_since
    and (p_entity_id is null or cf.entity_id = p_entity_id)
    and not public.phase48_conflict_is_archived(cl.conflict_id);

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_id',a.alert_id,
      'entity_id',a.entity_id,
      'source_id',a.source_id,
      'cohort_id',a.cohort_id,
      'archive_id',a.archive_id,
      'alert_kind',a.alert_kind,
      'window_key',a.window_key,
      'severity',a.severity,
      'destination_key',a.destination_key,
      'delivery_status',a.delivery_status,
      'response_code',a.response_code,
      'metrics_sha256',a.metrics_sha256,
      'created_at',a.created_at
    ) order by a.created_at desc)
    from public.os_marketing_revenue_phase48_ops_alerts a
    where a.created_at >= v_since
      and (p_entity_id is null or a.entity_id = p_entity_id)
    limit 50
  ), '[]'::jsonb) into v_alerts;

  if v_blocked > 0 then
    v_autopilot_health := 'critical';
  elsif v_waiting > 0 then
    v_autopilot_health := 'warning';
  elsif v_promoted > 0 then
    v_autopilot_health := 'healthy';
  elsif jsonb_array_length(coalesce(v_autopilot,'[]'::jsonb)) = 0 then
    v_autopilot_health := 'unknown';
  else
    v_autopilot_health := 'healthy';
  end if;

  if v_archived_count = 0 then
    v_archive_health := 'unknown';
  else
    v_archive_health := 'healthy';
  end if;

  select coalesce((
    select x.severity
    from jsonb_to_recordset(coalesce(v_perf,'[]'::jsonb))
      as x(severity text, created_at timestamptz)
    order by x.created_at desc
    limit 1
  ), 'unknown') into v_latest_sev;
  v_perf_health := coalesce(v_latest_sev, 'unknown');

  if v_open_aging = 0 and v_pending_closures = 0 then
    v_conflict_resolution_health := 'healthy';
  elsif v_open_aging >= 5 or v_pending_closures >= 3 then
    v_conflict_resolution_health := 'critical';
  else
    v_conflict_resolution_health := 'warning';
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
    'version','phase48-v1',
    'window_days',v_days,
    'autopilot_health',v_autopilot_health,
    'archive_health',v_archive_health,
    'cohort_performance_health',v_perf_health,
    'conflict_resolution_health',v_conflict_resolution_health,
    'alert_delivery',v_alert_delivery,
    'autopilot_waiting_count',v_waiting,
    'autopilot_promoted_count',v_promoted,
    'autopilot_blocked_count',v_blocked,
    'archives_count',v_archived_count,
    'open_aging_count',v_open_aging,
    'pending_closure_count',v_pending_closures,
    'thresholds',v_defaults,
    'autopilot_runs',coalesce(v_autopilot,'[]'::jsonb),
    'conflict_archives',coalesce(v_archives,'[]'::jsonb),
    'performance_snapshots',coalesce(v_perf,'[]'::jsonb),
    'aging_conflicts',coalesce(v_aging->'conflicts','[]'::jsonb),
    'alerts',coalesce(v_alerts,'[]'::jsonb),
    'destination_key','ops_alerts');
end;
$$;

revoke all on function public.prevent_marketing_revenue_phase48_ops_mutation()
  from public, anon, authenticated;
revoke all on function public.phase48_marketing_ops_safe_metadata(jsonb)
  from public, anon, authenticated;
revoke all on function public.phase48_default_autopilot_thresholds()
  from public, anon, authenticated;
revoke all on function public.phase48_conflict_is_archived(uuid)
  from public, anon, authenticated;
revoke all on function public.list_marketing_open_attribution_conflicts_aging_phase48(text,integer,integer,boolean)
  from public, anon, authenticated;
revoke all on function public.archive_marketing_closed_conflict_cohorts_phase48(jsonb)
  from public, anon, authenticated;
revoke all on function public.record_marketing_cohort_performance_snapshot_phase48(text,integer)
  from public, anon, authenticated;
revoke all on function public.run_marketing_cohort_autopilot_phase48(jsonb)
  from public, anon, authenticated;
revoke all on function public.list_marketing_revenue_phase48_critical_windows(text,integer,integer)
  from public, anon, authenticated;
revoke all on function public.record_marketing_revenue_phase48_ops_alert(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_marketing_revenue_phase48_ops_report(text,integer)
  from public, anon, authenticated;

grant execute on function public.phase48_marketing_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.phase48_default_autopilot_thresholds()
  to authenticated, service_role;
grant execute on function public.phase48_conflict_is_archived(uuid)
  to authenticated, service_role;
grant execute on function public.list_marketing_open_attribution_conflicts_aging_phase48(text,integer,integer,boolean)
  to authenticated, service_role;
grant execute on function public.list_marketing_revenue_phase48_critical_windows(text,integer,integer)
  to authenticated, service_role;
grant execute on function public.get_marketing_revenue_phase48_ops_report(text,integer)
  to authenticated, service_role;

grant execute on function public.archive_marketing_closed_conflict_cohorts_phase48(jsonb)
  to service_role;
grant execute on function public.record_marketing_cohort_performance_snapshot_phase48(text,integer)
  to service_role;
grant execute on function public.run_marketing_cohort_autopilot_phase48(jsonb)
  to service_role;
grant execute on function public.record_marketing_revenue_phase48_ops_alert(jsonb)
  to service_role;
