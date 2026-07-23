-- Phase 51: firm-wide multi-quarter cadence trend ROLLUPS (streaks + min/max/
-- avg over several Phase 50 cadence trend snapshots), third-approver
-- escalation receipts when a Phase 50 second-approver reminder goes
-- unanswered past a threshold, and better pending-proposal/escalation
-- visibility. Apply after phase50_docusign_archive_ops.sql. Safe to re-run.
-- Never create/void/resend envelopes. Evidence = digests/metadata only.
-- Never mutates snapshot retirement tables. Escalations are notifications
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

-- Bootstrap Phase 50 safe-metadata helper if prior DocuSign SQL was skipped.
create or replace function public.phase50_docusign_ops_safe_metadata(p_detail jsonb)
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

create or replace function public.phase51_docusign_ops_safe_metadata(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select public.phase50_docusign_ops_safe_metadata(p_detail);
$$;

-- ---------------------------------------------------------------------------
-- Phase 51: firm-wide cadence trend ROLLUPS across quarters (append-only).
-- Read-only aggregation over Phase 50's cadence_trend_snapshots — tracks
-- min/max/average on-time rate and improving/declining streaks over a
-- longer window than a single Phase 50 snapshot compares.
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_phase51_cadence_rollups (
  rollup_id uuid primary key default gen_random_uuid(),
  rollup_key text not null unique
    check (rollup_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  snapshots_compared integer not null check (snapshots_compared between 1 and 24),
  min_on_time_rate numeric,
  max_on_time_rate numeric,
  avg_on_time_rate numeric,
  improving_streak integer not null default 0 check (improving_streak >= 0),
  declining_streak integer not null default 0 check (declining_streak >= 0),
  overall_trend text not null default 'unknown'
    check (overall_trend in ('improving','stable','declining','mixed','unknown')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_p51_rollup_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase51_docusign_ops_safe_metadata(metadata)
    )
);

create index if not exists os_docusign_archive_p51_rollup_created_idx
  on public.os_docusign_archive_phase51_cadence_rollups(created_at desc);

alter table public.os_docusign_archive_phase51_cadence_rollups
  enable row level security;
drop policy if exists "os_docusign_archive_p51_rollup_select"
  on public.os_docusign_archive_phase51_cadence_rollups;
create policy "os_docusign_archive_p51_rollup_select"
  on public.os_docusign_archive_phase51_cadence_rollups for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_phase51_cadence_rollups
  from public, anon, authenticated;
grant select on public.os_docusign_archive_phase51_cadence_rollups
  to authenticated;

-- ---------------------------------------------------------------------------
-- Phase 51: append-only third-approver escalation receipts. Recorded when a
-- budget revision proposal still has exactly 1 distinct 'approve' decision
-- AND its earliest Phase 50 second-approver reminder was sent at least
-- p_threshold_days ago with no second approval yet. Escalations are
-- notifications only — they NEVER approve or activate.
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_third_approver_escalations (
  escalation_id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null
    references public.os_docusign_archive_budget_revision_proposals(proposal_id),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  distinct_approvers integer not null check (distinct_approvers between 0 and 1),
  days_since_first_reminder integer not null check (days_since_first_reminder >= 0),
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
  constraint os_docusign_archive_p51_escalation_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase51_docusign_ops_safe_metadata(metadata)
    ),
  constraint os_docusign_archive_p51_escalation_no_activate_check
    check (coalesce((metadata->>'never_activates')::boolean,true) = true)
);

create index if not exists os_docusign_archive_p51_escalation_created_idx
  on public.os_docusign_archive_third_approver_escalations(created_at desc);
create index if not exists os_docusign_archive_p51_escalation_proposal_idx
  on public.os_docusign_archive_third_approver_escalations(proposal_id, created_at desc);

alter table public.os_docusign_archive_third_approver_escalations
  enable row level security;
drop policy if exists "os_docusign_archive_p51_escalation_select"
  on public.os_docusign_archive_third_approver_escalations;
create policy "os_docusign_archive_p51_escalation_select"
  on public.os_docusign_archive_third_approver_escalations for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_third_approver_escalations
  from public, anon, authenticated;
grant select on public.os_docusign_archive_third_approver_escalations
  to authenticated;

-- ---------------------------------------------------------------------------
-- Phase 51 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_phase51_ops_alerts (
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
  constraint os_docusign_archive_p51_alert_kind_check
    check (alert_kind in (
      'cadence_rollup_declining',
      'third_approver_escalation_raised'
    )),
  constraint os_docusign_archive_p51_alert_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase51_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_p51_alert_created_idx
  on public.os_docusign_archive_phase51_ops_alerts(created_at desc);
create index if not exists os_docusign_archive_p51_alert_kind_idx
  on public.os_docusign_archive_phase51_ops_alerts(alert_kind, created_at desc);

alter table public.os_docusign_archive_phase51_ops_alerts
  enable row level security;
drop policy if exists "os_docusign_archive_p51_alert_select"
  on public.os_docusign_archive_phase51_ops_alerts;
create policy "os_docusign_archive_p51_alert_select"
  on public.os_docusign_archive_phase51_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_phase51_ops_alerts
  from public, anon, authenticated;
grant select on public.os_docusign_archive_phase51_ops_alerts
  to authenticated;

create or replace function public.reject_docusign_phase51_ops_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Phase 51 DocuSign archive ops evidence is append-only';
end;
$$;

drop trigger if exists os_docusign_archive_p51_rollup_immutable
  on public.os_docusign_archive_phase51_cadence_rollups;
create trigger os_docusign_archive_p51_rollup_immutable
  before update or delete on public.os_docusign_archive_phase51_cadence_rollups
  for each row execute function public.reject_docusign_phase51_ops_mutation();
drop trigger if exists os_docusign_archive_p51_rollup_no_truncate
  on public.os_docusign_archive_phase51_cadence_rollups;
create trigger os_docusign_archive_p51_rollup_no_truncate
  before truncate on public.os_docusign_archive_phase51_cadence_rollups
  for each statement execute function public.reject_docusign_phase51_ops_mutation();

drop trigger if exists os_docusign_archive_p51_escalation_immutable
  on public.os_docusign_archive_third_approver_escalations;
create trigger os_docusign_archive_p51_escalation_immutable
  before update or delete on public.os_docusign_archive_third_approver_escalations
  for each row execute function public.reject_docusign_phase51_ops_mutation();
drop trigger if exists os_docusign_archive_p51_escalation_no_truncate
  on public.os_docusign_archive_third_approver_escalations;
create trigger os_docusign_archive_p51_escalation_no_truncate
  before truncate on public.os_docusign_archive_third_approver_escalations
  for each statement execute function public.reject_docusign_phase51_ops_mutation();

drop trigger if exists os_docusign_archive_p51_alert_immutable
  on public.os_docusign_archive_phase51_ops_alerts;
create trigger os_docusign_archive_p51_alert_immutable
  before update or delete on public.os_docusign_archive_phase51_ops_alerts
  for each row execute function public.reject_docusign_phase51_ops_mutation();
drop trigger if exists os_docusign_archive_p51_alert_no_truncate
  on public.os_docusign_archive_phase51_ops_alerts;
create trigger os_docusign_archive_p51_alert_no_truncate
  before truncate on public.os_docusign_archive_phase51_ops_alerts
  for each statement execute function public.reject_docusign_phase51_ops_mutation();

-- ---------------------------------------------------------------------------
-- Record a firm-wide cadence trend rollup across the last p_snapshots Phase
-- 50 cadence trend snapshots (i.e. across quarters). Read + append-only.
-- Never creates/voids/resends envelopes.
-- ---------------------------------------------------------------------------
create or replace function public.record_docusign_cadence_rollup_phase51(
  p_metadata jsonb default '{}'::jsonb,
  p_snapshots integer default 8
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_snapshots integer := least(greatest(coalesce(p_snapshots, 8), 1), 24);
  v_min numeric;
  v_max numeric;
  v_avg numeric;
  v_compared integer := 0;
  v_improving_streak integer := 0;
  v_declining_streak integer := 0;
  v_improving_total integer := 0;
  v_declining_total integer := 0;
  v_overall text := 'unknown';
  v_key text;
  v_hash text;
  v_row public.os_docusign_archive_phase51_cadence_rollups%rowtype;
  v_rec record;
  v_counting_streak boolean := true;
begin
  if not public.phase51_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 51 cadence rollup metadata is invalid or unsafe';
  end if;

  select count(*), min(latest_on_time_rate), max(latest_on_time_rate),
    avg(latest_on_time_rate)
  into v_compared, v_min, v_max, v_avg
  from (
    select latest_on_time_rate
    from public.os_docusign_archive_cadence_trend_snapshots
    order by created_at desc
    limit v_snapshots
  ) s;

  v_compared := coalesce(v_compared, 0);

  for v_rec in
    select trend_direction from public.os_docusign_archive_cadence_trend_snapshots
    order by created_at desc
    limit v_snapshots
  loop
    if v_rec.trend_direction = 'improving' then
      v_improving_total := v_improving_total + 1;
    elsif v_rec.trend_direction = 'declining' then
      v_declining_total := v_declining_total + 1;
    end if;

    if v_counting_streak and v_rec.trend_direction = 'improving' then
      v_improving_streak := v_improving_streak + 1;
    elsif v_counting_streak and v_rec.trend_direction = 'declining' then
      v_declining_streak := v_declining_streak + 1;
      v_counting_streak := false;
    else
      v_counting_streak := false;
    end if;
  end loop;

  if v_compared = 0 then
    v_overall := 'unknown';
  elsif v_declining_streak >= 2 then
    v_overall := 'declining';
  elsif v_improving_streak >= 2 then
    v_overall := 'improving';
  elsif v_improving_total = v_declining_total then
    v_overall := 'mixed';
  elsif v_improving_total > v_declining_total then
    v_overall := 'improving';
  else
    v_overall := 'declining';
  end if;

  v_key := left(
    'cadencerollup51:firm:' || to_char(now(),'YYYYMMDD"T"HH24'),
    200);
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase51-v1',
    'kind','cadence_trend_rollup',
    'snapshots_compared',v_compared,
    'min_on_time_rate',v_min,
    'max_on_time_rate',v_max,
    'avg_on_time_rate',v_avg,
    'improving_streak',v_improving_streak,
    'declining_streak',v_declining_streak,
    'overall_trend',v_overall
  )::text);

  insert into public.os_docusign_archive_phase51_cadence_rollups(
    rollup_key,snapshots_compared,min_on_time_rate,max_on_time_rate,
    avg_on_time_rate,improving_streak,declining_streak,overall_trend,
    metrics_sha256,metadata)
  values (
    v_key,greatest(v_compared,1),v_min,v_max,v_avg,v_improving_streak,
    v_declining_streak,v_overall,v_hash,
    v_meta || jsonb_build_object('contract_version','phase51-v1'))
  on conflict (rollup_key) do nothing
  returning * into v_row;

  if v_row.rollup_id is null then
    select * into v_row
    from public.os_docusign_archive_phase51_cadence_rollups
    where rollup_key = v_key;
    return jsonb_build_object(
      'version','phase51-v1',
      'disposition','unchanged',
      'rollup_id',v_row.rollup_id,
      'overall_trend',v_row.overall_trend,
      'snapshots_compared',v_row.snapshots_compared,
      'metrics_sha256',v_row.metrics_sha256);
  end if;

  return jsonb_build_object(
    'version','phase51-v1',
    'disposition','recorded',
    'rollup_id',v_row.rollup_id,
    'overall_trend',v_row.overall_trend,
    'min_on_time_rate',v_row.min_on_time_rate,
    'max_on_time_rate',v_row.max_on_time_rate,
    'avg_on_time_rate',v_row.avg_on_time_rate,
    'snapshots_compared',v_row.snapshots_compared,
    'metrics_sha256',v_row.metrics_sha256);
end;
$$;

-- ---------------------------------------------------------------------------
-- List budget revision proposals eligible for third-approver escalation:
-- still exactly 1 distinct 'approve' decision, and the earliest Phase 50
-- second-approver reminder for that proposal was sent at least
-- p_threshold_days ago. Never activates or approves anything. Also surfaces
-- a declining cadence rollup alert.
-- ---------------------------------------------------------------------------
create or replace function public.list_docusign_archive_phase51_critical_windows(
  p_window_hours integer default 24,
  p_escalation_threshold_days integer default 3
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_hours integer := least(greatest(coalesce(p_window_hours, 24), 1), 168);
  v_threshold_days integer := least(greatest(coalesce(p_escalation_threshold_days, 3), 1), 30);
  v_bucket text;
  v_pending jsonb := '[]'::jsonb;
  v_proposal record;
  v_rollup public.os_docusign_archive_phase51_cadence_rollups%rowtype;
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
      count(distinct a.actor_id) filter (where a.decision='approve') as distinct_approvers,
      min(r.created_at) as first_reminder_at
    from public.os_docusign_archive_budget_revision_proposals p
    left join public.os_docusign_archive_budget_revision_approvals a
      on a.proposal_id = p.proposal_id
    join public.os_docusign_archive_second_approver_reminders r
      on r.proposal_id = p.proposal_id
    where p.status = 'proposed'
      and not exists (
        select 1 from public.os_docusign_archive_budget_revision_proposals x
        where x.source_proposal_id = p.proposal_id
      )
    group by p.proposal_id, p.budget_key
    having count(distinct a.actor_id) filter (where a.decision='approve') = 1
      and min(r.created_at) <= now() - make_interval(days => v_threshold_days)
    order by p.proposal_id
    limit 25
  loop
    v_key := 'thirdapprescalation51:' || v_proposal.proposal_id::text || ':' || v_bucket || 'h' || v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase51_ops_alerts a
      where a.window_key = v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','third_approver_escalation_raised',
        'window_key',v_key,
        'severity','critical',
        'proposal_id',v_proposal.proposal_id,
        'budget_key',v_proposal.budget_key,
        'distinct_approvers',v_proposal.distinct_approvers,
        'days_since_first_reminder',
          floor(extract(epoch from (now()-v_proposal.first_reminder_at))/86400)::integer
      ));
    end if;
  end loop;

  select * into v_rollup
  from public.os_docusign_archive_phase51_cadence_rollups
  order by created_at desc
  limit 1;

  if v_rollup.rollup_id is not null and v_rollup.overall_trend = 'declining' then
    v_key := 'cadencerollupdecline51:firm:' || v_bucket || 'h' || v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase51_ops_alerts a
      where a.window_key = v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','cadence_rollup_declining',
        'window_key',v_key,
        'severity','warning',
        'rollup_id',v_rollup.rollup_id,
        'metrics_sha256',v_rollup.metrics_sha256
      ));
    end if;
  end if;

  return jsonb_build_object(
    'version','phase51-v1',
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'escalation_threshold_days',v_threshold_days,
    'pending',v_pending
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record a third-approver escalation receipt (idempotent window_key). Never
-- activates or approves.
-- ---------------------------------------------------------------------------
create or replace function public.record_docusign_third_approver_escalation_phase51(
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
  v_days integer;
  v_dest text;
  v_delivery text;
  v_code integer;
  v_hash text;
  v_meta jsonb;
  v_id uuid;
  v_status text;
begin
  if jsonb_typeof(coalesce(p_alert,'{}'::jsonb)) <> 'object' then
    raise exception 'Phase 51 third-approver escalation payload must be a JSON object';
  end if;

  v_proposal_id := nullif(p_alert->>'proposal_id','')::uuid;
  v_window := coalesce(p_alert->>'window_key','');
  v_distinct := coalesce((p_alert->>'distinct_approvers')::integer,1);
  v_days := coalesce((p_alert->>'days_since_first_reminder')::integer,0);
  v_dest := coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery := coalesce(p_alert->>'delivery_status','recorded');
  v_code := nullif(p_alert->>'response_code','')::integer;
  v_meta := coalesce(p_alert->'metadata','{}'::jsonb);

  if v_proposal_id is null
     or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or v_distinct not between 0 and 1
     or v_days < 0
     or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
     or v_dest ~* '://|^https?'
     or v_delivery not in
       ('delivered','skipped_no_webhook','failed','recorded')
     or not public.phase51_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 51 third-approver escalation contract is invalid or unsafe';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase51-v1',
    'proposal_id',v_proposal_id,
    'window_key',v_window,
    'distinct_approvers',v_distinct,
    'days_since_first_reminder',v_days,
    'destination_key',v_dest,
    'delivery_status',v_delivery,
    'response_code',v_code
  )::text);

  insert into public.os_docusign_archive_third_approver_escalations(
    proposal_id,window_key,distinct_approvers,days_since_first_reminder,
    destination_key,delivery_status,response_code,metrics_sha256,metadata)
  values (
    v_proposal_id,v_window,v_distinct,v_days,v_dest,v_delivery,v_code,v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase51-v1','never_activates',true))
  on conflict (window_key) do nothing
  returning escalation_id, delivery_status into v_id, v_status;

  if v_id is null then
    select escalation_id, delivery_status into v_id, v_status
    from public.os_docusign_archive_third_approver_escalations
    where window_key = v_window;
    return jsonb_build_object(
      'version','phase51-v1',
      'escalation_id',v_id,
      'window_key',v_window,
      'delivery_status',v_status,
      'inserted',false,
      'never_activates',true);
  end if;

  return jsonb_build_object(
    'version','phase51-v1',
    'escalation_id',v_id,
    'window_key',v_window,
    'delivery_status',v_status,
    'inserted',true,
    'never_activates',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Record one warning/critical ops alert after delivery attempt (idempotent
-- window_key). Currently used for cadence_rollup_declining.
-- ---------------------------------------------------------------------------
create or replace function public.record_docusign_archive_phase51_ops_alert(
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
    raise exception 'Phase 51 ops alert payload must be a JSON object';
  end if;

  v_kind := coalesce(p_alert->>'alert_kind','');
  v_window := coalesce(p_alert->>'window_key','');
  v_dest := coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery := coalesce(p_alert->>'delivery_status','recorded');
  v_code := nullif(p_alert->>'response_code','')::integer;
  v_severity := coalesce(nullif(p_alert->>'severity',''),'warning');
  v_meta := coalesce(p_alert->'metadata','{}'::jsonb);

  if v_kind not in ('cadence_rollup_declining','third_approver_escalation_raised')
     or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
     or v_dest ~* '://|^https?'
     or v_severity not in ('warning','critical')
     or v_delivery not in
       ('delivered','skipped_no_webhook','failed','recorded')
     or not public.phase51_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 51 ops alert contract is invalid or unsafe';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase51-v1',
    'alert_kind',v_kind,
    'window_key',v_window,
    'severity',v_severity,
    'destination_key',v_dest,
    'delivery_status',v_delivery,
    'response_code',v_code
  )::text);

  insert into public.os_docusign_archive_phase51_ops_alerts(
    alert_kind,window_key,severity,destination_key,
    delivery_status,response_code,metrics_sha256,metadata)
  values (
    v_kind,v_window,v_severity,v_dest,
    v_delivery,v_code,v_hash,
    v_meta || jsonb_build_object('contract_version','phase51-v1'))
  on conflict (window_key) do nothing
  returning alert_id, delivery_status into v_id, v_status;

  if v_id is null then
    select alert_id, delivery_status into v_id, v_status
    from public.os_docusign_archive_phase51_ops_alerts
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
-- Hub report: firm-wide cadence rollup + pending budget proposal and
-- third-approver escalation visibility (read-only over Phase 49/50 evidence)
-- ---------------------------------------------------------------------------
create or replace function public.get_docusign_archive_phase51_ops_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rollup public.os_docusign_archive_phase51_cadence_rollups%rowtype;
  v_pending_proposals jsonb;
  v_escalations_7d integer := 0;
  v_pending_escalatable integer := 0;
  v_alerts jsonb;
begin
  select * into v_rollup
  from public.os_docusign_archive_phase51_cadence_rollups
  order by created_at desc
  limit 1;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc), '[]'::jsonb)
  into v_pending_proposals
  from (
    select p.proposal_id, p.budget_key, p.status, p.created_at,
      coalesce(count(distinct a.actor_id) filter (where a.decision='approve'),0)
        as distinct_approvers
    from public.os_docusign_archive_budget_revision_proposals p
    left join public.os_docusign_archive_budget_revision_approvals a
      on a.proposal_id = p.proposal_id
    where p.status = 'proposed'
      and not exists (
        select 1 from public.os_docusign_archive_budget_revision_proposals x
        where x.source_proposal_id = p.proposal_id
      )
    group by p.proposal_id, p.budget_key, p.status, p.created_at
    order by p.created_at desc
    limit 25
  ) p;

  select count(*)::integer into v_escalations_7d
  from public.os_docusign_archive_third_approver_escalations
  where created_at >= now() - interval '7 days';

  select count(distinct p.proposal_id)::integer into v_pending_escalatable
  from public.os_docusign_archive_budget_revision_proposals p
  left join public.os_docusign_archive_budget_revision_approvals a
    on a.proposal_id = p.proposal_id
  join public.os_docusign_archive_second_approver_reminders r
    on r.proposal_id = p.proposal_id
  where p.status = 'proposed'
    and not exists (
      select 1 from public.os_docusign_archive_budget_revision_proposals x
      where x.source_proposal_id = p.proposal_id
    )
  group by p.proposal_id
  having count(distinct a.actor_id) filter (where a.decision='approve') = 1
    and min(r.created_at) <= now() - interval '3 days';

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
  into v_alerts
  from (
    select alert_id, alert_kind, window_key, severity, destination_key,
      delivery_status, response_code, metrics_sha256, created_at
    from public.os_docusign_archive_phase51_ops_alerts
    order by created_at desc
    limit 20
  ) a;

  return jsonb_build_object(
    'version','phase51-v1',
    'cadence_rollup_overall_trend',coalesce(v_rollup.overall_trend,'unknown'),
    'cadence_rollup_snapshots_compared',coalesce(v_rollup.snapshots_compared,0),
    'cadence_rollup_min_on_time_rate',v_rollup.min_on_time_rate,
    'cadence_rollup_max_on_time_rate',v_rollup.max_on_time_rate,
    'cadence_rollup_avg_on_time_rate',v_rollup.avg_on_time_rate,
    'pending_budget_proposals',coalesce(v_pending_proposals,'[]'::jsonb),
    'pending_third_approver_escalatable_count',coalesce(v_pending_escalatable,0),
    'third_approver_escalations_7d',v_escalations_7d,
    'alerts',coalesce(v_alerts,'[]'::jsonb),
    'destination_key','ops_alerts',
    'never_creates_voids_or_resends_envelopes',true,
    'never_auto_activates',true
  );
end;
$$;

revoke all on function public.phase51_docusign_ops_safe_metadata(jsonb)
  from public, anon, authenticated;
revoke all on function public.record_docusign_cadence_rollup_phase51(jsonb,integer)
  from public, anon, authenticated;
revoke all on function public.list_docusign_archive_phase51_critical_windows(integer,integer)
  from public, anon;
revoke all on function public.record_docusign_third_approver_escalation_phase51(jsonb)
  from public, anon, authenticated;
revoke all on function public.record_docusign_archive_phase51_ops_alert(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_docusign_archive_phase51_ops_report()
  from public, anon;

grant execute on function public.phase51_docusign_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.list_docusign_archive_phase51_critical_windows(integer,integer)
  to authenticated, service_role;
grant execute on function public.get_docusign_archive_phase51_ops_report()
  to authenticated, service_role;

grant execute on function public.record_docusign_cadence_rollup_phase51(jsonb,integer)
  to service_role;
grant execute on function public.record_docusign_third_approver_escalation_phase51(jsonb)
  to service_role;
grant execute on function public.record_docusign_archive_phase51_ops_alert(jsonb)
  to service_role;
grant execute on function public.os_sha256_hex(text)
  to authenticated, service_role;
