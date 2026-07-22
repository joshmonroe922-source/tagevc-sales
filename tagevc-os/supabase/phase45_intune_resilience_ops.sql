-- Phase 45: Intune resilience quality gates — postmortem quality reviews
-- from multi-cycle soak + performance trends, and tuning promote gates.
-- Apply after phase44_intune_resilience_ops.sql.
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

-- Minimum complete open→closed cycles required before promote is ready.
create or replace function public.it_intune_phase45_min_cycle_count()
returns integer
language sql
immutable
parallel safe
set search_path = public
as $$
  select 3;
$$;

create or replace function public.it_intune_phase45_sanitize_aggregate(p_evidence jsonb)
returns jsonb
language sql immutable set search_path=public as $$
  select coalesce(p_evidence,'{}'::jsonb)
    - 'entity_id' - 'entity_ids' - 'entity_scope' - 'entity_scopes'
    || jsonb_build_object('entity_identifiers_included',false);
$$;

-- ---------------------------------------------------------------------------
-- Append-only postmortem quality reviews (aggregate checklist only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_postmortem_quality_reviews (
  review_id uuid primary key default gen_random_uuid(),
  postmortem_id uuid not null
    references public.os_it_intune_outage_postmortems(postmortem_id),
  quality_score numeric(5,4) not null,
  checklist jsonb not null,
  cycle_complete_count integer not null default 0,
  trend_healthy boolean not null default false,
  ready_for_tuning_promote boolean not null default false,
  evidence_sha256 text not null,
  bucket_key text,
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p45_qr_score_check
    check (quality_score between 0 and 1),
  constraint os_it_intune_p45_qr_cycles_check
    check (cycle_complete_count>=0),
  constraint os_it_intune_p45_qr_hash_check
    check (evidence_sha256~'^[0-9a-f]{64}$'),
  constraint os_it_intune_p45_qr_bucket_check
    check (bucket_key is null
      or bucket_key~'^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$'),
  constraint os_it_intune_p45_qr_no_entity_leak check (
    not (checklist ? 'entity_id')
    and not (checklist ? 'entity_ids')
    and not (checklist ? 'entity_scope')
    and not (checklist ? 'entity_scopes')
    and coalesce((checklist->>'entity_identifiers_included')::boolean,false)=false
  ),
  constraint os_it_intune_p45_qr_bucket_unique
    unique (postmortem_id, bucket_key)
);

create index if not exists os_it_intune_p45_qr_pm_recorded_idx
  on public.os_it_intune_postmortem_quality_reviews(
    postmortem_id, recorded_at desc, review_id desc);

alter table public.os_it_intune_postmortem_quality_reviews
  enable row level security;

drop policy if exists "os_it_intune_p45_qr_select"
  on public.os_it_intune_postmortem_quality_reviews;
create policy "os_it_intune_p45_qr_select"
  on public.os_it_intune_postmortem_quality_reviews for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_postmortem_quality_reviews to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_postmortem_quality_reviews
  from public,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Append-only tuning promote gate observations
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_tuning_promote_gates (
  gate_id uuid primary key default gen_random_uuid(),
  recommendation_id uuid
    references public.os_it_intune_threshold_recommendation_drafts(recommendation_id),
  proposal_id uuid
    references public.os_it_intune_breaker_tuning_proposals(proposal_id),
  gate_status text not null,
  block_reasons jsonb not null default '[]'::jsonb,
  multi_cycle_count integer not null default 0,
  failure_rate_trend text not null,
  evidence_sha256 text not null,
  bucket_key text,
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p45_gate_status_check
    check (gate_status in ('blocked','ready','waived')),
  constraint os_it_intune_p45_gate_trend_check
    check (failure_rate_trend in
      ('improving','stable','degrading','insufficient_data')),
  constraint os_it_intune_p45_gate_cycles_check
    check (multi_cycle_count>=0),
  constraint os_it_intune_p45_gate_hash_check
    check (evidence_sha256~'^[0-9a-f]{64}$'),
  constraint os_it_intune_p45_gate_bucket_check
    check (bucket_key is null
      or bucket_key~'^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$'),
  constraint os_it_intune_p45_gate_target_check
    check (recommendation_id is not null or proposal_id is not null),
  constraint os_it_intune_p45_gate_no_entity_leak check (
    not (block_reasons ? 'entity_id')
    and not (block_reasons ? 'entity_ids')
    and not (block_reasons ? 'entity_scope')
    and not (block_reasons ? 'entity_scopes')
    and jsonb_typeof(block_reasons)='array'
  )
);

create unique index if not exists os_it_intune_p45_gate_reco_bucket_uidx
  on public.os_it_intune_tuning_promote_gates(recommendation_id, bucket_key)
  where recommendation_id is not null and bucket_key is not null;

create unique index if not exists os_it_intune_p45_gate_proposal_bucket_uidx
  on public.os_it_intune_tuning_promote_gates(proposal_id, bucket_key)
  where proposal_id is not null and bucket_key is not null
    and recommendation_id is null;

create index if not exists os_it_intune_p45_gate_reco_recorded_idx
  on public.os_it_intune_tuning_promote_gates(
    recommendation_id, recorded_at desc)
  where recommendation_id is not null;

create index if not exists os_it_intune_p45_gate_proposal_recorded_idx
  on public.os_it_intune_tuning_promote_gates(
    proposal_id, recorded_at desc)
  where proposal_id is not null;

alter table public.os_it_intune_tuning_promote_gates
  enable row level security;

drop policy if exists "os_it_intune_p45_gate_select"
  on public.os_it_intune_tuning_promote_gates;
create policy "os_it_intune_p45_gate_select"
  on public.os_it_intune_tuning_promote_gates for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_tuning_promote_gates to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_tuning_promote_gates
  from public,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Append-only Phase 45 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_phase45_ops_alerts (
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
  proposal_id uuid
    references public.os_it_intune_breaker_tuning_proposals(proposal_id),
  postmortem_id uuid
    references public.os_it_intune_outage_postmortems(postmortem_id),
  aggregate_evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null,
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p45_alert_kind_check
    check (alert_kind in (
      'postmortem_quality_low',
      'tuning_promote_blocked',
      'multi_cycle_trend_degraded'
    )),
  constraint os_it_intune_p45_alert_severity_check
    check (severity in ('warning','critical')),
  constraint os_it_intune_p45_alert_delivery_check
    check (delivery_status in
      ('delivered','skipped_no_webhook','failed','recorded')),
  constraint os_it_intune_p45_alert_hash_check
    check (evidence_sha256~'^[0-9a-f]{64}$'),
  constraint os_it_intune_p45_alert_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  )
);

create index if not exists os_it_intune_p45_alert_kind_recorded_idx
  on public.os_it_intune_phase45_ops_alerts(alert_kind, recorded_at desc);

alter table public.os_it_intune_phase45_ops_alerts
  enable row level security;

drop policy if exists "os_it_intune_p45_alert_select"
  on public.os_it_intune_phase45_ops_alerts;
create policy "os_it_intune_p45_alert_select"
  on public.os_it_intune_phase45_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_phase45_ops_alerts to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_phase45_ops_alerts
  from public,authenticated,service_role;

create or replace function public.prevent_it_intune_phase45_ops_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'Phase 45 Intune resilience quality gate evidence is append-only';
end;
$$;

drop trigger if exists os_it_intune_p45_qr_append_only
  on public.os_it_intune_postmortem_quality_reviews;
create trigger os_it_intune_p45_qr_append_only
  before update or delete
  on public.os_it_intune_postmortem_quality_reviews
  for each row execute function public.prevent_it_intune_phase45_ops_mutation();

drop trigger if exists os_it_intune_p45_qr_no_truncate
  on public.os_it_intune_postmortem_quality_reviews;
create trigger os_it_intune_p45_qr_no_truncate
  before truncate
  on public.os_it_intune_postmortem_quality_reviews
  for each statement execute function public.prevent_it_intune_phase45_ops_mutation();

drop trigger if exists os_it_intune_p45_gate_append_only
  on public.os_it_intune_tuning_promote_gates;
create trigger os_it_intune_p45_gate_append_only
  before update or delete
  on public.os_it_intune_tuning_promote_gates
  for each row execute function public.prevent_it_intune_phase45_ops_mutation();

drop trigger if exists os_it_intune_p45_gate_no_truncate
  on public.os_it_intune_tuning_promote_gates;
create trigger os_it_intune_p45_gate_no_truncate
  before truncate
  on public.os_it_intune_tuning_promote_gates
  for each statement execute function public.prevent_it_intune_phase45_ops_mutation();

drop trigger if exists os_it_intune_p45_alert_append_only
  on public.os_it_intune_phase45_ops_alerts;
create trigger os_it_intune_p45_alert_append_only
  before update or delete
  on public.os_it_intune_phase45_ops_alerts
  for each row execute function public.prevent_it_intune_phase45_ops_mutation();

drop trigger if exists os_it_intune_p45_alert_no_truncate
  on public.os_it_intune_phase45_ops_alerts;
create trigger os_it_intune_p45_alert_no_truncate
  before truncate
  on public.os_it_intune_phase45_ops_alerts
  for each statement execute function public.prevent_it_intune_phase45_ops_mutation();

-- ---------------------------------------------------------------------------
-- Trend helper from Phase 44 performance snapshots (breaker-scoped, aggregate)
-- ---------------------------------------------------------------------------
create or replace function public.it_intune_phase45_failure_rate_trend(
  p_breaker_id uuid)
returns text
language plpgsql
stable
security definer
set search_path=public as $$
declare
  v_recent numeric;
  v_prior numeric;
  v_recent_n integer;
  v_prior_n integer;
begin
  -- Observe-only: never updates breaker rows or reset/close RPCs.
  select avg(s.failure_rate), count(*)
  into v_recent, v_recent_n
  from (
    select p.failure_rate
    from public.os_it_intune_breaker_config_performance_snapshots p
    where p.breaker_id=p_breaker_id
      and p.sample_count>=3
    order by p.recorded_at desc, p.snapshot_id desc
    limit 3
  ) s;

  select avg(s.failure_rate), count(*)
  into v_prior, v_prior_n
  from (
    select p.failure_rate
    from public.os_it_intune_breaker_config_performance_snapshots p
    where p.breaker_id=p_breaker_id
      and p.sample_count>=3
    order by p.recorded_at desc, p.snapshot_id desc
    offset 3
    limit 3
  ) s;

  if coalesce(v_recent_n,0)<2 then
    return 'insufficient_data';
  end if;

  if coalesce(v_prior_n,0)<2 then
    if coalesce(v_recent,0) >= 0.5000 then
      return 'degrading';
    end if;
    return 'stable';
  end if;

  if v_recent > v_prior + 0.1000 then
    return 'degrading';
  end if;
  if v_recent < v_prior - 0.1000 then
    return 'improving';
  end if;
  return 'stable';
end;
$$;

-- ---------------------------------------------------------------------------
-- Postmortem quality review (uses soak cycles + performance snapshots)
-- ---------------------------------------------------------------------------
create or replace function public.review_it_intune_postmortem_quality_phase45()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_pm record;
  v_bucket text;
  v_cycles integer;
  v_trend text;
  v_trend_healthy boolean;
  v_published boolean;
  v_root_set boolean;
  v_notes boolean;
  v_cycle_ok boolean;
  v_checklist jsonb;
  v_score numeric(5,4);
  v_ready boolean;
  v_evidence jsonb;
  v_hash text;
  v_recorded integer:=0;
  v_skipped integer:=0;
  v_min_cycles integer:=public.it_intune_phase45_min_cycle_count();
  v_breaker uuid;
begin
  -- Quality reviews never update breaker rows and never call reset/close RPCs.
  v_bucket:=to_char(date_trunc('hour',now()),'YYYYMMDD"T"HH24');

  for v_pm in
    select p.postmortem_id,p.status,p.root_cause_class,p.blameless_notes,
      p.episode_id
    from public.os_it_intune_outage_postmortems p
    where p.status in ('draft','published')
    order by p.updated_at desc nulls last, p.postmortem_id
    limit 100
  loop
    if exists (
      select 1 from public.os_it_intune_postmortem_quality_reviews r
      where r.postmortem_id=v_pm.postmortem_id
        and r.bucket_key=v_bucket
    ) then
      v_skipped:=v_skipped+1;
      continue;
    end if;

    select count(*) into v_cycles
    from public.os_it_intune_soak_cycle_evidence c
    where c.postmortem_id=v_pm.postmortem_id
      and c.cycle_status='cycle_complete';

    -- Prefer a breaker linked via recommendations/cycles for this postmortem.
    v_breaker:=null;
    select c.breaker_id into v_breaker
    from public.os_it_intune_soak_cycle_evidence c
    where c.postmortem_id=v_pm.postmortem_id
    order by c.recorded_at desc
    limit 1;

    if v_breaker is null then
      select d.breaker_id into v_breaker
      from public.os_it_intune_threshold_recommendation_drafts d
      where d.postmortem_id=v_pm.postmortem_id
      order by d.generated_at desc
      limit 1;
    end if;

    if v_breaker is not null then
      v_trend:=public.it_intune_phase45_failure_rate_trend(v_breaker);
    else
      v_trend:='insufficient_data';
    end if;

    v_trend_healthy:=v_trend in ('improving','stable');
    v_published:=v_pm.status='published';
    v_root_set:=v_pm.root_cause_class is not null
      and v_pm.root_cause_class<>'unknown';
    v_notes:=length(trim(coalesce(v_pm.blameless_notes,'')))>=20;
    v_cycle_ok:=coalesce(v_cycles,0)>=v_min_cycles;

    v_checklist:=public.it_intune_phase45_sanitize_aggregate(jsonb_build_object(
      'postmortem_published',v_published,
      'root_cause_set',v_root_set,
      'blameless_notes_present',v_notes,
      'cycle_evidence_sufficient',v_cycle_ok,
      'performance_trend_healthy',v_trend_healthy,
      'failure_rate_trend',v_trend,
      'cycle_complete_count',coalesce(v_cycles,0),
      'min_cycle_count',v_min_cycles,
      'entity_identifiers_included',false
    ));

    v_score:=round((
      (case when v_published then 1 else 0 end)
      +(case when v_root_set then 1 else 0 end)
      +(case when v_notes then 1 else 0 end)
      +(case when v_cycle_ok then 1 else 0 end)
      +(case when v_trend_healthy then 1 else 0 end)
    )::numeric / 5.0, 4);

    v_ready:=v_published and v_root_set and v_notes
      and v_cycle_ok and v_trend_healthy and v_score>=0.8000;

    v_evidence:=public.it_intune_phase45_sanitize_aggregate(jsonb_build_object(
      'evidence_version','phase45-v1',
      'review_kind','postmortem_quality',
      'postmortem_id',v_pm.postmortem_id,
      'quality_score',v_score,
      'checklist',v_checklist,
      'cycle_complete_count',coalesce(v_cycles,0),
      'trend_healthy',v_trend_healthy,
      'ready_for_tuning_promote',v_ready,
      'bucket_key',v_bucket,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    ));
    v_hash:=public.os_sha256_hex(v_evidence::text);

    insert into public.os_it_intune_postmortem_quality_reviews(
      postmortem_id,quality_score,checklist,cycle_complete_count,
      trend_healthy,ready_for_tuning_promote,evidence_sha256,bucket_key
    ) values (
      v_pm.postmortem_id,v_score,v_checklist,coalesce(v_cycles,0),
      v_trend_healthy,v_ready,v_hash,v_bucket
    );
    v_recorded:=v_recorded+1;
  end loop;

  return jsonb_build_object(
    'reviews_recorded',v_recorded,
    'skipped',v_skipped,
    'bucket_key',v_bucket,
    'min_cycle_count',v_min_cycles,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Tuning promote gate evaluation (blocks when cycles < N or trend unhealthy)
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_it_intune_tuning_promote_gate_phase45(
  p_recommendation_id uuid default null,
  p_proposal_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_target record;
  v_bucket text;
  v_cycles integer;
  v_trend text;
  v_trend_healthy boolean;
  v_reasons jsonb;
  v_status text;
  v_evidence jsonb;
  v_hash text;
  v_recorded integer:=0;
  v_skipped integer:=0;
  v_min_cycles integer:=public.it_intune_phase45_min_cycle_count();
  v_quality_ready boolean;
  v_gate_id uuid;
  v_latest jsonb:='[]'::jsonb;
begin
  -- Promote gates never update breaker rows and never call reset/close RPCs.
  v_bucket:=to_char(date_trunc('hour',now()),'YYYYMMDD"T"HH24');

  for v_target in
    select d.recommendation_id,d.resulting_proposal_id as proposal_id,
      d.breaker_id,d.postmortem_id,d.status as reco_status
    from public.os_it_intune_threshold_recommendation_drafts d
    where (p_recommendation_id is null or d.recommendation_id=p_recommendation_id)
      and (p_proposal_id is null
        or d.resulting_proposal_id=p_proposal_id
        or (d.resulting_proposal_id is null and p_proposal_id is null
            and p_recommendation_id is not null))
      and d.status in ('pending','accepted')
      and (p_recommendation_id is not null or p_proposal_id is not null
        or d.status='pending'
        or (d.status='accepted' and d.resulting_proposal_id is not null
          and not exists (
            select 1 from public.os_it_intune_breaker_tuning_decisions x
            where x.proposal_id=d.resulting_proposal_id
          )))
    order by d.generated_at desc
    limit 100
  loop
    if p_proposal_id is not null
       and v_target.proposal_id is distinct from p_proposal_id
       and v_target.recommendation_id is distinct from p_recommendation_id then
      continue;
    end if;

    if exists (
      select 1 from public.os_it_intune_tuning_promote_gates g
      where g.recommendation_id=v_target.recommendation_id
        and g.bucket_key=v_bucket
    ) then
      v_skipped:=v_skipped+1;
      select g.gate_id,g.gate_status,g.multi_cycle_count,g.failure_rate_trend,
        g.block_reasons,g.evidence_sha256
      into v_gate_id,v_status,v_cycles,v_trend,v_reasons,v_hash
      from public.os_it_intune_tuning_promote_gates g
      where g.recommendation_id=v_target.recommendation_id
        and g.bucket_key=v_bucket
      limit 1;
      v_latest:=v_latest||jsonb_build_array(jsonb_build_object(
        'gate_id',v_gate_id,
        'recommendation_id',v_target.recommendation_id,
        'proposal_id',v_target.proposal_id,
        'gate_status',v_status,
        'multi_cycle_count',v_cycles,
        'failure_rate_trend',v_trend,
        'block_reasons',v_reasons,
        'evidence_sha256',v_hash,
        'inserted',false
      ));
      continue;
    end if;

    -- Multi-cycle evidence is breaker-scoped (longer-term resilience context).
    select count(*) into v_cycles
    from public.os_it_intune_soak_cycle_evidence c
    where c.breaker_id=v_target.breaker_id
      and c.cycle_status='cycle_complete';

    v_trend:=public.it_intune_phase45_failure_rate_trend(v_target.breaker_id);
    v_trend_healthy:=v_trend in ('improving','stable');

    v_quality_ready:=true;
    if v_target.postmortem_id is not null then
      v_quality_ready:=false;
      select q.ready_for_tuning_promote into v_quality_ready
      from public.os_it_intune_postmortem_quality_reviews q
      where q.postmortem_id=v_target.postmortem_id
      order by q.recorded_at desc, q.review_id desc
      limit 1;
      if not found then
        v_quality_ready:=false;
      end if;
    end if;

    v_reasons:='[]'::jsonb;
    if coalesce(v_cycles,0) < v_min_cycles then
      v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object(
        'code','insufficient_multi_cycles',
        'multi_cycle_count',coalesce(v_cycles,0),
        'min_cycle_count',v_min_cycles
      ));
    end if;
    if not v_trend_healthy then
      v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object(
        'code','trend_unhealthy',
        'failure_rate_trend',v_trend
      ));
    end if;
    if v_target.postmortem_id is not null and not coalesce(v_quality_ready,false) then
      v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object(
        'code','postmortem_quality_not_ready'
      ));
    end if;

    if jsonb_array_length(v_reasons)=0 then
      v_status:='ready';
    else
      v_status:='blocked';
    end if;

    v_evidence:=public.it_intune_phase45_sanitize_aggregate(jsonb_build_object(
      'evidence_version','phase45-v1',
      'gate_kind','tuning_promote',
      'recommendation_id',v_target.recommendation_id,
      'proposal_id',v_target.proposal_id,
      'breaker_id',v_target.breaker_id,
      'gate_status',v_status,
      'block_reasons',v_reasons,
      'multi_cycle_count',coalesce(v_cycles,0),
      'min_cycle_count',v_min_cycles,
      'failure_rate_trend',v_trend,
      'trend_healthy',v_trend_healthy,
      'bucket_key',v_bucket,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    ));
    v_hash:=public.os_sha256_hex(v_evidence::text);

    insert into public.os_it_intune_tuning_promote_gates(
      recommendation_id,proposal_id,gate_status,block_reasons,
      multi_cycle_count,failure_rate_trend,evidence_sha256,bucket_key
    ) values (
      v_target.recommendation_id,v_target.proposal_id,v_status,v_reasons,
      coalesce(v_cycles,0),v_trend,v_hash,v_bucket
    )
    returning gate_id into v_gate_id;

    v_recorded:=v_recorded+1;
    v_latest:=v_latest||jsonb_build_array(jsonb_build_object(
      'gate_id',v_gate_id,
      'recommendation_id',v_target.recommendation_id,
      'proposal_id',v_target.proposal_id,
      'gate_status',v_status,
      'multi_cycle_count',coalesce(v_cycles,0),
      'failure_rate_trend',v_trend,
      'block_reasons',v_reasons,
      'evidence_sha256',v_hash,
      'inserted',true
    ));
  end loop;

  return jsonb_build_object(
    'gates_recorded',v_recorded,
    'skipped',v_skipped,
    'bucket_key',v_bucket,
    'min_cycle_count',v_min_cycles,
    'gates',v_latest,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

-- Latest promote gate for a recommendation (stable read for UI/actions).
create or replace function public.get_it_intune_tuning_promote_gate_phase45(
  p_recommendation_id uuid default null,
  p_proposal_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public as $$
declare
  v_gate public.os_it_intune_tuning_promote_gates%rowtype;
begin
  if p_recommendation_id is null and p_proposal_id is null then
    raise exception 'Phase 45 promote gate lookup requires recommendation or proposal';
  end if;

  select * into v_gate
  from public.os_it_intune_tuning_promote_gates g
  where (p_recommendation_id is null or g.recommendation_id=p_recommendation_id)
    and (p_proposal_id is null or g.proposal_id=p_proposal_id
      or (g.proposal_id is null and p_proposal_id is null))
  order by g.recorded_at desc, g.gate_id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'found',false,
      'gate_status','blocked',
      'block_reasons',jsonb_build_array(jsonb_build_object(
        'code','gate_not_evaluated'
      )),
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    );
  end if;

  return jsonb_build_object(
    'found',true,
    'gate_id',v_gate.gate_id,
    'recommendation_id',v_gate.recommendation_id,
    'proposal_id',v_gate.proposal_id,
    'gate_status',v_gate.gate_status,
    'block_reasons',v_gate.block_reasons,
    'multi_cycle_count',v_gate.multi_cycle_count,
    'failure_rate_trend',v_gate.failure_rate_trend,
    'evidence_sha256',v_gate.evidence_sha256,
    'recorded_at',v_gate.recorded_at,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

-- Accept only when promote gate is ready (or waived). Never mutates breakers
-- beyond the existing Phase 41 accept path (which itself never closes/resets).
create or replace function public.accept_it_intune_threshold_recommendation_phase45(
  p_recommendation_id uuid,p_actor_id uuid,p_reason text,
  p_expected_breaker_version bigint,p_expected_row_version bigint
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_eval jsonb;
  v_gate jsonb;
  v_status text;
begin
  -- Refresh gate observation for this recommendation before accept.
  v_eval:=public.evaluate_it_intune_tuning_promote_gate_phase45(
    p_recommendation_id, null);
  v_gate:=public.get_it_intune_tuning_promote_gate_phase45(
    p_recommendation_id, null);
  v_status:=coalesce(v_gate->>'gate_status','blocked');

  if v_status not in ('ready','waived') then
    raise exception
      'Phase 45 tuning promote gate blocked: multi-cycle trend quality required before accept';
  end if;

  return public.accept_it_intune_threshold_recommendation(
    p_recommendation_id,p_actor_id,p_reason,
    p_expected_breaker_version,p_expected_row_version
  ) || jsonb_build_object(
    'phase45_gate_status',v_status,
    'phase45_eval',jsonb_build_object(
      'gates_recorded',v_eval->'gates_recorded',
      'closes_or_resets_breaker',false
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Critical windows + alert recording
-- ---------------------------------------------------------------------------
create or replace function public.list_it_intune_phase45_critical_windows(
  p_window_hours integer default 24)
returns jsonb
language plpgsql
stable
security definer
set search_path=public as $$
declare
  v_hours integer:=least(greatest(coalesce(p_window_hours,24),1),168);
  v_bucket text;
  v_pending jsonb:='[]'::jsonb;
  v_part jsonb;
begin
  v_bucket:=to_char(
    to_timestamp(
      (floor(extract(epoch from now())/(v_hours*3600.0))
        *(v_hours*3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','postmortem_quality_low',
      'window_key','pmquality:'||r.postmortem_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','warning',
      'postmortem_id',r.postmortem_id,
      'quality_score',r.quality_score
    ) order by r.recorded_at desc)
    from (
      select q.postmortem_id,q.quality_score,q.recorded_at,
        row_number() over (
          partition by q.postmortem_id
          order by q.recorded_at desc, q.review_id desc
        ) rn
      from public.os_it_intune_postmortem_quality_reviews q
      where q.recorded_at>=now()-interval '24 hours'
        and q.quality_score < 0.6000
    ) r
    where r.rn=1
      and not exists (
        select 1 from public.os_it_intune_phase45_ops_alerts x
        where x.window_key=
          'pmquality:'||r.postmortem_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 25
  ), '[]'::jsonb) into v_part;
  v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','tuning_promote_blocked',
      'window_key','promotegate:'||g.recommendation_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','warning',
      'recommendation_id',g.recommendation_id,
      'proposal_id',g.proposal_id,
      'multi_cycle_count',g.multi_cycle_count,
      'failure_rate_trend',g.failure_rate_trend
    ) order by g.recorded_at desc)
    from (
      select t.recommendation_id,t.proposal_id,t.multi_cycle_count,
        t.failure_rate_trend,t.recorded_at,
        row_number() over (
          partition by t.recommendation_id
          order by t.recorded_at desc, t.gate_id desc
        ) rn
      from public.os_it_intune_tuning_promote_gates t
      where t.recorded_at>=now()-interval '24 hours'
        and t.gate_status='blocked'
        and t.recommendation_id is not null
    ) g
    where g.rn=1
      and not exists (
        select 1 from public.os_it_intune_phase45_ops_alerts x
        where x.window_key=
          'promotegate:'||g.recommendation_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 25
  ), '[]'::jsonb) into v_part;
  v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','multi_cycle_trend_degraded',
      'window_key','trenddeg:'||g.recommendation_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','critical',
      'recommendation_id',g.recommendation_id,
      'proposal_id',g.proposal_id,
      'failure_rate_trend',g.failure_rate_trend,
      'multi_cycle_count',g.multi_cycle_count
    ) order by g.recorded_at desc)
    from (
      select t.recommendation_id,t.proposal_id,t.multi_cycle_count,
        t.failure_rate_trend,t.recorded_at,
        row_number() over (
          partition by t.recommendation_id
          order by t.recorded_at desc, t.gate_id desc
        ) rn
      from public.os_it_intune_tuning_promote_gates t
      where t.recorded_at>=now()-interval '24 hours'
        and t.failure_rate_trend='degrading'
        and t.recommendation_id is not null
    ) g
    where g.rn=1
      and not exists (
        select 1 from public.os_it_intune_phase45_ops_alerts x
        where x.window_key=
          'trenddeg:'||g.recommendation_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 25
  ), '[]'::jsonb) into v_part;
  v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);

  return jsonb_build_object(
    'version','phase45-v1',
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',coalesce(v_pending,'[]'::jsonb),
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

create or replace function public.record_it_intune_phase45_ops_alert(p_alert jsonb)
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
  v_proposal uuid;
  v_pm uuid;
  v_evidence jsonb;
  v_hash text;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_alert,'{}'::jsonb))<>'object' then
    raise exception 'Phase 45 ops alert payload must be a JSON object';
  end if;

  v_kind:=coalesce(p_alert->>'alert_kind','');
  v_window:=coalesce(p_alert->>'window_key','');
  v_dest:=coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery:=coalesce(p_alert->>'delivery_status','recorded');
  v_code:=nullif(p_alert->>'response_code','')::integer;
  v_severity:=coalesce(nullif(p_alert->>'severity',''),'warning');
  v_reco:=nullif(p_alert->>'recommendation_id','')::uuid;
  v_proposal:=nullif(p_alert->>'proposal_id','')::uuid;
  v_pm:=nullif(p_alert->>'postmortem_id','')::uuid;

  if v_kind not in (
      'postmortem_quality_low','tuning_promote_blocked',
      'multi_cycle_trend_degraded')
    or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
    or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
    or v_delivery not in
      ('delivered','skipped_no_webhook','failed','recorded')
    or v_severity not in ('warning','critical') then
    raise exception 'Phase 45 ops alert contract is invalid';
  end if;

  v_evidence:=public.it_intune_phase45_sanitize_aggregate(
    coalesce(p_alert->'aggregate_evidence','{}'::jsonb)
    || jsonb_build_object(
      'evidence_version','phase45-v1',
      'alert_kind',v_kind,
      'window_key',v_window,
      'severity',v_severity,
      'destination_key',v_dest,
      'delivery_status',v_delivery,
      'response_code',v_code,
      'recommendation_id',v_reco,
      'proposal_id',v_proposal,
      'postmortem_id',v_pm,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    )
  );
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_it_intune_phase45_ops_alerts(
    alert_kind,window_key,severity,destination_key,delivery_status,
    response_code,recommendation_id,proposal_id,postmortem_id,
    aggregate_evidence,evidence_sha256
  ) values (
    v_kind,v_window,v_severity,v_dest,v_delivery,v_code,
    v_reco,v_proposal,v_pm,v_evidence,v_hash
  )
  on conflict (window_key) do nothing
  returning alert_id into v_id;

  if v_id is null then
    select alert_id into v_id
    from public.os_it_intune_phase45_ops_alerts
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

create or replace view public.os_it_intune_phase45_health
with (security_invoker=true) as
select
  (select count(*) from public.os_it_intune_postmortem_quality_reviews)
    as quality_review_count,
  (select count(*) from public.os_it_intune_postmortem_quality_reviews
    where ready_for_tuning_promote) as quality_ready_count,
  (select count(*) from public.os_it_intune_postmortem_quality_reviews
    where quality_score < 0.6000
      and recorded_at>=now()-interval '7 days') as quality_low_7d,
  (select count(*) from public.os_it_intune_tuning_promote_gates)
    as promote_gate_count,
  (select count(*) from public.os_it_intune_tuning_promote_gates g
    where g.gate_status='ready'
      and g.recorded_at=(
        select max(x.recorded_at)
        from public.os_it_intune_tuning_promote_gates x
        where x.recommendation_id=g.recommendation_id
      )) as promote_ready_latest_count,
  (select count(*) from public.os_it_intune_tuning_promote_gates g
    where g.gate_status='blocked'
      and g.recorded_at>=now()-interval '7 days') as promote_blocked_7d,
  (select count(*) from public.os_it_intune_tuning_promote_gates
    where failure_rate_trend='degrading'
      and recorded_at>=now()-interval '7 days') as trend_degraded_7d,
  (select count(*) from public.os_it_intune_phase45_ops_alerts)
    as ops_alert_count,
  (select count(*) from public.os_it_intune_phase45_ops_alerts
    where delivery_status='delivered') as alerts_delivered_count,
  (select count(*) from public.os_it_intune_phase45_ops_alerts
    where delivery_status in ('failed','skipped_no_webhook'))
    as alerts_undelivered_count;
grant select on public.os_it_intune_phase45_health to authenticated;

create or replace view public.os_it_intune_postmortem_quality_status
with (security_invoker=true) as
select distinct on (r.postmortem_id)
  r.review_id,r.postmortem_id,r.quality_score,r.checklist,
  r.cycle_complete_count,r.trend_healthy,r.ready_for_tuning_promote,
  r.evidence_sha256,r.recorded_at,
  p.status as postmortem_status,p.root_cause_class
from public.os_it_intune_postmortem_quality_reviews r
join public.os_it_intune_outage_postmortems p
  on p.postmortem_id=r.postmortem_id
order by r.postmortem_id, r.recorded_at desc, r.review_id desc;
grant select on public.os_it_intune_postmortem_quality_status to authenticated;

create or replace view public.os_it_intune_tuning_promote_gate_status
with (security_invoker=true) as
select distinct on (g.recommendation_id)
  g.gate_id,g.recommendation_id,g.proposal_id,g.gate_status,g.block_reasons,
  g.multi_cycle_count,g.failure_rate_trend,g.evidence_sha256,g.recorded_at,
  d.status as recommendation_status,d.breaker_id,d.postmortem_id
from public.os_it_intune_tuning_promote_gates g
join public.os_it_intune_threshold_recommendation_drafts d
  on d.recommendation_id=g.recommendation_id
where g.recommendation_id is not null
order by g.recommendation_id, g.recorded_at desc, g.gate_id desc;
grant select on public.os_it_intune_tuning_promote_gate_status to authenticated;

create or replace function public.get_it_intune_phase45_ops_report()
returns jsonb
language plpgsql
stable
security definer
set search_path=public as $$
declare
  v_health jsonb;
  v_reviews jsonb;
  v_gates jsonb;
  v_alerts jsonb;
begin
  select jsonb_build_object(
    'quality_review_count',quality_review_count,
    'quality_ready_count',quality_ready_count,
    'quality_low_7d',quality_low_7d,
    'promote_gate_count',promote_gate_count,
    'promote_ready_latest_count',promote_ready_latest_count,
    'promote_blocked_7d',promote_blocked_7d,
    'trend_degraded_7d',trend_degraded_7d,
    'ops_alert_count',ops_alert_count,
    'alerts_delivered_count',alerts_delivered_count,
    'alerts_undelivered_count',alerts_undelivered_count,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  ) into v_health
  from public.os_it_intune_phase45_health;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_reviews
  from (
    select r.review_id,r.postmortem_id,r.quality_score,r.cycle_complete_count,
      r.trend_healthy,r.ready_for_tuning_promote,r.evidence_sha256,r.recorded_at
    from public.os_it_intune_postmortem_quality_reviews r
    order by r.recorded_at desc
    limit 50
  ) x;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_gates
  from (
    select g.gate_id,g.recommendation_id,g.proposal_id,g.gate_status,
      g.multi_cycle_count,g.failure_rate_trend,g.evidence_sha256,g.recorded_at
    from public.os_it_intune_tuning_promote_gates g
    order by g.recorded_at desc
    limit 50
  ) x;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_alerts
  from (
    select a.alert_id,a.alert_kind,a.window_key,a.severity,a.destination_key,
      a.delivery_status,a.response_code,a.recommendation_id,a.proposal_id,
      a.postmortem_id,a.evidence_sha256,a.recorded_at
    from public.os_it_intune_phase45_ops_alerts a
    order by a.recorded_at desc
    limit 50
  ) x;

  return coalesce(v_health,'{}'::jsonb) || jsonb_build_object(
    'version','phase45-v1',
    'quality_reviews',v_reviews,
    'promote_gates',v_gates,
    'ops_alerts',v_alerts,
    'min_cycle_count',public.it_intune_phase45_min_cycle_count()
  );
end;
$$;

revoke all on function public.it_intune_phase45_sanitize_aggregate(jsonb)
  from public,authenticated,service_role;
revoke all on function public.it_intune_phase45_min_cycle_count()
  from public,authenticated,service_role;
revoke all on function public.it_intune_phase45_failure_rate_trend(uuid)
  from public,authenticated;
revoke all on function public.review_it_intune_postmortem_quality_phase45()
  from public,authenticated;
revoke all on function public.evaluate_it_intune_tuning_promote_gate_phase45(uuid,uuid)
  from public,authenticated;
revoke all on function public.get_it_intune_tuning_promote_gate_phase45(uuid,uuid)
  from public,authenticated;
revoke all on function public.accept_it_intune_threshold_recommendation_phase45(
  uuid,uuid,text,bigint,bigint) from public,authenticated;
revoke all on function public.list_it_intune_phase45_critical_windows(integer)
  from public,authenticated;
revoke all on function public.record_it_intune_phase45_ops_alert(jsonb)
  from public,authenticated;
revoke all on function public.get_it_intune_phase45_ops_report()
  from public,authenticated;

grant execute on function public.review_it_intune_postmortem_quality_phase45(),
  public.evaluate_it_intune_tuning_promote_gate_phase45(uuid,uuid),
  public.get_it_intune_tuning_promote_gate_phase45(uuid,uuid),
  public.accept_it_intune_threshold_recommendation_phase45(
    uuid,uuid,text,bigint,bigint),
  public.list_it_intune_phase45_critical_windows(integer),
  public.record_it_intune_phase45_ops_alert(jsonb),
  public.get_it_intune_phase45_ops_report(),
  public.it_intune_phase45_failure_rate_trend(uuid)
  to service_role;

grant execute on function public.get_it_intune_tuning_promote_gate_phase45(uuid,uuid),
  public.list_it_intune_phase45_critical_windows(integer),
  public.get_it_intune_phase45_ops_report(),
  public.evaluate_it_intune_tuning_promote_gate_phase45(uuid,uuid)
  to authenticated;

grant execute on function public.it_intune_phase45_min_cycle_count()
  to authenticated, service_role;
