-- Phase 50: multi-quarter cadence SLO trend dashboards, second-approver
-- reminders for pending budget revision proposals, and better recurring
-- quarterly process visibility. Apply after phase49_docusign_archive_ops.sql.
-- Safe to re-run.
-- Never create/void/resend envelopes. Evidence = digests/metadata only.
-- Never mutates snapshot retirement tables. Reminders are notifications
-- only — this file NEVER calls approve_docusign_budget_revision_proposal_phase49
-- and never auto-activates a budget revision.

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

-- Bootstrap Phase 49 safe-metadata helper if prior DocuSign SQL was skipped.
create or replace function public.phase49_docusign_ops_safe_metadata(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select
    p_detail is null
    or (
      jsonb_typeof(p_detail)='object'
      and pg_column_size(p_detail)<=8192
      and p_detail::text !~*
        '"[^"]*(payload|secret|token|password|authorization|cookie|body|bytes|base64)[^"]*"\s*:'
      and p_detail::text !~*
        '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://)'
    );
$$;

create or replace function public.phase50_docusign_ops_safe_metadata(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select public.phase49_docusign_ops_safe_metadata(p_detail);
$$;

-- ---------------------------------------------------------------------------
-- Phase 50: multi-quarter cadence SLO trend snapshots (append-only). Trends
-- are computed read-only over the Phase 49 cadence SLO history.
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_cadence_trend_snapshots (
  trend_id uuid primary key default gen_random_uuid(),
  trend_key text not null unique
    check (trend_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  windows_compared integer not null check (windows_compared between 1 and 12),
  latest_on_time_rate numeric,
  prior_on_time_rate numeric,
  trend_direction text not null default 'unknown'
    check (trend_direction in ('improving','stable','declining','unknown')),
  consecutive_healthy_snapshots integer not null default 0
    check (consecutive_healthy_snapshots >= 0),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_cadence_trend_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase50_docusign_ops_safe_metadata(metadata)
    )
);

create index if not exists os_docusign_archive_cadence_trend_created_idx
  on public.os_docusign_archive_cadence_trend_snapshots(created_at desc);
create index if not exists os_docusign_archive_cadence_trend_direction_idx
  on public.os_docusign_archive_cadence_trend_snapshots(trend_direction, created_at desc);

alter table public.os_docusign_archive_cadence_trend_snapshots
  enable row level security;
drop policy if exists "os_docusign_archive_cadence_trend_select"
  on public.os_docusign_archive_cadence_trend_snapshots;
create policy "os_docusign_archive_cadence_trend_select"
  on public.os_docusign_archive_cadence_trend_snapshots for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_cadence_trend_snapshots
  from public, anon, authenticated;
grant select on public.os_docusign_archive_cadence_trend_snapshots
  to authenticated;

-- ---------------------------------------------------------------------------
-- Phase 50: append-only second-approver reminder receipts for budget
-- revision proposals that already have exactly 1 distinct approval and are
-- still awaiting a second, distinct human approver. Reminders NEVER approve
-- or activate — they are notifications only.
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_second_approver_reminders (
  reminder_id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null
    references public.os_docusign_archive_budget_revision_proposals(proposal_id),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  distinct_approvers integer not null check (distinct_approvers between 0 and 1),
  destination_key text not null
    check (destination_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  delivery_status text not null
    check (delivery_status in
      ('delivered','skipped_no_webhook','failed','recorded')),
  response_code integer
    check (response_code is null or response_code between 100 and 599),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_2nd_appr_reminder_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase50_docusign_ops_safe_metadata(metadata)
    ),
  constraint os_docusign_archive_2nd_appr_reminder_no_activate_check
    check (coalesce((metadata->>'never_activates')::boolean,true) = true)
);

create index if not exists os_docusign_archive_2nd_appr_reminder_created_idx
  on public.os_docusign_archive_second_approver_reminders(created_at desc);
create index if not exists os_docusign_archive_2nd_appr_reminder_proposal_idx
  on public.os_docusign_archive_second_approver_reminders(proposal_id, created_at desc);

alter table public.os_docusign_archive_second_approver_reminders
  enable row level security;
drop policy if exists "os_docusign_archive_2nd_appr_reminder_select"
  on public.os_docusign_archive_second_approver_reminders;
create policy "os_docusign_archive_2nd_appr_reminder_select"
  on public.os_docusign_archive_second_approver_reminders for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_second_approver_reminders
  from public, anon, authenticated;
grant select on public.os_docusign_archive_second_approver_reminders
  to authenticated;

-- ---------------------------------------------------------------------------
-- Phase 50: recurring quarterly process visibility snapshots (append-only).
-- Read-only rollup over Phase 47/48 recurring + subsequent quarterly runs.
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_recurring_visibility_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  snapshot_key text not null unique
    check (snapshot_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  quarters_tracked integer not null default 0 check (quarters_tracked >= 0),
  quarters_on_time integer not null default 0 check (quarters_on_time >= 0),
  quarters_breached integer not null default 0 check (quarters_breached >= 0),
  process_health text not null default 'unknown'
    check (process_health in ('unknown','healthy','warning','critical')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_recur_vis_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase50_docusign_ops_safe_metadata(metadata)
    )
);

create index if not exists os_docusign_archive_recur_vis_created_idx
  on public.os_docusign_archive_recurring_visibility_snapshots(created_at desc);

alter table public.os_docusign_archive_recurring_visibility_snapshots
  enable row level security;
drop policy if exists "os_docusign_archive_recur_vis_select"
  on public.os_docusign_archive_recurring_visibility_snapshots;
create policy "os_docusign_archive_recur_vis_select"
  on public.os_docusign_archive_recurring_visibility_snapshots for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_recurring_visibility_snapshots
  from public, anon, authenticated;
grant select on public.os_docusign_archive_recurring_visibility_snapshots
  to authenticated;

-- ---------------------------------------------------------------------------
-- Phase 50 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_phase50_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  alert_kind text not null,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null default 'warning'
    check (severity in ('warning','critical')),
  destination_key text not null
    check (destination_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  delivery_status text not null
    check (delivery_status in
      ('delivered','skipped_no_webhook','failed','recorded')),
  response_code integer
    check (response_code is null or response_code between 100 and 599),
  metrics_sha256 text not null
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_p50_alert_kind_check
    check (alert_kind in (
      'cadence_trend_declining',
      'budget_revision_second_approver_reminder',
      'recurring_process_health_critical'
    )),
  constraint os_docusign_archive_p50_alert_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase50_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_p50_alert_created_idx
  on public.os_docusign_archive_phase50_ops_alerts(created_at desc);
create index if not exists os_docusign_archive_p50_alert_kind_idx
  on public.os_docusign_archive_phase50_ops_alerts(alert_kind, created_at desc);

alter table public.os_docusign_archive_phase50_ops_alerts
  enable row level security;
drop policy if exists "os_docusign_archive_p50_alert_select"
  on public.os_docusign_archive_phase50_ops_alerts;
create policy "os_docusign_archive_p50_alert_select"
  on public.os_docusign_archive_phase50_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_phase50_ops_alerts
  from public, anon, authenticated;
grant select on public.os_docusign_archive_phase50_ops_alerts
  to authenticated;

create or replace function public.reject_docusign_phase50_ops_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Phase 50 DocuSign archive ops evidence is append-only';
end;
$$;

drop trigger if exists os_docusign_archive_cadence_trend_immutable
  on public.os_docusign_archive_cadence_trend_snapshots;
create trigger os_docusign_archive_cadence_trend_immutable
  before update or delete on public.os_docusign_archive_cadence_trend_snapshots
  for each row execute function public.reject_docusign_phase50_ops_mutation();
drop trigger if exists os_docusign_archive_cadence_trend_no_truncate
  on public.os_docusign_archive_cadence_trend_snapshots;
create trigger os_docusign_archive_cadence_trend_no_truncate
  before truncate on public.os_docusign_archive_cadence_trend_snapshots
  for each statement execute function public.reject_docusign_phase50_ops_mutation();

drop trigger if exists os_docusign_archive_2nd_appr_reminder_immutable
  on public.os_docusign_archive_second_approver_reminders;
create trigger os_docusign_archive_2nd_appr_reminder_immutable
  before update or delete on public.os_docusign_archive_second_approver_reminders
  for each row execute function public.reject_docusign_phase50_ops_mutation();
drop trigger if exists os_docusign_archive_2nd_appr_reminder_no_truncate
  on public.os_docusign_archive_second_approver_reminders;
create trigger os_docusign_archive_2nd_appr_reminder_no_truncate
  before truncate on public.os_docusign_archive_second_approver_reminders
  for each statement execute function public.reject_docusign_phase50_ops_mutation();

drop trigger if exists os_docusign_archive_recur_vis_immutable
  on public.os_docusign_archive_recurring_visibility_snapshots;
create trigger os_docusign_archive_recur_vis_immutable
  before update or delete on public.os_docusign_archive_recurring_visibility_snapshots
  for each row execute function public.reject_docusign_phase50_ops_mutation();
drop trigger if exists os_docusign_archive_recur_vis_no_truncate
  on public.os_docusign_archive_recurring_visibility_snapshots;
create trigger os_docusign_archive_recur_vis_no_truncate
  before truncate on public.os_docusign_archive_recurring_visibility_snapshots
  for each statement execute function public.reject_docusign_phase50_ops_mutation();

drop trigger if exists os_docusign_archive_p50_alert_immutable
  on public.os_docusign_archive_phase50_ops_alerts;
create trigger os_docusign_archive_p50_alert_immutable
  before update or delete on public.os_docusign_archive_phase50_ops_alerts
  for each row execute function public.reject_docusign_phase50_ops_mutation();
drop trigger if exists os_docusign_archive_p50_alert_no_truncate
  on public.os_docusign_archive_phase50_ops_alerts;
create trigger os_docusign_archive_p50_alert_no_truncate
  before truncate on public.os_docusign_archive_phase50_ops_alerts
  for each statement execute function public.reject_docusign_phase50_ops_mutation();

-- ---------------------------------------------------------------------------
-- Record a multi-quarter cadence SLO trend snapshot over Phase 49 cadence
-- SLO history. Read + append-only. Never creates/voids/resends envelopes.
-- ---------------------------------------------------------------------------
create or replace function public.record_docusign_cadence_trend_snapshot_phase50(
  p_metadata jsonb default '{}'::jsonb,
  p_windows integer default 4
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_windows integer := least(greatest(coalesce(p_windows, 4), 1), 12);
  v_latest public.os_docusign_archive_multi_quarter_cadence_slos%rowtype;
  v_prior public.os_docusign_archive_multi_quarter_cadence_slos%rowtype;
  v_healthy_streak integer := 0;
  v_direction text := 'unknown';
  v_key text;
  v_hash text;
  v_row public.os_docusign_archive_cadence_trend_snapshots%rowtype;
  v_rec record;
begin
  if not public.phase50_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 50 cadence trend metadata is invalid or unsafe';
  end if;

  select * into v_latest
  from public.os_docusign_archive_multi_quarter_cadence_slos
  order by created_at desc
  limit 1;

  select * into v_prior
  from public.os_docusign_archive_multi_quarter_cadence_slos
  order by created_at desc
  offset 1
  limit 1;

  if v_latest.slo_id is null then
    v_direction := 'unknown';
  elsif v_prior.slo_id is null or v_latest.on_time_rate is null
    or v_prior.on_time_rate is null then
    v_direction := 'unknown';
  elsif v_latest.on_time_rate > v_prior.on_time_rate then
    v_direction := 'improving';
  elsif v_latest.on_time_rate < v_prior.on_time_rate then
    v_direction := 'declining';
  else
    v_direction := 'stable';
  end if;

  v_healthy_streak := 0;
  for v_rec in
    select severity from public.os_docusign_archive_multi_quarter_cadence_slos
    order by created_at desc
    limit v_windows
  loop
    if v_rec.severity = 'healthy' then
      v_healthy_streak := v_healthy_streak + 1;
    else
      exit;
    end if;
  end loop;

  v_key := left(
    'cadencetrend50:firm:' || to_char(now(),'YYYYMMDD"T"HH24'),
    200);
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase50-v1',
    'kind','cadence_trend_snapshot',
    'windows_compared',v_windows,
    'latest_on_time_rate',v_latest.on_time_rate,
    'prior_on_time_rate',v_prior.on_time_rate,
    'trend_direction',v_direction,
    'consecutive_healthy_snapshots',v_healthy_streak
  )::text);

  insert into public.os_docusign_archive_cadence_trend_snapshots(
    trend_key,windows_compared,latest_on_time_rate,prior_on_time_rate,
    trend_direction,consecutive_healthy_snapshots,metrics_sha256,metadata)
  values (
    v_key,v_windows,v_latest.on_time_rate,v_prior.on_time_rate,v_direction,
    v_healthy_streak,v_hash,
    v_meta || jsonb_build_object('contract_version','phase50-v1'))
  on conflict (trend_key) do nothing
  returning * into v_row;

  if v_row.trend_id is null then
    select * into v_row
    from public.os_docusign_archive_cadence_trend_snapshots
    where trend_key = v_key;
    return jsonb_build_object(
      'version','phase50-v1',
      'disposition','unchanged',
      'trend_id',v_row.trend_id,
      'trend_direction',v_row.trend_direction,
      'consecutive_healthy_snapshots',v_row.consecutive_healthy_snapshots,
      'metrics_sha256',v_row.metrics_sha256);
  end if;

  return jsonb_build_object(
    'version','phase50-v1',
    'disposition','recorded',
    'trend_id',v_row.trend_id,
    'trend_direction',v_row.trend_direction,
    'consecutive_healthy_snapshots',v_row.consecutive_healthy_snapshots,
    'metrics_sha256',v_row.metrics_sha256);
end;
$$;

-- ---------------------------------------------------------------------------
-- Record a read + append-only recurring quarterly process visibility
-- snapshot over Phase 47/48 recurring + subsequent quarterly run evidence.
-- ---------------------------------------------------------------------------
create or replace function public.record_docusign_recurring_visibility_snapshot_phase50(
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_tracked integer := 0;
  v_on_time integer := 0;
  v_breached integer := 0;
  v_health text := 'unknown';
  v_key text;
  v_hash text;
  v_row public.os_docusign_archive_recurring_visibility_snapshots%rowtype;
begin
  if not public.phase50_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 50 recurring visibility metadata is invalid or unsafe';
  end if;

  select count(*)::integer,
    count(*) filter (where status='completed')::integer,
    count(*) filter (where status='drift_budget_breach')::integer
  into v_tracked, v_on_time, v_breached
  from (
    select run_id, status, created_at
    from public.os_docusign_archive_subsequent_quarterly_runs
    where status in ('completed','drift_budget_breach')
    union all
    select run_id, status, created_at
    from public.os_docusign_archive_recurring_quarterly_runs
    where status in ('completed','drift_budget_breach')
    order by created_at desc
    limit 12
  ) r;

  if v_tracked = 0 then
    v_health := 'unknown';
  elsif v_breached = 0 then
    v_health := 'healthy';
  elsif v_on_time::numeric / v_tracked::numeric >= 0.5 then
    v_health := 'warning';
  else
    v_health := 'critical';
  end if;

  v_key := left(
    'recurvis50:firm:' || to_char(now(),'YYYYMMDD"T"HH24'),
    200);
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase50-v1',
    'kind','recurring_visibility_snapshot',
    'quarters_tracked',v_tracked,
    'quarters_on_time',v_on_time,
    'quarters_breached',v_breached,
    'process_health',v_health
  )::text);

  insert into public.os_docusign_archive_recurring_visibility_snapshots(
    snapshot_key,quarters_tracked,quarters_on_time,quarters_breached,
    process_health,metrics_sha256,metadata)
  values (
    v_key,v_tracked,v_on_time,v_breached,v_health,v_hash,
    v_meta || jsonb_build_object('contract_version','phase50-v1'))
  on conflict (snapshot_key) do nothing
  returning * into v_row;

  if v_row.snapshot_id is null then
    select * into v_row
    from public.os_docusign_archive_recurring_visibility_snapshots
    where snapshot_key = v_key;
    return jsonb_build_object(
      'version','phase50-v1',
      'disposition','unchanged',
      'snapshot_id',v_row.snapshot_id,
      'process_health',v_row.process_health);
  end if;

  return jsonb_build_object(
    'version','phase50-v1',
    'disposition','recorded',
    'snapshot_id',v_row.snapshot_id,
    'process_health',v_row.process_health);
end;
$$;

-- ---------------------------------------------------------------------------
-- List budget revision proposals still open (not yet activated/rejected)
-- that have exactly 1 distinct 'approve' decision and are awaiting a second,
-- distinct human approver. Never activates or approves anything.
-- ---------------------------------------------------------------------------
create or replace function public.list_docusign_archive_phase50_critical_windows(
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
  v_proposal record;
  v_trend public.os_docusign_archive_cadence_trend_snapshots%rowtype;
  v_recur public.os_docusign_archive_recurring_visibility_snapshots%rowtype;
  v_key text;
begin
  v_bucket := to_char(
    to_timestamp(
      (floor(extract(epoch from now()) / (v_hours * 3600.0))
        * (v_hours * 3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  for v_proposal in
    select p.proposal_id, p.budget_key,
      count(distinct a.actor_id) filter (where a.decision='approve') as distinct_approvers
    from public.os_docusign_archive_budget_revision_proposals p
    left join public.os_docusign_archive_budget_revision_approvals a
      on a.proposal_id = p.proposal_id
    where p.status = 'proposed'
      and not exists (
        select 1 from public.os_docusign_archive_budget_revision_proposals x
        where x.source_proposal_id = p.proposal_id
      )
    group by p.proposal_id, p.budget_key
    having count(distinct a.actor_id) filter (where a.decision='approve') = 1
    order by p.proposal_id
    limit 25
  loop
    v_key := 'secondapprreminder50:' || v_proposal.proposal_id::text || ':' || v_bucket || 'h' || v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase50_ops_alerts a
      where a.window_key = v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','budget_revision_second_approver_reminder',
        'window_key',v_key,
        'severity','warning',
        'proposal_id',v_proposal.proposal_id,
        'budget_key',v_proposal.budget_key,
        'distinct_approvers',v_proposal.distinct_approvers
      ));
    end if;
  end loop;

  select * into v_trend
  from public.os_docusign_archive_cadence_trend_snapshots
  order by created_at desc
  limit 1;

  if v_trend.trend_id is not null and v_trend.trend_direction = 'declining' then
    v_key := 'cadencetrenddecline50:firm:' || v_bucket || 'h' || v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase50_ops_alerts a
      where a.window_key = v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','cadence_trend_declining',
        'window_key',v_key,
        'severity','warning',
        'trend_id',v_trend.trend_id,
        'metrics_sha256',v_trend.metrics_sha256
      ));
    end if;
  end if;

  select * into v_recur
  from public.os_docusign_archive_recurring_visibility_snapshots
  order by created_at desc
  limit 1;

  if v_recur.snapshot_id is not null and v_recur.process_health = 'critical' then
    v_key := 'recurcritical50:firm:' || v_bucket || 'h' || v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase50_ops_alerts a
      where a.window_key = v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','recurring_process_health_critical',
        'window_key',v_key,
        'severity','critical',
        'snapshot_id',v_recur.snapshot_id,
        'metrics_sha256',v_recur.metrics_sha256
      ));
    end if;
  end if;

  return jsonb_build_object(
    'version','phase50-v1',
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',v_pending
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record a second-approver reminder delivery receipt (idempotent window_key).
-- Never activates or approves.
-- ---------------------------------------------------------------------------
create or replace function public.record_docusign_second_approver_reminder_phase50(
  p_alert jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_proposal_id uuid;
  v_window text;
  v_distinct integer;
  v_dest text;
  v_delivery text;
  v_code integer;
  v_hash text;
  v_meta jsonb;
  v_id uuid;
  v_status text;
begin
  if jsonb_typeof(coalesce(p_alert,'{}'::jsonb)) <> 'object' then
    raise exception 'Phase 50 second-approver reminder payload must be a JSON object';
  end if;

  v_proposal_id := nullif(p_alert->>'proposal_id','')::uuid;
  v_window := coalesce(p_alert->>'window_key','');
  v_distinct := coalesce((p_alert->>'distinct_approvers')::integer,1);
  v_dest := coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery := coalesce(p_alert->>'delivery_status','recorded');
  v_code := nullif(p_alert->>'response_code','')::integer;
  v_meta := coalesce(p_alert->'metadata','{}'::jsonb);

  if v_proposal_id is null
     or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or v_distinct not between 0 and 1
     or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
     or v_dest ~* '://|^https?'
     or v_delivery not in
       ('delivered','skipped_no_webhook','failed','recorded')
     or not public.phase50_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 50 second-approver reminder contract is invalid or unsafe';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase50-v1',
    'proposal_id',v_proposal_id,
    'window_key',v_window,
    'distinct_approvers',v_distinct,
    'destination_key',v_dest,
    'delivery_status',v_delivery,
    'response_code',v_code
  )::text);

  insert into public.os_docusign_archive_second_approver_reminders(
    proposal_id,window_key,distinct_approvers,destination_key,
    delivery_status,response_code,metrics_sha256,metadata)
  values (
    v_proposal_id,v_window,v_distinct,v_dest,v_delivery,v_code,v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase50-v1','never_activates',true))
  on conflict (window_key) do nothing
  returning reminder_id, delivery_status into v_id, v_status;

  if v_id is null then
    select reminder_id, delivery_status into v_id, v_status
    from public.os_docusign_archive_second_approver_reminders
    where window_key = v_window;
    return jsonb_build_object(
      'version','phase50-v1',
      'reminder_id',v_id,
      'window_key',v_window,
      'delivery_status',v_status,
      'inserted',false,
      'never_activates',true);
  end if;

  return jsonb_build_object(
    'version','phase50-v1',
    'reminder_id',v_id,
    'window_key',v_window,
    'delivery_status',v_status,
    'inserted',true,
    'never_activates',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Record one critical/warning ops alert after delivery attempt (idempotent
-- window_key)
-- ---------------------------------------------------------------------------
create or replace function public.record_docusign_archive_phase50_ops_alert(
  p_alert jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_kind text;
  v_window text;
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
    raise exception 'Phase 50 ops alert payload must be a JSON object';
  end if;

  v_kind := coalesce(p_alert->>'alert_kind','');
  v_window := coalesce(p_alert->>'window_key','');
  v_dest := coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery := coalesce(p_alert->>'delivery_status','recorded');
  v_code := nullif(p_alert->>'response_code','')::integer;
  v_severity := coalesce(nullif(p_alert->>'severity',''),'warning');
  v_meta := coalesce(p_alert->'metadata','{}'::jsonb);

  if v_kind not in (
       'cadence_trend_declining',
       'budget_revision_second_approver_reminder',
       'recurring_process_health_critical'
     )
     or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
     or v_dest ~* '://|^https?'
     or v_severity not in ('warning','critical')
     or v_delivery not in
       ('delivered','skipped_no_webhook','failed','recorded')
     or not public.phase50_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 50 ops alert contract is invalid or unsafe';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase50-v1',
    'alert_kind',v_kind,
    'window_key',v_window,
    'severity',v_severity,
    'destination_key',v_dest,
    'delivery_status',v_delivery,
    'response_code',v_code
  )::text);

  insert into public.os_docusign_archive_phase50_ops_alerts(
    alert_kind,window_key,severity,destination_key,
    delivery_status,response_code,metrics_sha256,metadata)
  values (
    v_kind,v_window,v_severity,v_dest,
    v_delivery,v_code,v_hash,
    v_meta || jsonb_build_object('contract_version','phase50-v1'))
  on conflict (window_key) do nothing
  returning alert_id, delivery_status into v_id, v_status;

  if v_id is null then
    select alert_id, delivery_status into v_id, v_status
    from public.os_docusign_archive_phase50_ops_alerts
    where window_key = v_window;
    return jsonb_build_object(
      'version','phase50-v1',
      'alert_id',v_id,
      'window_key',v_window,
      'delivery_status',v_status,
      'inserted',false);
  end if;

  return jsonb_build_object(
    'version','phase50-v1',
    'alert_id',v_id,
    'window_key',v_window,
    'delivery_status',v_status,
    'inserted',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Hub report: cadence trend + second-approver reminder visibility +
-- recurring quarterly process health (read-only over Phase 49 evidence)
-- ---------------------------------------------------------------------------
create or replace function public.get_docusign_archive_phase50_ops_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_trend public.os_docusign_archive_cadence_trend_snapshots%rowtype;
  v_recur public.os_docusign_archive_recurring_visibility_snapshots%rowtype;
  v_pending_reminders integer := 0;
  v_reminders_sent_7d integer := 0;
  v_alerts jsonb;
  v_alert_delivery text := 'none';
  v_failed boolean := false;
  v_skipped boolean := false;
  v_delivered boolean := false;
  v_recorded boolean := false;
begin
  select * into v_trend
  from public.os_docusign_archive_cadence_trend_snapshots
  order by created_at desc
  limit 1;

  select * into v_recur
  from public.os_docusign_archive_recurring_visibility_snapshots
  order by created_at desc
  limit 1;

  select count(distinct p.proposal_id)::integer into v_pending_reminders
  from public.os_docusign_archive_budget_revision_proposals p
  left join public.os_docusign_archive_budget_revision_approvals a
    on a.proposal_id = p.proposal_id
  where p.status = 'proposed'
    and not exists (
      select 1 from public.os_docusign_archive_budget_revision_proposals x
      where x.source_proposal_id = p.proposal_id
    )
  group by p.proposal_id
  having count(distinct a.actor_id) filter (where a.decision='approve') = 1;

  select count(*)::integer into v_reminders_sent_7d
  from public.os_docusign_archive_second_approver_reminders
  where created_at >= now() - interval '7 days';

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
  into v_alerts
  from (
    select alert_id, alert_kind, window_key, severity, destination_key,
      delivery_status, response_code, metrics_sha256, created_at
    from public.os_docusign_archive_phase50_ops_alerts
    order by created_at desc
    limit 20
  ) a;

  select
    bool_or(x.delivery_status = 'failed'),
    bool_or(x.delivery_status = 'skipped_no_webhook'),
    bool_or(x.delivery_status = 'delivered'),
    bool_or(x.delivery_status = 'recorded')
  into v_failed, v_skipped, v_delivered, v_recorded
  from public.os_docusign_archive_phase50_ops_alerts x
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
    'version','phase50-v1',
    'cadence_trend_direction',coalesce(v_trend.trend_direction,'unknown'),
    'cadence_consecutive_healthy_snapshots',
      coalesce(v_trend.consecutive_healthy_snapshots,0),
    'recurring_process_health',coalesce(v_recur.process_health,'unknown'),
    'recurring_quarters_tracked',coalesce(v_recur.quarters_tracked,0),
    'pending_second_approver_reminder_count',coalesce(v_pending_reminders,0),
    'reminders_sent_7d',v_reminders_sent_7d,
    'alert_delivery',v_alert_delivery,
    'latest_cadence_trend', case
      when v_trend.trend_id is null then null
      else jsonb_build_object(
        'trend_id',v_trend.trend_id,
        'windows_compared',v_trend.windows_compared,
        'latest_on_time_rate',v_trend.latest_on_time_rate,
        'prior_on_time_rate',v_trend.prior_on_time_rate,
        'trend_direction',v_trend.trend_direction,
        'created_at',v_trend.created_at
      )
    end,
    'latest_recurring_visibility', case
      when v_recur.snapshot_id is null then null
      else jsonb_build_object(
        'snapshot_id',v_recur.snapshot_id,
        'quarters_tracked',v_recur.quarters_tracked,
        'quarters_on_time',v_recur.quarters_on_time,
        'quarters_breached',v_recur.quarters_breached,
        'process_health',v_recur.process_health,
        'created_at',v_recur.created_at
      )
    end,
    'alerts',coalesce(v_alerts,'[]'::jsonb),
    'destination_key','ops_alerts',
    'never_creates_voids_or_resends_envelopes',true,
    'never_auto_activates',true
  );
end;
$$;

revoke all on function public.phase50_docusign_ops_safe_metadata(jsonb)
  from public, anon, authenticated;
revoke all on function public.record_docusign_cadence_trend_snapshot_phase50(jsonb,integer)
  from public, anon, authenticated;
revoke all on function public.record_docusign_recurring_visibility_snapshot_phase50(jsonb)
  from public, anon, authenticated;
revoke all on function public.list_docusign_archive_phase50_critical_windows(integer)
  from public, anon;
revoke all on function public.record_docusign_second_approver_reminder_phase50(jsonb)
  from public, anon, authenticated;
revoke all on function public.record_docusign_archive_phase50_ops_alert(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_docusign_archive_phase50_ops_report()
  from public, anon;

grant execute on function public.phase50_docusign_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.list_docusign_archive_phase50_critical_windows(integer)
  to authenticated, service_role;
grant execute on function public.get_docusign_archive_phase50_ops_report()
  to authenticated, service_role;

grant execute on function public.record_docusign_cadence_trend_snapshot_phase50(jsonb,integer)
  to service_role;
grant execute on function public.record_docusign_recurring_visibility_snapshot_phase50(jsonb)
  to service_role;
grant execute on function public.record_docusign_second_approver_reminder_phase50(jsonb)
  to service_role;
grant execute on function public.record_docusign_archive_phase50_ops_alert(jsonb)
  to service_role;
grant execute on function public.os_sha256_hex(text)
  to authenticated, service_role;
