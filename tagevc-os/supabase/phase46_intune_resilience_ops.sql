-- Phase 46: Intune dual-approver promote waive + deeper postmortem quality
-- scorecards (multi-cycle trends + correlation coverage).
-- Apply after phase45_intune_resilience_ops.sql.
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

create or replace function public.it_intune_phase46_sanitize_aggregate(p_evidence jsonb)
returns jsonb
language sql immutable set search_path=public as $$
  select coalesce(p_evidence,'{}'::jsonb)
    - 'entity_id' - 'entity_ids' - 'entity_scope' - 'entity_scopes'
    || jsonb_build_object('entity_identifiers_included',false);
$$;

create or replace function public.it_intune_phase46_waive_ttl_hours()
returns integer
language sql
immutable
parallel safe
set search_path = public
as $$
  select 72;
$$;

create or replace function public.it_intune_phase46_min_composite_score()
returns numeric
language sql
immutable
parallel safe
set search_path = public
as $$
  select 0.8000::numeric;
$$;

-- ---------------------------------------------------------------------------
-- Dual-approver promote waive proposals (mutable status) + decisions
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_promote_waive_proposals (
  proposal_id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null
    references public.os_it_intune_threshold_recommendation_drafts(recommendation_id),
  proposed_by uuid not null,
  proposed_reason text not null,
  status text not null default 'proposed',
  proposed_at timestamptz not null default now(),
  expires_at timestamptz not null
    default (now() + make_interval(hours => 72)),
  row_version bigint not null default 0,
  evidence_sha256 text not null,
  constraint os_it_intune_p46_waive_status_check
    check (status in ('proposed','approved','rejected','expired')),
  constraint os_it_intune_p46_waive_reason_check
    check (length(trim(proposed_reason)) >= 20),
  constraint os_it_intune_p46_waive_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_it_intune_p46_waive_row_version_check
    check (row_version >= 0)
);

create unique index if not exists os_it_intune_p46_waive_open_uidx
  on public.os_it_intune_promote_waive_proposals(recommendation_id)
  where status = 'proposed';

create index if not exists os_it_intune_p46_waive_reco_status_idx
  on public.os_it_intune_promote_waive_proposals(
    recommendation_id, status, proposed_at desc);

create index if not exists os_it_intune_p46_waive_expires_idx
  on public.os_it_intune_promote_waive_proposals(expires_at)
  where status = 'proposed';

alter table public.os_it_intune_promote_waive_proposals
  enable row level security;

drop policy if exists "os_it_intune_p46_waive_select"
  on public.os_it_intune_promote_waive_proposals;
create policy "os_it_intune_p46_waive_select"
  on public.os_it_intune_promote_waive_proposals for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_promote_waive_proposals to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_promote_waive_proposals
  from public,authenticated;
grant insert,update on public.os_it_intune_promote_waive_proposals
  to service_role;
revoke delete,truncate on public.os_it_intune_promote_waive_proposals
  from service_role;

create table if not exists public.os_it_intune_promote_waive_decisions (
  decision_id uuid primary key default gen_random_uuid(),
  waive_proposal_id uuid not null
    references public.os_it_intune_promote_waive_proposals(proposal_id),
  decided_by uuid not null,
  decision text not null,
  statement text not null,
  decided_at timestamptz not null default now(),
  evidence_sha256 text not null,
  constraint os_it_intune_p46_waive_dec_check
    check (decision in ('approved','rejected')),
  constraint os_it_intune_p46_waive_dec_statement_check
    check (length(trim(statement)) >= 20),
  constraint os_it_intune_p46_waive_dec_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_it_intune_p46_waive_dec_unique
    unique (waive_proposal_id)
);

-- Dual-actor: decided_by must differ from proposed_by.
create or replace function public.enforce_it_intune_promote_waive_dual_actor()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_proposed_by uuid;
begin
  select proposed_by into v_proposed_by
  from public.os_it_intune_promote_waive_proposals
  where proposal_id = new.waive_proposal_id;
  if v_proposed_by is null then
    raise exception 'Phase 46 waive proposal not found for dual-approver check';
  end if;
  if new.decided_by = v_proposed_by then
    raise exception 'Phase 46 waive dual-approver required: decided_by must differ from proposed_by';
  end if;
  return new;
end;
$$;

drop trigger if exists os_it_intune_p46_waive_dual_actor
  on public.os_it_intune_promote_waive_decisions;
create trigger os_it_intune_p46_waive_dual_actor
  before insert on public.os_it_intune_promote_waive_decisions
  for each row execute function public.enforce_it_intune_promote_waive_dual_actor();

create index if not exists os_it_intune_p46_waive_dec_recorded_idx
  on public.os_it_intune_promote_waive_decisions(decided_at desc);

alter table public.os_it_intune_promote_waive_decisions
  enable row level security;

drop policy if exists "os_it_intune_p46_waive_dec_select"
  on public.os_it_intune_promote_waive_decisions;
create policy "os_it_intune_p46_waive_dec_select"
  on public.os_it_intune_promote_waive_decisions for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_promote_waive_decisions to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_promote_waive_decisions
  from public,authenticated;
grant insert on public.os_it_intune_promote_waive_decisions to service_role;
revoke update,delete,truncate on public.os_it_intune_promote_waive_decisions
  from service_role;

-- ---------------------------------------------------------------------------
-- Deeper postmortem quality scorecards (aggregate checklist only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_postmortem_quality_scorecards (
  scorecard_id uuid primary key default gen_random_uuid(),
  postmortem_id uuid not null
    references public.os_it_intune_outage_postmortems(postmortem_id),
  cycle_trend_component numeric(5,4) not null,
  correlation_coverage_component numeric(5,4) not null,
  root_cause_component numeric(5,4) not null,
  notes_quality_component numeric(5,4) not null,
  composite_score numeric(5,4) not null,
  checklist jsonb not null,
  cycle_complete_count integer not null default 0,
  correlation_event_kinds integer not null default 0,
  ready_for_tuning_promote boolean not null default false,
  evidence_sha256 text not null,
  bucket_key text,
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p46_sc_cycle_trend_check
    check (cycle_trend_component between 0 and 1),
  constraint os_it_intune_p46_sc_corr_check
    check (correlation_coverage_component between 0 and 1),
  constraint os_it_intune_p46_sc_root_check
    check (root_cause_component between 0 and 1),
  constraint os_it_intune_p46_sc_notes_check
    check (notes_quality_component between 0 and 1),
  constraint os_it_intune_p46_sc_composite_check
    check (composite_score between 0 and 1),
  constraint os_it_intune_p46_sc_cycles_check
    check (cycle_complete_count >= 0),
  constraint os_it_intune_p46_sc_kinds_check
    check (correlation_event_kinds >= 0),
  constraint os_it_intune_p46_sc_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_it_intune_p46_sc_bucket_check
    check (bucket_key is null
      or bucket_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$'),
  constraint os_it_intune_p46_sc_no_entity_leak check (
    not (checklist ? 'entity_id')
    and not (checklist ? 'entity_ids')
    and not (checklist ? 'entity_scope')
    and not (checklist ? 'entity_scopes')
    and coalesce((checklist->>'entity_identifiers_included')::boolean,false)=false
  ),
  constraint os_it_intune_p46_sc_bucket_unique
    unique (postmortem_id, bucket_key)
);

create index if not exists os_it_intune_p46_sc_pm_recorded_idx
  on public.os_it_intune_postmortem_quality_scorecards(
    postmortem_id, recorded_at desc, scorecard_id desc);

alter table public.os_it_intune_postmortem_quality_scorecards
  enable row level security;

drop policy if exists "os_it_intune_p46_sc_select"
  on public.os_it_intune_postmortem_quality_scorecards;
create policy "os_it_intune_p46_sc_select"
  on public.os_it_intune_postmortem_quality_scorecards for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_postmortem_quality_scorecards to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_postmortem_quality_scorecards
  from public,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Append-only Phase 46 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_phase46_ops_alerts (
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
  aggregate_evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null,
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p46_alert_kind_check
    check (alert_kind in (
      'waive_pending',
      'quality_score_low',
      'dual_approve_required'
    )),
  constraint os_it_intune_p46_alert_severity_check
    check (severity in ('warning','critical')),
  constraint os_it_intune_p46_alert_delivery_check
    check (delivery_status in
      ('delivered','skipped_no_webhook','failed','recorded')),
  constraint os_it_intune_p46_alert_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_it_intune_p46_alert_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  )
);

create index if not exists os_it_intune_p46_alert_kind_recorded_idx
  on public.os_it_intune_phase46_ops_alerts(alert_kind, recorded_at desc);

alter table public.os_it_intune_phase46_ops_alerts
  enable row level security;

drop policy if exists "os_it_intune_p46_alert_select"
  on public.os_it_intune_phase46_ops_alerts;
create policy "os_it_intune_p46_alert_select"
  on public.os_it_intune_phase46_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_phase46_ops_alerts to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_phase46_ops_alerts
  from public,authenticated,service_role;

create or replace function public.prevent_it_intune_phase46_ops_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'Phase 46 Intune resilience quality/waive evidence is append-only';
end;
$$;

drop trigger if exists os_it_intune_p46_sc_append_only
  on public.os_it_intune_postmortem_quality_scorecards;
create trigger os_it_intune_p46_sc_append_only
  before update or delete
  on public.os_it_intune_postmortem_quality_scorecards
  for each row execute function public.prevent_it_intune_phase46_ops_mutation();

drop trigger if exists os_it_intune_p46_sc_no_truncate
  on public.os_it_intune_postmortem_quality_scorecards;
create trigger os_it_intune_p46_sc_no_truncate
  before truncate
  on public.os_it_intune_postmortem_quality_scorecards
  for each statement execute function public.prevent_it_intune_phase46_ops_mutation();

drop trigger if exists os_it_intune_p46_waive_dec_append_only
  on public.os_it_intune_promote_waive_decisions;
create trigger os_it_intune_p46_waive_dec_append_only
  before update or delete
  on public.os_it_intune_promote_waive_decisions
  for each row execute function public.prevent_it_intune_phase46_ops_mutation();

drop trigger if exists os_it_intune_p46_waive_dec_no_truncate
  on public.os_it_intune_promote_waive_decisions;
create trigger os_it_intune_p46_waive_dec_no_truncate
  before truncate
  on public.os_it_intune_promote_waive_decisions
  for each statement execute function public.prevent_it_intune_phase46_ops_mutation();

drop trigger if exists os_it_intune_p46_alert_append_only
  on public.os_it_intune_phase46_ops_alerts;
create trigger os_it_intune_p46_alert_append_only
  before update or delete
  on public.os_it_intune_phase46_ops_alerts
  for each row execute function public.prevent_it_intune_phase46_ops_mutation();

drop trigger if exists os_it_intune_p46_alert_no_truncate
  on public.os_it_intune_phase46_ops_alerts;
create trigger os_it_intune_p46_alert_no_truncate
  before truncate
  on public.os_it_intune_phase46_ops_alerts
  for each statement execute function public.prevent_it_intune_phase46_ops_mutation();

-- ---------------------------------------------------------------------------
-- Helpers: expire stale proposals; active dual-approved waive lookup
-- ---------------------------------------------------------------------------
create or replace function public.expire_it_intune_promote_waive_proposals_phase46()
returns integer
language plpgsql security definer set search_path=public as $$
declare
  v_count integer:=0;
begin
  -- Never updates breaker rows and never calls reset/close RPCs.
  update public.os_it_intune_promote_waive_proposals
  set status='expired',
      row_version=row_version+1
  where status='proposed'
    and expires_at<=now();
  get diagnostics v_count=row_count;
  return coalesce(v_count,0);
end;
$$;

create or replace function public.get_it_intune_active_promote_waive_phase46(
  p_recommendation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public as $$
declare
  v_proposal public.os_it_intune_promote_waive_proposals%rowtype;
  v_decision public.os_it_intune_promote_waive_decisions%rowtype;
begin
  -- Observe-only lookup: expiration is applied by propose/review/accept/worker.
  if p_recommendation_id is null then
    return jsonb_build_object(
      'found',false,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    );
  end if;

  select p.* into v_proposal
  from public.os_it_intune_promote_waive_proposals p
  where p.recommendation_id=p_recommendation_id
    and p.status='approved'
    and p.expires_at>now()
  order by p.proposed_at desc, p.proposal_id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'found',false,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    );
  end if;

  select d.* into v_decision
  from public.os_it_intune_promote_waive_decisions d
  where d.waive_proposal_id=v_proposal.proposal_id
    and d.decision='approved'
  limit 1;

  if not found or v_decision.decided_by=v_proposal.proposed_by then
    return jsonb_build_object(
      'found',false,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    );
  end if;

  return jsonb_build_object(
    'found',true,
    'proposal_id',v_proposal.proposal_id,
    'recommendation_id',v_proposal.recommendation_id,
    'proposed_by',v_proposal.proposed_by,
    'decided_by',v_decision.decided_by,
    'decision_id',v_decision.decision_id,
    'status',v_proposal.status,
    'expires_at',v_proposal.expires_at,
    'evidence_sha256',v_proposal.evidence_sha256,
    'dual_approved',true,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Propose / review dual-approver promote waive
-- ---------------------------------------------------------------------------
create or replace function public.propose_it_intune_promote_waive_phase46(
  p_recommendation_id uuid,
  p_actor_id uuid,
  p_reason text,
  p_expected_row_version bigint default null
)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_reco public.os_it_intune_threshold_recommendation_drafts%rowtype;
  v_breaker public.os_it_intune_provider_breakers%rowtype;
  v_gate jsonb;
  v_evidence jsonb;
  v_hash text;
  v_proposal public.os_it_intune_promote_waive_proposals%rowtype;
  v_ttl integer:=public.it_intune_phase46_waive_ttl_hours();
begin
  -- Waive proposals never update breaker rows and never call reset/close RPCs.
  perform public.expire_it_intune_promote_waive_proposals_phase46();

  select * into v_reco
  from public.os_it_intune_threshold_recommendation_drafts
  where recommendation_id=p_recommendation_id;
  if not found then
    raise exception 'Phase 46 waive recommendation not found';
  end if;

  select * into v_breaker
  from public.os_it_intune_provider_breakers
  where breaker_id=v_reco.breaker_id;

  if v_reco.status<>'pending'
     or length(trim(coalesce(p_reason,'')))<20
     or not public.it_intune_manual_review_actor_allowed(
       p_actor_id,v_breaker.entity_id) then
    raise exception 'Phase 46 waive propose denied or recommendation not pending';
  end if;

  if exists (
    select 1 from public.os_it_intune_promote_waive_proposals p
    where p.recommendation_id=p_recommendation_id
      and p.status='proposed'
  ) then
    raise exception 'Phase 46 waive already proposed for this recommendation';
  end if;

  -- Prefer proposing when promote gate is blocked (exception path).
  v_gate:=public.get_it_intune_tuning_promote_gate_phase45(
    p_recommendation_id, null);
  if coalesce(v_gate->>'gate_status','blocked')='ready' then
    raise exception 'Phase 46 waive not needed when promote gate is ready';
  end if;

  v_evidence:=public.it_intune_phase46_sanitize_aggregate(jsonb_build_object(
    'evidence_version','phase46-v1',
    'waive_kind','promote_exception',
    'recommendation_id',p_recommendation_id,
    'gate_status',coalesce(v_gate->>'gate_status','blocked'),
    'proposed_by',p_actor_id,
    'ttl_hours',v_ttl,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  ));
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_it_intune_promote_waive_proposals(
    recommendation_id,proposed_by,proposed_reason,status,
    expires_at,evidence_sha256
  ) values (
    p_recommendation_id,p_actor_id,trim(p_reason),'proposed',
    now()+make_interval(hours => v_ttl),v_hash
  ) returning * into v_proposal;

  return jsonb_build_object(
    'proposal_id',v_proposal.proposal_id,
    'recommendation_id',v_proposal.recommendation_id,
    'status',v_proposal.status,
    'expires_at',v_proposal.expires_at,
    'row_version',v_proposal.row_version,
    'evidence_sha256',v_hash,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

create or replace function public.review_it_intune_promote_waive_phase46(
  p_proposal_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_statement text,
  p_expected_row_version bigint
)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_proposal public.os_it_intune_promote_waive_proposals%rowtype;
  v_reco public.os_it_intune_threshold_recommendation_drafts%rowtype;
  v_breaker public.os_it_intune_provider_breakers%rowtype;
  v_decision public.os_it_intune_promote_waive_decisions%rowtype;
  v_status text;
  v_evidence jsonb;
  v_hash text;
begin
  -- Dual-actor review never updates breaker rows and never calls reset/close RPCs.
  perform public.expire_it_intune_promote_waive_proposals_phase46();

  select * into v_proposal
  from public.os_it_intune_promote_waive_proposals
  where proposal_id=p_proposal_id
  for update;
  if not found then
    raise exception 'Phase 46 waive proposal not found';
  end if;

  select * into v_reco
  from public.os_it_intune_threshold_recommendation_drafts
  where recommendation_id=v_proposal.recommendation_id;
  select * into v_breaker
  from public.os_it_intune_provider_breakers
  where breaker_id=v_reco.breaker_id;

  if exists (
    select 1 from public.os_it_intune_promote_waive_decisions
    where waive_proposal_id=p_proposal_id
  ) then
    raise exception 'Phase 46 waive proposal already has an immutable decision';
  end if;

  if p_decision not in ('approve','reject')
     or v_proposal.status<>'proposed'
     or v_proposal.expires_at<=now()
     or v_proposal.proposed_by=p_actor_id
     or v_proposal.row_version<>p_expected_row_version
     or length(trim(coalesce(p_statement,'')))<20
     or not public.it_intune_manual_review_actor_allowed(
       p_actor_id,v_breaker.entity_id) then
    raise exception
      'Phase 46 independent waive review denied, stale, expired, or dual-approver required';
  end if;

  if p_decision='approve' then
    v_status:='approved';
  else
    v_status:='rejected';
  end if;

  v_evidence:=public.it_intune_phase46_sanitize_aggregate(jsonb_build_object(
    'evidence_version','phase46-v1',
    'waive_kind','promote_exception_decision',
    'proposal_id',p_proposal_id,
    'recommendation_id',v_proposal.recommendation_id,
    'decision',v_status,
    'proposed_by',v_proposal.proposed_by,
    'decided_by',p_actor_id,
    'dual_actor',true,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  ));
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_it_intune_promote_waive_decisions(
    waive_proposal_id,decided_by,decision,statement,evidence_sha256
  ) values (
    p_proposal_id,p_actor_id,v_status,trim(p_statement),v_hash
  ) returning * into v_decision;

  update public.os_it_intune_promote_waive_proposals
  set status=v_status,
      row_version=row_version+1
  where proposal_id=p_proposal_id
    and row_version=p_expected_row_version
    and status='proposed';
  if not found then
    raise exception 'Phase 46 waive proposal changed during review';
  end if;

  return jsonb_build_object(
    'decision_id',v_decision.decision_id,
    'proposal_id',p_proposal_id,
    'decision',v_status,
    'dual_approved',v_status='approved',
    'evidence_sha256',v_hash,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Deeper postmortem quality scoring (multi-cycle trends + correlation)
-- ---------------------------------------------------------------------------
create or replace function public.score_it_intune_postmortem_quality_phase46()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_pm record;
  v_bucket text;
  v_cycles integer;
  v_trend text;
  v_cycle_trend numeric(5,4);
  v_corr_kinds integer;
  v_corr_coverage numeric(5,4);
  v_root numeric(5,4);
  v_notes numeric(5,4);
  v_notes_len integer;
  v_published boolean;
  v_checklist jsonb;
  v_composite numeric(5,4);
  v_ready boolean;
  v_evidence jsonb;
  v_hash text;
  v_recorded integer:=0;
  v_skipped integer:=0;
  v_min_cycles integer:=public.it_intune_phase45_min_cycle_count();
  v_min_score numeric:=public.it_intune_phase46_min_composite_score();
  v_breaker uuid;
  v_expected_kinds integer:=4;
  v_notes_tier text;
begin
  -- Quality scorecards never update breaker rows and never call reset/close RPCs.
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
      select 1 from public.os_it_intune_postmortem_quality_scorecards s
      where s.postmortem_id=v_pm.postmortem_id
        and s.bucket_key=v_bucket
    ) then
      v_skipped:=v_skipped+1;
      continue;
    end if;

    select count(*) into v_cycles
    from public.os_it_intune_soak_cycle_evidence c
    where c.postmortem_id=v_pm.postmortem_id
      and c.cycle_status='cycle_complete';

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

    -- Multi-cycle trend component: cycles sufficiency + trend direction.
    if coalesce(v_cycles,0) >= v_min_cycles and v_trend='improving' then
      v_cycle_trend:=1.0000;
    elsif coalesce(v_cycles,0) >= v_min_cycles and v_trend='stable' then
      v_cycle_trend:=0.8500;
    elsif coalesce(v_cycles,0) >= v_min_cycles and v_trend='degrading' then
      v_cycle_trend:=0.2500;
    elsif coalesce(v_cycles,0) > 0 and v_trend in ('improving','stable') then
      v_cycle_trend:=0.5000;
    elsif coalesce(v_cycles,0) > 0 then
      v_cycle_trend:=0.3000;
    else
      v_cycle_trend:=0.0000;
    end if;

    -- Correlation coverage: distinct aggregate event families in timeline.
    v_corr_kinds:=0;
    if v_breaker is not null then
      select
        (select count(*) from (
          select 1 from public.os_it_intune_resilience_correlation_timeline t
          where t.breaker_id=v_breaker
            and t.occurred_at>=now()-interval '30 days'
            and t.event_kind like 'outage_%'
          limit 1
        ) o)
        +
        (select count(*) from (
          select 1 from public.os_it_intune_resilience_correlation_timeline t
          where t.breaker_id=v_breaker
            and t.occurred_at>=now()-interval '30 days'
            and t.event_kind like 'tuning_%'
          limit 1
        ) tu)
        +
        (select count(*) from (
          select 1 from public.os_it_intune_resilience_correlation_timeline t
          where t.breaker_id=v_breaker
            and t.occurred_at>=now()-interval '30 days'
            and t.event_kind='soak_cycle_complete'
          limit 1
        ) s)
        +
        (select count(*) from (
          select 1 from public.os_it_intune_resilience_correlation_timeline t
          where t.breaker_id=v_breaker
            and t.occurred_at>=now()-interval '30 days'
            and (
              t.event_kind like 'health_%'
              or t.event_kind='config_performance_snapshot'
            )
          limit 1
        ) h)
      into v_corr_kinds;
    end if;
    v_corr_coverage:=round(
      least(coalesce(v_corr_kinds,0),v_expected_kinds)::numeric
        / v_expected_kinds::numeric
    , 4);

    v_published:=v_pm.status='published';
    if v_pm.root_cause_class is not null
       and v_pm.root_cause_class<>'unknown' then
      v_root:=1.0000;
    else
      v_root:=0.0000;
    end if;

    v_notes_len:=length(trim(coalesce(v_pm.blameless_notes,'')));
    if v_notes_len >= 80 then
      v_notes:=1.0000;
      v_notes_tier:='strong';
    elsif v_notes_len >= 40 then
      v_notes:=0.7500;
      v_notes_tier:='good';
    elsif v_notes_len >= 20 then
      v_notes:=0.5000;
      v_notes_tier:='minimal';
    else
      v_notes:=0.0000;
      v_notes_tier:='missing';
    end if;

    v_composite:=round((
      v_cycle_trend
      + v_corr_coverage
      + v_root
      + v_notes
    ) / 4.0, 4);

    v_ready:=v_published
      and v_root >= 1.0000
      and v_notes >= 0.5000
      and v_cycle_trend >= 0.8500
      and v_corr_coverage >= 0.5000
      and v_composite >= v_min_score;

    v_checklist:=public.it_intune_phase46_sanitize_aggregate(jsonb_build_object(
      'postmortem_published',v_published,
      'root_cause_set',v_root>=1.0000,
      'notes_quality_tier',v_notes_tier,
      'cycle_complete_count',coalesce(v_cycles,0),
      'min_cycle_count',v_min_cycles,
      'failure_rate_trend',v_trend,
      'cycle_trend_component',v_cycle_trend,
      'correlation_event_kinds',coalesce(v_corr_kinds,0),
      'correlation_expected_kinds',v_expected_kinds,
      'correlation_coverage_component',v_corr_coverage,
      'root_cause_component',v_root,
      'notes_quality_component',v_notes,
      'composite_score',v_composite,
      'ready_for_tuning_promote',v_ready,
      'entity_identifiers_included',false
    ));

    v_evidence:=public.it_intune_phase46_sanitize_aggregate(jsonb_build_object(
      'evidence_version','phase46-v1',
      'review_kind','postmortem_quality_scorecard',
      'postmortem_id',v_pm.postmortem_id,
      'cycle_trend_component',v_cycle_trend,
      'correlation_coverage_component',v_corr_coverage,
      'root_cause_component',v_root,
      'notes_quality_component',v_notes,
      'composite_score',v_composite,
      'checklist',v_checklist,
      'ready_for_tuning_promote',v_ready,
      'bucket_key',v_bucket,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    ));
    v_hash:=public.os_sha256_hex(v_evidence::text);

    insert into public.os_it_intune_postmortem_quality_scorecards(
      postmortem_id,cycle_trend_component,correlation_coverage_component,
      root_cause_component,notes_quality_component,composite_score,
      checklist,cycle_complete_count,correlation_event_kinds,
      ready_for_tuning_promote,evidence_sha256,bucket_key
    ) values (
      v_pm.postmortem_id,v_cycle_trend,v_corr_coverage,
      v_root,v_notes,v_composite,
      v_checklist,coalesce(v_cycles,0),coalesce(v_corr_kinds,0),
      v_ready,v_hash,v_bucket
    );
    v_recorded:=v_recorded+1;
  end loop;

  return jsonb_build_object(
    'scorecards_recorded',v_recorded,
    'skipped',v_skipped,
    'bucket_key',v_bucket,
    'min_composite_score',v_min_score,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Promote gate eval: ready as phase45; waived only with dual-approved waive
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_it_intune_tuning_promote_gate_phase46(
  p_recommendation_id uuid default null,
  p_proposal_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_p45 jsonb;
  v_target record;
  v_bucket text;
  v_waive jsonb;
  v_score_ready boolean;
  v_status text;
  v_reasons jsonb;
  v_cycles integer;
  v_trend text;
  v_evidence jsonb;
  v_hash text;
  v_gate_id uuid;
  v_waived integer:=0;
  v_recorded integer:=0;
  v_min_cycles integer:=public.it_intune_phase45_min_cycle_count();
begin
  -- Promote gates never update breaker rows and never call reset/close RPCs.
  perform public.expire_it_intune_promote_waive_proposals_phase46();
  v_p45:=public.evaluate_it_intune_tuning_promote_gate_phase45(
    p_recommendation_id, p_proposal_id);
  v_bucket:=to_char(date_trunc('hour',now()),'YYYYMMDD"T"HH24')||':p46';

  for v_target in
    select d.recommendation_id,d.resulting_proposal_id as proposal_id,
      d.breaker_id,d.postmortem_id,d.status as reco_status
    from public.os_it_intune_threshold_recommendation_drafts d
    where (p_recommendation_id is null or d.recommendation_id=p_recommendation_id)
      and d.status='pending'
    order by d.generated_at desc
    limit 100
  loop
    if exists (
      select 1 from public.os_it_intune_tuning_promote_gates g
      where g.recommendation_id=v_target.recommendation_id
        and g.bucket_key=v_bucket
    ) then
      continue;
    end if;

    v_waive:=public.get_it_intune_active_promote_waive_phase46(
      v_target.recommendation_id);

    select count(*) into v_cycles
    from public.os_it_intune_soak_cycle_evidence c
    where c.breaker_id=v_target.breaker_id
      and c.cycle_status='cycle_complete';
    v_trend:=public.it_intune_phase45_failure_rate_trend(v_target.breaker_id);

    v_score_ready:=false;
    if v_target.postmortem_id is not null then
      select s.ready_for_tuning_promote into v_score_ready
      from public.os_it_intune_postmortem_quality_scorecards s
      where s.postmortem_id=v_target.postmortem_id
      order by s.recorded_at desc, s.scorecard_id desc
      limit 1;
      if not found then
        v_score_ready:=false;
      end if;
    else
      v_score_ready:=true;
    end if;

    v_reasons:='[]'::jsonb;
    if coalesce((v_waive->>'found')::boolean,false) then
      v_status:='waived';
      v_reasons:=jsonb_build_array(jsonb_build_object(
        'code','dual_approved_waive',
        'waive_proposal_id',v_waive->>'proposal_id'
      ));
      v_waived:=v_waived+1;
    else
      if coalesce(v_cycles,0) < v_min_cycles then
        v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object(
          'code','insufficient_multi_cycles',
          'multi_cycle_count',coalesce(v_cycles,0),
          'min_cycle_count',v_min_cycles
        ));
      end if;
      if v_trend not in ('improving','stable') then
        v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object(
          'code','trend_unhealthy',
          'failure_rate_trend',v_trend
        ));
      end if;
      if v_target.postmortem_id is not null and not coalesce(v_score_ready,false) then
        v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object(
          'code','postmortem_scorecard_not_ready'
        ));
      end if;
      if jsonb_array_length(v_reasons)=0 then
        v_status:='ready';
      else
        v_status:='blocked';
        v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object(
          'code','dual_approve_required'
        ));
      end if;
    end if;

    v_evidence:=public.it_intune_phase46_sanitize_aggregate(jsonb_build_object(
      'evidence_version','phase46-v1',
      'gate_kind','tuning_promote',
      'recommendation_id',v_target.recommendation_id,
      'proposal_id',v_target.proposal_id,
      'breaker_id',v_target.breaker_id,
      'gate_status',v_status,
      'block_reasons',v_reasons,
      'multi_cycle_count',coalesce(v_cycles,0),
      'failure_rate_trend',v_trend,
      'scorecard_ready',coalesce(v_score_ready,false),
      'dual_approved_waive',coalesce((v_waive->>'found')::boolean,false),
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
  end loop;

  return jsonb_build_object(
    'gates_recorded',v_recorded,
    'waived_recorded',v_waived,
    'bucket_key',v_bucket,
    'phase45',jsonb_build_object(
      'gates_recorded',v_p45->'gates_recorded',
      'skipped',v_p45->'skipped'
    ),
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

create or replace function public.get_it_intune_tuning_promote_gate_phase46(
  p_recommendation_id uuid default null,
  p_proposal_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public as $$
declare
  v_gate jsonb;
  v_waive jsonb;
begin
  v_gate:=public.get_it_intune_tuning_promote_gate_phase45(
    p_recommendation_id, p_proposal_id);
  if p_recommendation_id is not null then
    v_waive:=public.get_it_intune_active_promote_waive_phase46(
      p_recommendation_id);
    if coalesce((v_waive->>'found')::boolean,false) then
      return coalesce(v_gate,'{}'::jsonb) || jsonb_build_object(
        'gate_status','waived',
        'dual_approved_waive',true,
        'waive_proposal_id',v_waive->>'proposal_id',
        'phase46',true,
        'closes_or_resets_breaker',false,
        'entity_identifiers_included',false
      );
    end if;
  end if;
  return coalesce(v_gate,'{}'::jsonb) || jsonb_build_object(
    'dual_approved_waive',false,
    'phase46',true,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

-- Accept wraps Phase 45 accept path with dual-approver waive audit.
-- Ready still works as phase45; waived only valid with dual-approved waive.
create or replace function public.accept_it_intune_threshold_recommendation_phase46(
  p_recommendation_id uuid,p_actor_id uuid,p_reason text,
  p_expected_breaker_version bigint,p_expected_row_version bigint
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_eval jsonb;
  v_gate jsonb;
  v_status text;
  v_waive jsonb;
  v_result jsonb;
  v_waive_audit boolean:=false;
begin
  -- Accept never closes/resets breakers beyond existing Phase 41 accept path
  -- (same underlying path Phase 45 wraps after its gate check).
  perform public.expire_it_intune_promote_waive_proposals_phase46();
  v_eval:=public.evaluate_it_intune_tuning_promote_gate_phase46(
    p_recommendation_id, null);
  v_gate:=public.get_it_intune_tuning_promote_gate_phase46(
    p_recommendation_id, null);
  v_status:=coalesce(v_gate->>'gate_status','blocked');
  v_waive:=public.get_it_intune_active_promote_waive_phase46(
    p_recommendation_id);

  if v_status='ready' then
    v_waive_audit:=false;
  elsif v_status='waived'
     and coalesce((v_waive->>'found')::boolean,false) then
    -- Waived status only valid with dual-approved, non-expired waive.
    if v_waive->>'proposed_by' is null
       or v_waive->>'decided_by' is null
       or (v_waive->>'proposed_by')=(v_waive->>'decided_by') then
      raise exception
        'Phase 46 waived promote requires dual-approver audit (proposer ≠ second approver)';
    end if;
    v_waive_audit:=true;
  else
    raise exception
      'Phase 46 tuning promote gate blocked: need ready scorecard or dual-approved waive';
  end if;

  -- Phase 46 gate is authoritative; call the same underlying accept Phase 45
  -- wraps so a later Phase 45 hour-bucket evaluate cannot re-block waived.
  v_result:=public.accept_it_intune_threshold_recommendation(
    p_recommendation_id,p_actor_id,p_reason,
    p_expected_breaker_version,p_expected_row_version
  );

  return v_result || jsonb_build_object(
    'phase46_gate_status',v_status,
    'phase46_waive_audit',v_waive_audit,
    'waive_proposal_id',v_waive->>'proposal_id',
    'phase45_wrapped',true,
    'phase46_eval',jsonb_build_object(
      'gates_recorded',v_eval->'gates_recorded',
      'waived_recorded',v_eval->'waived_recorded',
      'closes_or_resets_breaker',false
    ),
    'closes_or_resets_breaker',false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Critical windows + alert recording
-- ---------------------------------------------------------------------------
create or replace function public.list_it_intune_phase46_critical_windows(
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
begin
  perform public.expire_it_intune_promote_waive_proposals_phase46();

  v_bucket:=to_char(
    to_timestamp(
      (floor(extract(epoch from now())/(v_hours*3600.0))
        *(v_hours*3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','waive_pending',
      'window_key','waivepend:'||p.proposal_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','warning',
      'recommendation_id',p.recommendation_id,
      'waive_proposal_id',p.proposal_id
    ) order by p.proposed_at desc)
    from public.os_it_intune_promote_waive_proposals p
    where p.status='proposed'
      and p.expires_at>now()
      and not exists (
        select 1 from public.os_it_intune_phase46_ops_alerts x
        where x.window_key=
          'waivepend:'||p.proposal_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 25
  ), '[]'::jsonb) into v_part;
  v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','quality_score_low',
      'window_key','pmscore:'||r.postmortem_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','warning',
      'postmortem_id',r.postmortem_id,
      'composite_score',r.composite_score
    ) order by r.recorded_at desc)
    from (
      select s.postmortem_id,s.composite_score,s.recorded_at,
        row_number() over (
          partition by s.postmortem_id
          order by s.recorded_at desc, s.scorecard_id desc
        ) rn
      from public.os_it_intune_postmortem_quality_scorecards s
      where s.recorded_at>=now()-interval '24 hours'
        and s.composite_score < 0.6000
    ) r
    where r.rn=1
      and not exists (
        select 1 from public.os_it_intune_phase46_ops_alerts x
        where x.window_key=
          'pmscore:'||r.postmortem_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 25
  ), '[]'::jsonb) into v_part;
  v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','dual_approve_required',
      'window_key','dualreq:'||g.recommendation_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','warning',
      'recommendation_id',g.recommendation_id
    ) order by g.recorded_at desc)
    from (
      select t.recommendation_id,t.recorded_at,
        row_number() over (
          partition by t.recommendation_id
          order by t.recorded_at desc, t.gate_id desc
        ) rn
      from public.os_it_intune_tuning_promote_gates t
      where t.recorded_at>=now()-interval '24 hours'
        and t.gate_status='blocked'
        and t.recommendation_id is not null
        and not exists (
          select 1 from public.os_it_intune_promote_waive_proposals w
          where w.recommendation_id=t.recommendation_id
            and w.status in ('proposed','approved')
            and w.expires_at>now()
        )
    ) g
    where g.rn=1
      and not exists (
        select 1 from public.os_it_intune_phase46_ops_alerts x
        where x.window_key=
          'dualreq:'||g.recommendation_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 25
  ), '[]'::jsonb) into v_part;
  v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);

  return jsonb_build_object(
    'version','phase46-v1',
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',coalesce(v_pending,'[]'::jsonb),
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

create or replace function public.record_it_intune_phase46_ops_alert(p_alert jsonb)
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
  v_evidence jsonb;
  v_hash text;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_alert,'{}'::jsonb))<>'object' then
    raise exception 'Phase 46 ops alert payload must be a JSON object';
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

  if v_kind not in (
      'waive_pending','quality_score_low','dual_approve_required')
    or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
    or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
    or v_delivery not in
      ('delivered','skipped_no_webhook','failed','recorded')
    or v_severity not in ('warning','critical') then
    raise exception 'Phase 46 ops alert contract is invalid';
  end if;

  v_evidence:=public.it_intune_phase46_sanitize_aggregate(
    coalesce(p_alert->'aggregate_evidence','{}'::jsonb)
    || jsonb_build_object(
      'evidence_version','phase46-v1',
      'alert_kind',v_kind,
      'window_key',v_window,
      'severity',v_severity,
      'destination_key',v_dest,
      'delivery_status',v_delivery,
      'response_code',v_code,
      'recommendation_id',v_reco,
      'waive_proposal_id',v_waive,
      'postmortem_id',v_pm,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    )
  );
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_it_intune_phase46_ops_alerts(
    alert_kind,window_key,severity,destination_key,delivery_status,
    response_code,recommendation_id,waive_proposal_id,postmortem_id,
    aggregate_evidence,evidence_sha256
  ) values (
    v_kind,v_window,v_severity,v_dest,v_delivery,v_code,
    v_reco,v_waive,v_pm,v_evidence,v_hash
  )
  on conflict (window_key) do nothing
  returning alert_id into v_id;

  if v_id is null then
    select alert_id into v_id
    from public.os_it_intune_phase46_ops_alerts
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
create or replace view public.os_it_intune_phase46_health
with (security_invoker=true) as
select
  (select count(*) from public.os_it_intune_postmortem_quality_scorecards)
    as scorecard_count,
  (select count(*) from public.os_it_intune_postmortem_quality_scorecards
    where ready_for_tuning_promote) as scorecard_ready_count,
  (select count(*) from public.os_it_intune_postmortem_quality_scorecards
    where composite_score < 0.6000
      and recorded_at>=now()-interval '7 days') as quality_score_low_7d,
  (select count(*) from public.os_it_intune_promote_waive_proposals
    where status='proposed' and expires_at>now()) as waive_pending_count,
  (select count(*) from public.os_it_intune_promote_waive_proposals
    where status='approved') as waive_approved_count,
  (select count(*) from public.os_it_intune_promote_waive_decisions)
    as waive_decision_count,
  (select count(*) from public.os_it_intune_phase46_ops_alerts)
    as ops_alert_count,
  (select count(*) from public.os_it_intune_phase46_ops_alerts
    where delivery_status='delivered') as alerts_delivered_count,
  (select count(*) from public.os_it_intune_phase46_ops_alerts
    where delivery_status in ('failed','skipped_no_webhook'))
    as alerts_undelivered_count,
  (select count(*) from public.os_it_intune_phase46_ops_alerts
    where alert_kind='dual_approve_required'
      and recorded_at>=now()-interval '7 days') as dual_approve_required_7d;
grant select on public.os_it_intune_phase46_health to authenticated;

create or replace view public.os_it_intune_postmortem_quality_scorecard_status
with (security_invoker=true) as
select distinct on (s.postmortem_id)
  s.scorecard_id,s.postmortem_id,
  s.cycle_trend_component,s.correlation_coverage_component,
  s.root_cause_component,s.notes_quality_component,s.composite_score,
  s.checklist,s.cycle_complete_count,s.correlation_event_kinds,
  s.ready_for_tuning_promote,s.evidence_sha256,s.recorded_at,
  p.status as postmortem_status,p.root_cause_class
from public.os_it_intune_postmortem_quality_scorecards s
join public.os_it_intune_outage_postmortems p
  on p.postmortem_id=s.postmortem_id
order by s.postmortem_id, s.recorded_at desc, s.scorecard_id desc;
grant select on public.os_it_intune_postmortem_quality_scorecard_status
  to authenticated;

create or replace view public.os_it_intune_promote_waive_status
with (security_invoker=true) as
select distinct on (w.recommendation_id)
  w.proposal_id,w.recommendation_id,w.proposed_by,w.proposed_reason,
  w.status,w.proposed_at,w.expires_at,w.row_version,w.evidence_sha256,
  d.decision_id,d.decided_by,d.decision as decision_status,d.decided_at,
  r.status as recommendation_status,r.breaker_id,r.postmortem_id
from public.os_it_intune_promote_waive_proposals w
join public.os_it_intune_threshold_recommendation_drafts r
  on r.recommendation_id=w.recommendation_id
left join public.os_it_intune_promote_waive_decisions d
  on d.waive_proposal_id=w.proposal_id
order by w.recommendation_id, w.proposed_at desc, w.proposal_id desc;
grant select on public.os_it_intune_promote_waive_status to authenticated;

create or replace function public.get_it_intune_phase46_ops_report()
returns jsonb
language plpgsql
stable
security definer
set search_path=public as $$
declare
  v_health jsonb;
  v_scorecards jsonb;
  v_waives jsonb;
  v_alerts jsonb;
begin
  select jsonb_build_object(
    'scorecard_count',scorecard_count,
    'scorecard_ready_count',scorecard_ready_count,
    'quality_score_low_7d',quality_score_low_7d,
    'waive_pending_count',waive_pending_count,
    'waive_approved_count',waive_approved_count,
    'waive_decision_count',waive_decision_count,
    'ops_alert_count',ops_alert_count,
    'alerts_delivered_count',alerts_delivered_count,
    'alerts_undelivered_count',alerts_undelivered_count,
    'dual_approve_required_7d',dual_approve_required_7d,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  ) into v_health
  from public.os_it_intune_phase46_health;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_scorecards
  from (
    select s.scorecard_id,s.postmortem_id,s.cycle_trend_component,
      s.correlation_coverage_component,s.root_cause_component,
      s.notes_quality_component,s.composite_score,s.cycle_complete_count,
      s.correlation_event_kinds,s.ready_for_tuning_promote,
      s.evidence_sha256,s.recorded_at
    from public.os_it_intune_postmortem_quality_scorecards s
    order by s.recorded_at desc
    limit 50
  ) x;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.proposed_at desc),
    '[]'::jsonb)
  into v_waives
  from (
    select w.proposal_id,w.recommendation_id,w.status,w.proposed_by,
      w.expires_at,w.row_version,w.evidence_sha256,w.proposed_at
    from public.os_it_intune_promote_waive_proposals w
    order by w.proposed_at desc
    limit 50
  ) x;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_alerts
  from (
    select a.alert_id,a.alert_kind,a.window_key,a.severity,a.destination_key,
      a.delivery_status,a.response_code,a.recommendation_id,
      a.waive_proposal_id,a.postmortem_id,a.evidence_sha256,a.recorded_at
    from public.os_it_intune_phase46_ops_alerts a
    order by a.recorded_at desc
    limit 50
  ) x;

  return coalesce(v_health,'{}'::jsonb) || jsonb_build_object(
    'version','phase46-v1',
    'scorecards',v_scorecards,
    'waive_proposals',v_waives,
    'ops_alerts',v_alerts,
    'min_composite_score',public.it_intune_phase46_min_composite_score(),
    'waive_ttl_hours',public.it_intune_phase46_waive_ttl_hours()
  );
end;
$$;

revoke all on function public.it_intune_phase46_sanitize_aggregate(jsonb)
  from public,authenticated,service_role;
revoke all on function public.it_intune_phase46_waive_ttl_hours()
  from public,authenticated,service_role;
revoke all on function public.it_intune_phase46_min_composite_score()
  from public,authenticated,service_role;
revoke all on function public.expire_it_intune_promote_waive_proposals_phase46()
  from public,authenticated;
revoke all on function public.get_it_intune_active_promote_waive_phase46(uuid)
  from public,authenticated;
revoke all on function public.propose_it_intune_promote_waive_phase46(
  uuid,uuid,text,bigint) from public,authenticated;
revoke all on function public.review_it_intune_promote_waive_phase46(
  uuid,uuid,text,text,bigint) from public,authenticated;
revoke all on function public.score_it_intune_postmortem_quality_phase46()
  from public,authenticated;
revoke all on function public.evaluate_it_intune_tuning_promote_gate_phase46(
  uuid,uuid) from public,authenticated;
revoke all on function public.get_it_intune_tuning_promote_gate_phase46(
  uuid,uuid) from public,authenticated;
revoke all on function public.accept_it_intune_threshold_recommendation_phase46(
  uuid,uuid,text,bigint,bigint) from public,authenticated;
revoke all on function public.list_it_intune_phase46_critical_windows(integer)
  from public,authenticated;
revoke all on function public.record_it_intune_phase46_ops_alert(jsonb)
  from public,authenticated;
revoke all on function public.get_it_intune_phase46_ops_report()
  from public,authenticated;
revoke all on function public.enforce_it_intune_promote_waive_dual_actor()
  from public,authenticated,service_role;

grant execute on function public.score_it_intune_postmortem_quality_phase46(),
  public.evaluate_it_intune_tuning_promote_gate_phase46(uuid,uuid),
  public.get_it_intune_tuning_promote_gate_phase46(uuid,uuid),
  public.accept_it_intune_threshold_recommendation_phase46(
    uuid,uuid,text,bigint,bigint),
  public.propose_it_intune_promote_waive_phase46(uuid,uuid,text,bigint),
  public.review_it_intune_promote_waive_phase46(uuid,uuid,text,text,bigint),
  public.list_it_intune_phase46_critical_windows(integer),
  public.record_it_intune_phase46_ops_alert(jsonb),
  public.get_it_intune_phase46_ops_report(),
  public.get_it_intune_active_promote_waive_phase46(uuid),
  public.expire_it_intune_promote_waive_proposals_phase46()
  to service_role;

grant execute on function public.get_it_intune_tuning_promote_gate_phase46(
  uuid,uuid),
  public.list_it_intune_phase46_critical_windows(integer),
  public.get_it_intune_phase46_ops_report(),
  public.evaluate_it_intune_tuning_promote_gate_phase46(uuid,uuid),
  public.get_it_intune_active_promote_waive_phase46(uuid),
  public.propose_it_intune_promote_waive_phase46(uuid,uuid,text,bigint),
  public.review_it_intune_promote_waive_phase46(uuid,uuid,text,text,bigint)
  to authenticated;

grant execute on function public.it_intune_phase46_waive_ttl_hours(),
  public.it_intune_phase46_min_composite_score()
  to authenticated, service_role;
