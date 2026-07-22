-- Phase 48: Intune MTTR↔scorecard → postmortem template suggestions
-- (append-only, never auto-publish), waive_expired paging, and waive
-- lifecycle visibility snapshots.
-- Apply after phase47_intune_resilience_ops.sql.
-- Observe-only against breaker state: never closes, resets, or mutates breakers.
-- Aggregates never include entity identifiers.

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

create or replace function public.it_intune_phase48_sanitize_aggregate(p_evidence jsonb)
returns jsonb
language sql immutable set search_path=public as $$
  select coalesce(p_evidence,'{}'::jsonb)
    - 'entity_id' - 'entity_ids' - 'entity_scope' - 'entity_scopes'
    || jsonb_build_object('entity_identifiers_included',false);
$$;

create or replace function public.it_intune_phase48_lifecycle_anomaly_expired_min()
returns integer
language sql
immutable
parallel safe
set search_path = public
as $$
  select 3;
$$;

-- ---------------------------------------------------------------------------
-- Append-only postmortem template suggestions (never auto-publish)
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_postmortem_template_suggestions (
  suggestion_id uuid primary key default gen_random_uuid(),
  postmortem_id uuid not null
    references public.os_it_intune_outage_postmortems(postmortem_id),
  scorecard_id uuid not null
    references public.os_it_intune_postmortem_quality_scorecards(scorecard_id),
  correlation_id uuid not null
    references public.os_it_intune_scorecard_mttr_correlations(correlation_id),
  suggested_fields jsonb not null,
  mttr_minutes integer not null,
  composite_score numeric(5,4) not null,
  status text not null default 'suggested',
  aggregate_evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null,
  bucket_key text,
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p48_tmpl_mttr_check
    check (mttr_minutes >= 0),
  constraint os_it_intune_p48_tmpl_score_check
    check (composite_score between 0 and 1),
  constraint os_it_intune_p48_tmpl_status_check
    check (status in ('suggested')),
  constraint os_it_intune_p48_tmpl_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_it_intune_p48_tmpl_bucket_check
    check (bucket_key is null
      or bucket_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$'),
  constraint os_it_intune_p48_tmpl_no_entity_leak check (
    not (suggested_fields ? 'entity_id')
    and not (suggested_fields ? 'entity_ids')
    and not (suggested_fields ? 'entity_scope')
    and not (suggested_fields ? 'entity_scopes')
    and coalesce((suggested_fields->>'entity_identifiers_included')::boolean,false)=false
    and not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  ),
  constraint os_it_intune_p48_tmpl_no_auto_publish check (
    coalesce((suggested_fields->>'auto_publish')::boolean,false)=false
  ),
  constraint os_it_intune_p48_tmpl_bucket_unique
    unique (correlation_id, bucket_key)
);

create index if not exists os_it_intune_p48_tmpl_pm_recorded_idx
  on public.os_it_intune_postmortem_template_suggestions(
    postmortem_id, recorded_at desc, suggestion_id desc);

alter table public.os_it_intune_postmortem_template_suggestions
  enable row level security;

drop policy if exists "os_it_intune_p48_tmpl_select"
  on public.os_it_intune_postmortem_template_suggestions;
create policy "os_it_intune_p48_tmpl_select"
  on public.os_it_intune_postmortem_template_suggestions for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_postmortem_template_suggestions to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_postmortem_template_suggestions
  from public,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Append-only waive lifecycle visibility snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_waive_lifecycle_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  proposed_count integer not null default 0,
  approved_count integer not null default 0,
  rejected_count integer not null default 0,
  expired_count integer not null default 0,
  extended_count integer not null default 0,
  expiry_pending_count integer not null default 0,
  expire_action_approved_count integer not null default 0,
  aggregate_evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null,
  bucket_key text not null,
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p48_life_counts_check
    check (
      proposed_count >= 0
      and approved_count >= 0
      and rejected_count >= 0
      and expired_count >= 0
      and extended_count >= 0
      and expiry_pending_count >= 0
      and expire_action_approved_count >= 0
    ),
  constraint os_it_intune_p48_life_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_it_intune_p48_life_bucket_check
    check (bucket_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$'),
  constraint os_it_intune_p48_life_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  ),
  constraint os_it_intune_p48_life_bucket_unique
    unique (bucket_key)
);

create index if not exists os_it_intune_p48_life_recorded_idx
  on public.os_it_intune_waive_lifecycle_snapshots(recorded_at desc);

alter table public.os_it_intune_waive_lifecycle_snapshots
  enable row level security;

drop policy if exists "os_it_intune_p48_life_select"
  on public.os_it_intune_waive_lifecycle_snapshots;
create policy "os_it_intune_p48_life_select"
  on public.os_it_intune_waive_lifecycle_snapshots for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_waive_lifecycle_snapshots to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_waive_lifecycle_snapshots
  from public,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Append-only Phase 48 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_phase48_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  alert_kind text not null,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null default 'warning',
  destination_key text not null default 'ops_alerts'
    check (destination_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  delivery_status text not null,
  response_code integer
    check (response_code is null or response_code between 100 and 599),
  recommendation_id uuid
    references public.os_it_intune_threshold_recommendation_drafts(recommendation_id),
  waive_proposal_id uuid
    references public.os_it_intune_promote_waive_proposals(proposal_id),
  postmortem_id uuid
    references public.os_it_intune_outage_postmortems(postmortem_id),
  suggestion_id uuid
    references public.os_it_intune_postmortem_template_suggestions(suggestion_id),
  snapshot_id uuid
    references public.os_it_intune_waive_lifecycle_snapshots(snapshot_id),
  aggregate_evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null,
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p48_alert_kind_check
    check (alert_kind in (
      'waive_expired_page',
      'template_suggestion_ready',
      'lifecycle_anomaly'
    )),
  constraint os_it_intune_p48_alert_severity_check
    check (severity in ('warning','critical')),
  constraint os_it_intune_p48_alert_delivery_check
    check (delivery_status in
      ('delivered','skipped_no_webhook','failed','recorded')),
  constraint os_it_intune_p48_alert_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_it_intune_p48_alert_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  )
);

create index if not exists os_it_intune_p48_alert_kind_recorded_idx
  on public.os_it_intune_phase48_ops_alerts(alert_kind, recorded_at desc);

alter table public.os_it_intune_phase48_ops_alerts
  enable row level security;

drop policy if exists "os_it_intune_p48_alert_select"
  on public.os_it_intune_phase48_ops_alerts;
create policy "os_it_intune_p48_alert_select"
  on public.os_it_intune_phase48_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_phase48_ops_alerts to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_phase48_ops_alerts
  from public,authenticated,service_role;

create or replace function public.prevent_it_intune_phase48_ops_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'Phase 48 Intune template/lifecycle evidence is append-only';
end;
$$;

drop trigger if exists os_it_intune_p48_tmpl_append_only
  on public.os_it_intune_postmortem_template_suggestions;
create trigger os_it_intune_p48_tmpl_append_only
  before update or delete
  on public.os_it_intune_postmortem_template_suggestions
  for each row execute function public.prevent_it_intune_phase48_ops_mutation();

drop trigger if exists os_it_intune_p48_tmpl_no_truncate
  on public.os_it_intune_postmortem_template_suggestions;
create trigger os_it_intune_p48_tmpl_no_truncate
  before truncate
  on public.os_it_intune_postmortem_template_suggestions
  for each statement execute function public.prevent_it_intune_phase48_ops_mutation();

drop trigger if exists os_it_intune_p48_life_append_only
  on public.os_it_intune_waive_lifecycle_snapshots;
create trigger os_it_intune_p48_life_append_only
  before update or delete
  on public.os_it_intune_waive_lifecycle_snapshots
  for each row execute function public.prevent_it_intune_phase48_ops_mutation();

drop trigger if exists os_it_intune_p48_life_no_truncate
  on public.os_it_intune_waive_lifecycle_snapshots;
create trigger os_it_intune_p48_life_no_truncate
  before truncate
  on public.os_it_intune_waive_lifecycle_snapshots
  for each statement execute function public.prevent_it_intune_phase48_ops_mutation();

drop trigger if exists os_it_intune_p48_alert_append_only
  on public.os_it_intune_phase48_ops_alerts;
create trigger os_it_intune_p48_alert_append_only
  before update or delete
  on public.os_it_intune_phase48_ops_alerts
  for each row execute function public.prevent_it_intune_phase48_ops_mutation();

drop trigger if exists os_it_intune_p48_alert_no_truncate
  on public.os_it_intune_phase48_ops_alerts;
create trigger os_it_intune_p48_alert_no_truncate
  before truncate
  on public.os_it_intune_phase48_ops_alerts
  for each statement execute function public.prevent_it_intune_phase48_ops_mutation();

-- ---------------------------------------------------------------------------
-- Suggest postmortem template fields from MTTR↔scorecard correlations
-- ---------------------------------------------------------------------------
create or replace function public.suggest_it_intune_postmortem_template_phase48()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_corr record;
  v_pm public.os_it_intune_outage_postmortems%rowtype;
  v_bucket text;
  v_fields jsonb;
  v_evidence jsonb;
  v_hash text;
  v_recorded integer:=0;
  v_skipped integer:=0;
  v_mismatch_threshold numeric:=public.it_intune_phase47_mttr_mismatch_threshold();
  v_mismatch boolean;
  v_hint text;
  v_notes text;
begin
  -- Template suggestions never update breaker rows and never call reset/close RPCs.
  -- Never auto-publish postmortems — append-only suggestions for human review.
  v_bucket:=to_char(date_trunc('hour',now()),'YYYYMMDD"T"HH24');

  for v_corr in
    select c.correlation_id,c.postmortem_id,c.scorecard_id,
      c.cycle_elapsed_minutes,c.composite_score,c.correlation_delta,
      c.recorded_at
    from public.os_it_intune_scorecard_mttr_correlations c
    order by c.recorded_at desc, c.correlation_id desc
    limit 100
  loop
    if exists (
      select 1 from public.os_it_intune_postmortem_template_suggestions s
      where s.correlation_id=v_corr.correlation_id
        and s.bucket_key=v_bucket
    ) then
      v_skipped:=v_skipped+1;
      continue;
    end if;

    select * into v_pm
    from public.os_it_intune_outage_postmortems
    where postmortem_id=v_corr.postmortem_id;
    if not found then
      v_skipped:=v_skipped+1;
      continue;
    end if;

    -- Only suggest for drafts — published postmortems stay human-owned.
    if v_pm.status<>'draft' then
      v_skipped:=v_skipped+1;
      continue;
    end if;

    v_mismatch:=abs(v_corr.correlation_delta) >= v_mismatch_threshold;
    if v_mismatch then
      v_hint:='review_mttr_scorecard_mismatch';
      v_notes:='Soak-cycle MTTR '||v_corr.cycle_elapsed_minutes::text
        ||'m misaligns with composite score '
        ||to_char(v_corr.composite_score,'FM0.0000')
        ||' (delta '||to_char(v_corr.correlation_delta,'SFM0.0000')
        ||'). Review recovery narrative before publish.';
    else
      v_hint:='mttr_scorecard_aligned';
      v_notes:='Soak-cycle MTTR '||v_corr.cycle_elapsed_minutes::text
        ||'m aligns with composite score '
        ||to_char(v_corr.composite_score,'FM0.0000')
        ||'. Consider citing recovery timing in blameless notes.';
    end if;

    v_fields:=public.it_intune_phase48_sanitize_aggregate(jsonb_build_object(
      'evidence_version','phase48-v1',
      'suggestion_kind','postmortem_template',
      'suggested_root_cause_hint',v_hint,
      'suggested_notes_fragment',v_notes,
      'mttr_minutes',v_corr.cycle_elapsed_minutes,
      'composite_score',v_corr.composite_score,
      'correlation_delta',v_corr.correlation_delta,
      'mismatch',v_mismatch,
      'postmortem_status',v_pm.status,
      'auto_publish',false,
      'requires_human_publish',true,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    ));

    v_evidence:=public.it_intune_phase48_sanitize_aggregate(jsonb_build_object(
      'evidence_version','phase48-v1',
      'review_kind','postmortem_template_suggestion',
      'postmortem_id',v_corr.postmortem_id,
      'scorecard_id',v_corr.scorecard_id,
      'correlation_id',v_corr.correlation_id,
      'mttr_minutes',v_corr.cycle_elapsed_minutes,
      'composite_score',v_corr.composite_score,
      'correlation_delta',v_corr.correlation_delta,
      'bucket_key',v_bucket,
      'auto_publish',false,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    ));
    v_hash:=public.os_sha256_hex(v_evidence::text);

    insert into public.os_it_intune_postmortem_template_suggestions(
      postmortem_id,scorecard_id,correlation_id,suggested_fields,
      mttr_minutes,composite_score,status,aggregate_evidence,
      evidence_sha256,bucket_key
    ) values (
      v_corr.postmortem_id,v_corr.scorecard_id,v_corr.correlation_id,v_fields,
      v_corr.cycle_elapsed_minutes,v_corr.composite_score,'suggested',v_evidence,
      v_hash,v_bucket
    );
    v_recorded:=v_recorded+1;
  end loop;

  return jsonb_build_object(
    'suggestions_recorded',v_recorded,
    'skipped',v_skipped,
    'bucket_key',v_bucket,
    'auto_publish',false,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record waive lifecycle visibility snapshot
-- ---------------------------------------------------------------------------
create or replace function public.record_it_intune_waive_lifecycle_snapshot_phase48()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_bucket text;
  v_proposed integer:=0;
  v_approved integer:=0;
  v_rejected integer:=0;
  v_expired integer:=0;
  v_extended integer:=0;
  v_expiry_pending integer:=0;
  v_expire_approved integer:=0;
  v_evidence jsonb;
  v_hash text;
  v_id uuid;
  v_anomaly boolean:=false;
  v_anomaly_min integer:=public.it_intune_phase48_lifecycle_anomaly_expired_min();
begin
  -- Lifecycle snapshots never update breaker rows and never call reset/close RPCs.
  -- Tick approved-waive expiry via Phase 47 helper (observe-only on breakers).
  perform public.expire_it_intune_promote_waive_approved_phase47();

  v_bucket:=to_char(date_trunc('hour',now()),'YYYYMMDD"T"HH24');

  if exists (
    select 1 from public.os_it_intune_waive_lifecycle_snapshots s
    where s.bucket_key=v_bucket
  ) then
    select snapshot_id into v_id
    from public.os_it_intune_waive_lifecycle_snapshots
    where bucket_key=v_bucket;
    return jsonb_build_object(
      'inserted',false,
      'snapshot_id',v_id,
      'bucket_key',v_bucket,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    );
  end if;

  select count(*) into v_proposed
  from public.os_it_intune_promote_waive_proposals where status='proposed';
  select count(*) into v_approved
  from public.os_it_intune_promote_waive_proposals where status='approved';
  select count(*) into v_rejected
  from public.os_it_intune_promote_waive_proposals where status='rejected';
  select count(*) into v_expired
  from public.os_it_intune_promote_waive_proposals
  where status='expired' and expires_at>=now()-interval '7 days';
  select count(*) into v_extended
  from public.os_it_intune_promote_waive_expiry_proposals
  where status='approved' and action='extend';
  select count(*) into v_expiry_pending
  from public.os_it_intune_promote_waive_expiry_proposals where status='proposed';
  select count(*) into v_expire_approved
  from public.os_it_intune_promote_waive_expiry_proposals
  where status='approved' and action='expire';

  v_anomaly:=v_expired >= v_anomaly_min and v_extended=0;

  v_evidence:=public.it_intune_phase48_sanitize_aggregate(jsonb_build_object(
    'evidence_version','phase48-v1',
    'review_kind','waive_lifecycle_snapshot',
    'proposed_count',v_proposed,
    'approved_count',v_approved,
    'rejected_count',v_rejected,
    'expired_count',v_expired,
    'extended_count',v_extended,
    'expiry_pending_count',v_expiry_pending,
    'expire_action_approved_count',v_expire_approved,
    'lifecycle_anomaly',v_anomaly,
    'bucket_key',v_bucket,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  ));
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_it_intune_waive_lifecycle_snapshots(
    proposed_count,approved_count,rejected_count,expired_count,
    extended_count,expiry_pending_count,expire_action_approved_count,
    aggregate_evidence,evidence_sha256,bucket_key
  ) values (
    v_proposed,v_approved,v_rejected,v_expired,
    v_extended,v_expiry_pending,v_expire_approved,
    v_evidence,v_hash,v_bucket
  ) returning snapshot_id into v_id;

  return jsonb_build_object(
    'inserted',true,
    'snapshot_id',v_id,
    'bucket_key',v_bucket,
    'proposed_count',v_proposed,
    'approved_count',v_approved,
    'rejected_count',v_rejected,
    'expired_count',v_expired,
    'extended_count',v_extended,
    'expiry_pending_count',v_expiry_pending,
    'expire_action_approved_count',v_expire_approved,
    'lifecycle_anomaly',v_anomaly,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Critical windows + alert recording (paging-oriented waive_expired_page)
-- ---------------------------------------------------------------------------
create or replace function public.list_it_intune_phase48_critical_windows(
  p_window_hours integer default 24)
returns jsonb
language plpgsql
security definer
set search_path=public as $$
declare
  v_hours integer:=least(greatest(coalesce(p_window_hours,24),1),168);
  v_bucket text;
  v_pending jsonb:='[]'::jsonb;
  v_part jsonb;
  v_anomaly_min integer:=public.it_intune_phase48_lifecycle_anomaly_expired_min();
begin
  -- Critical window listing never updates breaker rows / reset/close RPCs.
  perform public.expire_it_intune_promote_waive_approved_phase47();

  v_bucket:=to_char(
    to_timestamp(
      (floor(extract(epoch from now())/(v_hours*3600.0))
        *(v_hours*3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  -- Page on dual-approved waives that expired without a dual-approved extend.
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','waive_expired_page',
      'window_key','waivepg:'||w.proposal_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','critical',
      'recommendation_id',w.recommendation_id,
      'waive_proposal_id',w.proposal_id
    ) order by w.expires_at desc)
    from public.os_it_intune_promote_waive_proposals w
    where w.status='expired'
      and w.expires_at>=now()-make_interval(hours => v_hours)
      and exists (
        select 1 from public.os_it_intune_promote_waive_decisions d
        where d.waive_proposal_id=w.proposal_id
          and d.decision='approved'
          and d.decided_by<>w.proposed_by
      )
      and not exists (
        select 1 from public.os_it_intune_promote_waive_expiry_proposals e
        join public.os_it_intune_promote_waive_expiry_decisions xd
          on xd.expiry_proposal_id=e.expiry_proposal_id
        where e.waive_proposal_id=w.proposal_id
          and e.action='extend'
          and e.status='approved'
          and xd.decision='approved'
          and xd.decided_by<>e.proposed_by
          and e.new_expires_at > w.expires_at
      )
      and not exists (
        select 1 from public.os_it_intune_phase48_ops_alerts x
        where x.window_key=
          'waivepg:'||w.proposal_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 25
  ), '[]'::jsonb) into v_part;
  v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','template_suggestion_ready',
      'window_key','tmplrdy:'||s.suggestion_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','warning',
      'postmortem_id',s.postmortem_id,
      'suggestion_id',s.suggestion_id
    ) order by s.recorded_at desc)
    from public.os_it_intune_postmortem_template_suggestions s
    where s.recorded_at>=now()-make_interval(hours => v_hours)
      and s.status='suggested'
      and coalesce((s.suggested_fields->>'mismatch')::boolean,false)=true
      and not exists (
        select 1 from public.os_it_intune_phase48_ops_alerts x
        where x.window_key=
          'tmplrdy:'||s.suggestion_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 25
  ), '[]'::jsonb) into v_part;
  v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','lifecycle_anomaly',
      'window_key','lifeano:'||ls.snapshot_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','warning',
      'snapshot_id',ls.snapshot_id,
      'expired_count',ls.expired_count,
      'extended_count',ls.extended_count
    ) order by ls.recorded_at desc)
    from public.os_it_intune_waive_lifecycle_snapshots ls
    where ls.recorded_at>=now()-make_interval(hours => v_hours)
      and ls.expired_count >= v_anomaly_min
      and ls.extended_count = 0
      and not exists (
        select 1 from public.os_it_intune_phase48_ops_alerts x
        where x.window_key=
          'lifeano:'||ls.snapshot_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 10
  ), '[]'::jsonb) into v_part;
  v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);

  return jsonb_build_object(
    'version','phase48-v1',
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',coalesce(v_pending,'[]'::jsonb),
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

create or replace function public.record_it_intune_phase48_ops_alert(p_alert jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_kind text;
  v_window text;
  v_dest text;
  v_delivery text;
  v_code integer;
  v_severity text;
  v_reco uuid;
  v_waive uuid;
  v_pm uuid;
  v_sug uuid;
  v_snap uuid;
  v_evidence jsonb;
  v_hash text;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_alert,'{}'::jsonb))<>'object' then
    raise exception 'Phase 48 ops alert payload must be a JSON object';
  end if;

  v_kind:=coalesce(p_alert->>'alert_kind','');
  v_window:=coalesce(p_alert->>'window_key','');
  v_dest:=coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery:=coalesce(p_alert->>'delivery_status','recorded');
  v_code:=nullif(p_alert->>'response_code','')::integer;
  v_severity:=coalesce(nullif(p_alert->>'severity',''),'warning');
  v_reco:=nullif(p_alert->>'recommendation_id','')::uuid;
  v_waive:=nullif(p_alert->>'waive_proposal_id','')::uuid;
  v_pm:=nullif(p_alert->>'postmortem_id','')::uuid;
  v_sug:=nullif(p_alert->>'suggestion_id','')::uuid;
  v_snap:=nullif(p_alert->>'snapshot_id','')::uuid;

  if v_kind not in (
      'waive_expired_page','template_suggestion_ready','lifecycle_anomaly')
    or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
    or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
    or v_delivery not in
      ('delivered','skipped_no_webhook','failed','recorded')
    or v_severity not in ('warning','critical') then
    raise exception 'Phase 48 ops alert contract is invalid';
  end if;

  v_evidence:=public.it_intune_phase48_sanitize_aggregate(
    coalesce(p_alert->'aggregate_evidence','{}'::jsonb)
    || jsonb_build_object(
      'evidence_version','phase48-v1',
      'alert_kind',v_kind,
      'window_key',v_window,
      'severity',v_severity,
      'destination_key',v_dest,
      'delivery_status',v_delivery,
      'response_code',v_code,
      'recommendation_id',v_reco,
      'waive_proposal_id',v_waive,
      'postmortem_id',v_pm,
      'suggestion_id',v_sug,
      'snapshot_id',v_snap,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    )
  );
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_it_intune_phase48_ops_alerts(
    alert_kind,window_key,severity,destination_key,delivery_status,
    response_code,recommendation_id,waive_proposal_id,postmortem_id,
    suggestion_id,snapshot_id,aggregate_evidence,evidence_sha256
  ) values (
    v_kind,v_window,v_severity,v_dest,v_delivery,v_code,
    v_reco,v_waive,v_pm,v_sug,v_snap,v_evidence,v_hash
  )
  on conflict (window_key) do nothing
  returning alert_id into v_id;

  if v_id is null then
    select alert_id into v_id
    from public.os_it_intune_phase48_ops_alerts
    where window_key=v_window;
    return jsonb_build_object(
      'inserted',false,
      'alert_id',v_id,
      'window_key',v_window,
      'closes_or_resets_breaker',false
    );
  end if;

  return jsonb_build_object(
    'inserted',true,
    'alert_id',v_id,
    'window_key',v_window,
    'closes_or_resets_breaker',false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Views + ops report
-- ---------------------------------------------------------------------------
create or replace view public.os_it_intune_phase48_health
with (security_invoker=true) as
select
  (select count(*) from public.os_it_intune_postmortem_template_suggestions)
    as template_suggestion_count,
  (select count(*) from public.os_it_intune_postmortem_template_suggestions
    where recorded_at>=now()-interval '7 days'
      and coalesce((suggested_fields->>'mismatch')::boolean,false)=true)
    as template_mismatch_suggestions_7d,
  (select count(*) from public.os_it_intune_waive_lifecycle_snapshots)
    as lifecycle_snapshot_count,
  (select coalesce(max(expired_count),0)
    from public.os_it_intune_waive_lifecycle_snapshots
    where recorded_at>=now()-interval '24 hours') as lifecycle_expired_latest,
  (select coalesce(max(extended_count),0)
    from public.os_it_intune_waive_lifecycle_snapshots
    where recorded_at>=now()-interval '24 hours') as lifecycle_extended_latest,
  (select coalesce(max(proposed_count),0)
    from public.os_it_intune_waive_lifecycle_snapshots
    where recorded_at>=now()-interval '24 hours') as lifecycle_proposed_latest,
  (select coalesce(max(approved_count),0)
    from public.os_it_intune_waive_lifecycle_snapshots
    where recorded_at>=now()-interval '24 hours') as lifecycle_approved_latest,
  (select count(*) from public.os_it_intune_phase48_ops_alerts
    where alert_kind='waive_expired_page') as waive_expired_page_count,
  (select count(*) from public.os_it_intune_phase48_ops_alerts
    where alert_kind='waive_expired_page'
      and delivery_status='delivered') as waive_expired_pages_delivered,
  (select count(*) from public.os_it_intune_phase48_ops_alerts)
    as ops_alert_count,
  (select count(*) from public.os_it_intune_phase48_ops_alerts
    where delivery_status='delivered') as alerts_delivered_count,
  (select count(*) from public.os_it_intune_phase48_ops_alerts
    where delivery_status in ('failed','skipped_no_webhook'))
    as alerts_undelivered_count;
grant select on public.os_it_intune_phase48_health to authenticated;

create or replace view public.os_it_intune_postmortem_template_suggestion_status
with (security_invoker=true) as
select distinct on (s.postmortem_id)
  s.suggestion_id,s.postmortem_id,s.scorecard_id,s.correlation_id,
  s.suggested_fields,s.mttr_minutes,s.composite_score,s.status,
  s.evidence_sha256,s.recorded_at,
  p.status as postmortem_status,p.root_cause_class
from public.os_it_intune_postmortem_template_suggestions s
join public.os_it_intune_outage_postmortems p
  on p.postmortem_id=s.postmortem_id
order by s.postmortem_id, s.recorded_at desc, s.suggestion_id desc;
grant select on public.os_it_intune_postmortem_template_suggestion_status
  to authenticated;

create or replace view public.os_it_intune_waive_lifecycle_status
with (security_invoker=true) as
select
  ls.snapshot_id,ls.proposed_count,ls.approved_count,ls.rejected_count,
  ls.expired_count,ls.extended_count,ls.expiry_pending_count,
  ls.expire_action_approved_count,ls.aggregate_evidence,ls.evidence_sha256,
  ls.bucket_key,ls.recorded_at
from public.os_it_intune_waive_lifecycle_snapshots ls
order by ls.recorded_at desc, ls.snapshot_id desc
limit 1;
grant select on public.os_it_intune_waive_lifecycle_status to authenticated;

create or replace function public.get_it_intune_phase48_ops_report()
returns jsonb
language plpgsql
stable
security definer
set search_path=public as $$
declare
  v_health jsonb;
  v_suggestions jsonb;
  v_lifecycle jsonb;
  v_alerts jsonb;
begin
  select jsonb_build_object(
    'template_suggestion_count',template_suggestion_count,
    'template_mismatch_suggestions_7d',template_mismatch_suggestions_7d,
    'lifecycle_snapshot_count',lifecycle_snapshot_count,
    'lifecycle_expired_latest',lifecycle_expired_latest,
    'lifecycle_extended_latest',lifecycle_extended_latest,
    'lifecycle_proposed_latest',lifecycle_proposed_latest,
    'lifecycle_approved_latest',lifecycle_approved_latest,
    'waive_expired_page_count',waive_expired_page_count,
    'waive_expired_pages_delivered',waive_expired_pages_delivered,
    'ops_alert_count',ops_alert_count,
    'alerts_delivered_count',alerts_delivered_count,
    'alerts_undelivered_count',alerts_undelivered_count,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  ) into v_health
  from public.os_it_intune_phase48_health;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_suggestions
  from (
    select s.suggestion_id,s.postmortem_id,s.scorecard_id,s.correlation_id,
      s.mttr_minutes,s.composite_score,s.status,s.evidence_sha256,s.recorded_at
    from public.os_it_intune_postmortem_template_suggestions s
    order by s.recorded_at desc
    limit 50
  ) x;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_lifecycle
  from (
    select ls.snapshot_id,ls.proposed_count,ls.approved_count,ls.rejected_count,
      ls.expired_count,ls.extended_count,ls.expiry_pending_count,
      ls.expire_action_approved_count,ls.evidence_sha256,ls.bucket_key,
      ls.recorded_at
    from public.os_it_intune_waive_lifecycle_snapshots ls
    order by ls.recorded_at desc
    limit 50
  ) x;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_alerts
  from (
    select a.alert_id,a.alert_kind,a.window_key,a.severity,a.destination_key,
      a.delivery_status,a.response_code,a.recommendation_id,
      a.waive_proposal_id,a.postmortem_id,a.suggestion_id,a.snapshot_id,
      a.evidence_sha256,a.recorded_at
    from public.os_it_intune_phase48_ops_alerts a
    order by a.recorded_at desc
    limit 50
  ) x;

  return coalesce(v_health,'{}'::jsonb) || jsonb_build_object(
    'version','phase48-v1',
    'template_suggestions',v_suggestions,
    'waive_lifecycle_snapshots',v_lifecycle,
    'ops_alerts',v_alerts,
    'auto_publish',false
  );
end;
$$;

revoke all on function public.it_intune_phase48_sanitize_aggregate(jsonb)
  from public,authenticated,service_role;
revoke all on function public.it_intune_phase48_lifecycle_anomaly_expired_min()
  from public,authenticated,service_role;
revoke all on function public.suggest_it_intune_postmortem_template_phase48()
  from public,authenticated;
revoke all on function public.record_it_intune_waive_lifecycle_snapshot_phase48()
  from public,authenticated;
revoke all on function public.list_it_intune_phase48_critical_windows(integer)
  from public,authenticated;
revoke all on function public.record_it_intune_phase48_ops_alert(jsonb)
  from public,authenticated;
revoke all on function public.get_it_intune_phase48_ops_report()
  from public,authenticated;
revoke all on function public.prevent_it_intune_phase48_ops_mutation()
  from public,authenticated,service_role;

grant execute on function public.suggest_it_intune_postmortem_template_phase48(),
  public.record_it_intune_waive_lifecycle_snapshot_phase48(),
  public.list_it_intune_phase48_critical_windows(integer),
  public.record_it_intune_phase48_ops_alert(jsonb),
  public.get_it_intune_phase48_ops_report()
  to service_role;

grant execute on function public.list_it_intune_phase48_critical_windows(integer),
  public.get_it_intune_phase48_ops_report()
  to authenticated;

grant execute on function public.it_intune_phase48_lifecycle_anomaly_expired_min()
  to authenticated, service_role;
