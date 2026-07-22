-- Phase 47: Intune dual-approver waive expiry (extend/expire) + scorecard↔
-- outage MTTR correlation from soak cycle evidence.
-- Apply after phase46_intune_resilience_ops.sql.
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

create or replace function public.it_intune_phase47_sanitize_aggregate(p_evidence jsonb)
returns jsonb
language sql immutable set search_path=public as $$
  select coalesce(p_evidence,'{}'::jsonb)
    - 'entity_id' - 'entity_ids' - 'entity_scope' - 'entity_scopes'
    || jsonb_build_object('entity_identifiers_included',false);
$$;

create or replace function public.it_intune_phase47_mttr_baseline_minutes()
returns integer
language sql
immutable
parallel safe
set search_path = public
as $$
  select 480;
$$;

create or replace function public.it_intune_phase47_mttr_mismatch_threshold()
returns numeric
language sql
immutable
parallel safe
set search_path = public
as $$
  select 0.2500::numeric;
$$;

create or replace function public.it_intune_phase47_extend_max_hours()
returns integer
language sql
immutable
parallel safe
set search_path = public
as $$
  select 168;
$$;

-- ---------------------------------------------------------------------------
-- Dual-approver waive expiry proposals (extend TTL / expire) + decisions
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_promote_waive_expiry_proposals (
  expiry_proposal_id uuid primary key default gen_random_uuid(),
  waive_proposal_id uuid not null
    references public.os_it_intune_promote_waive_proposals(proposal_id),
  action text not null,
  proposed_by uuid not null,
  proposed_reason text not null,
  new_expires_at timestamptz,
  status text not null default 'proposed',
  proposed_at timestamptz not null default now(),
  row_version bigint not null default 0,
  aggregate_evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null,
  constraint os_it_intune_p47_expiry_action_check
    check (action in ('extend','expire')),
  constraint os_it_intune_p47_expiry_status_check
    check (status in ('proposed','approved','rejected')),
  constraint os_it_intune_p47_expiry_reason_check
    check (length(trim(proposed_reason)) >= 20),
  constraint os_it_intune_p47_expiry_extend_expires_check
    check (
      (action = 'extend' and new_expires_at is not null)
      or (action = 'expire' and new_expires_at is null)
    ),
  constraint os_it_intune_p47_expiry_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_it_intune_p47_expiry_row_version_check
    check (row_version >= 0),
  constraint os_it_intune_p47_expiry_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  )
);

create unique index if not exists os_it_intune_p47_expiry_open_uidx
  on public.os_it_intune_promote_waive_expiry_proposals(waive_proposal_id)
  where status = 'proposed';

create index if not exists os_it_intune_p47_expiry_waive_status_idx
  on public.os_it_intune_promote_waive_expiry_proposals(
    waive_proposal_id, status, proposed_at desc);

alter table public.os_it_intune_promote_waive_expiry_proposals
  enable row level security;

drop policy if exists "os_it_intune_p47_expiry_select"
  on public.os_it_intune_promote_waive_expiry_proposals;
create policy "os_it_intune_p47_expiry_select"
  on public.os_it_intune_promote_waive_expiry_proposals for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_promote_waive_expiry_proposals to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_promote_waive_expiry_proposals
  from public,authenticated;
grant insert,update on public.os_it_intune_promote_waive_expiry_proposals
  to service_role;
revoke delete,truncate on public.os_it_intune_promote_waive_expiry_proposals
  from service_role;

create table if not exists public.os_it_intune_promote_waive_expiry_decisions (
  decision_id uuid primary key default gen_random_uuid(),
  expiry_proposal_id uuid not null
    references public.os_it_intune_promote_waive_expiry_proposals(expiry_proposal_id),
  decided_by uuid not null,
  decision text not null,
  statement text not null,
  decided_at timestamptz not null default now(),
  evidence_sha256 text not null,
  constraint os_it_intune_p47_expiry_dec_check
    check (decision in ('approved','rejected')),
  constraint os_it_intune_p47_expiry_dec_statement_check
    check (length(trim(statement)) >= 20),
  constraint os_it_intune_p47_expiry_dec_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_it_intune_p47_expiry_dec_unique
    unique (expiry_proposal_id)
);

-- Dual-actor: decided_by must differ from proposed_by.
create or replace function public.enforce_it_intune_promote_waive_expiry_dual_actor()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_proposed_by uuid;
begin
  select proposed_by into v_proposed_by
  from public.os_it_intune_promote_waive_expiry_proposals
  where expiry_proposal_id = new.expiry_proposal_id;
  if v_proposed_by is null then
    raise exception 'Phase 47 waive expiry proposal not found for dual-approver check';
  end if;
  if new.decided_by = v_proposed_by then
    raise exception
      'Phase 47 waive expiry dual-approver required: decided_by must differ from proposed_by';
  end if;
  return new;
end;
$$;

drop trigger if exists os_it_intune_p47_expiry_dual_actor
  on public.os_it_intune_promote_waive_expiry_decisions;
create trigger os_it_intune_p47_expiry_dual_actor
  before insert on public.os_it_intune_promote_waive_expiry_decisions
  for each row execute function public.enforce_it_intune_promote_waive_expiry_dual_actor();

create index if not exists os_it_intune_p47_expiry_dec_recorded_idx
  on public.os_it_intune_promote_waive_expiry_decisions(decided_at desc);

alter table public.os_it_intune_promote_waive_expiry_decisions
  enable row level security;

drop policy if exists "os_it_intune_p47_expiry_dec_select"
  on public.os_it_intune_promote_waive_expiry_decisions;
create policy "os_it_intune_p47_expiry_dec_select"
  on public.os_it_intune_promote_waive_expiry_decisions for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_promote_waive_expiry_decisions to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_promote_waive_expiry_decisions
  from public,authenticated;
grant insert on public.os_it_intune_promote_waive_expiry_decisions to service_role;
revoke update,delete,truncate on public.os_it_intune_promote_waive_expiry_decisions
  from service_role;

-- ---------------------------------------------------------------------------
-- Scorecard ↔ soak-cycle MTTR correlations (aggregate-only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_scorecard_mttr_correlations (
  correlation_id uuid primary key default gen_random_uuid(),
  postmortem_id uuid not null
    references public.os_it_intune_outage_postmortems(postmortem_id),
  scorecard_id uuid not null
    references public.os_it_intune_postmortem_quality_scorecards(scorecard_id),
  cycle_elapsed_minutes integer not null,
  composite_score numeric(5,4) not null,
  correlation_delta numeric(5,4) not null,
  aggregate_evidence jsonb not null,
  evidence_sha256 text not null,
  bucket_key text,
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p47_mttr_elapsed_check
    check (cycle_elapsed_minutes >= 0),
  constraint os_it_intune_p47_mttr_score_check
    check (composite_score between 0 and 1),
  constraint os_it_intune_p47_mttr_delta_check
    check (correlation_delta between -1 and 1),
  constraint os_it_intune_p47_mttr_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_it_intune_p47_mttr_bucket_check
    check (bucket_key is null
      or bucket_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$'),
  constraint os_it_intune_p47_mttr_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  ),
  constraint os_it_intune_p47_mttr_bucket_unique
    unique (scorecard_id, bucket_key)
);

create index if not exists os_it_intune_p47_mttr_pm_recorded_idx
  on public.os_it_intune_scorecard_mttr_correlations(
    postmortem_id, recorded_at desc, correlation_id desc);

alter table public.os_it_intune_scorecard_mttr_correlations
  enable row level security;

drop policy if exists "os_it_intune_p47_mttr_select"
  on public.os_it_intune_scorecard_mttr_correlations;
create policy "os_it_intune_p47_mttr_select"
  on public.os_it_intune_scorecard_mttr_correlations for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_scorecard_mttr_correlations to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_scorecard_mttr_correlations
  from public,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Append-only Phase 47 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_phase47_ops_alerts (
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
  expiry_proposal_id uuid
    references public.os_it_intune_promote_waive_expiry_proposals(expiry_proposal_id),
  postmortem_id uuid
    references public.os_it_intune_outage_postmortems(postmortem_id),
  scorecard_id uuid
    references public.os_it_intune_postmortem_quality_scorecards(scorecard_id),
  aggregate_evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null,
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p47_alert_kind_check
    check (alert_kind in (
      'waive_expiry_pending',
      'mttr_score_mismatch',
      'waive_expired'
    )),
  constraint os_it_intune_p47_alert_severity_check
    check (severity in ('warning','critical')),
  constraint os_it_intune_p47_alert_delivery_check
    check (delivery_status in
      ('delivered','skipped_no_webhook','failed','recorded')),
  constraint os_it_intune_p47_alert_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_it_intune_p47_alert_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  )
);

create index if not exists os_it_intune_p47_alert_kind_recorded_idx
  on public.os_it_intune_phase47_ops_alerts(alert_kind, recorded_at desc);

alter table public.os_it_intune_phase47_ops_alerts
  enable row level security;

drop policy if exists "os_it_intune_p47_alert_select"
  on public.os_it_intune_phase47_ops_alerts;
create policy "os_it_intune_p47_alert_select"
  on public.os_it_intune_phase47_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_phase47_ops_alerts to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_phase47_ops_alerts
  from public,authenticated,service_role;

create or replace function public.prevent_it_intune_phase47_ops_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'Phase 47 Intune resilience expiry/MTTR evidence is append-only';
end;
$$;

drop trigger if exists os_it_intune_p47_mttr_append_only
  on public.os_it_intune_scorecard_mttr_correlations;
create trigger os_it_intune_p47_mttr_append_only
  before update or delete
  on public.os_it_intune_scorecard_mttr_correlations
  for each row execute function public.prevent_it_intune_phase47_ops_mutation();

drop trigger if exists os_it_intune_p47_mttr_no_truncate
  on public.os_it_intune_scorecard_mttr_correlations;
create trigger os_it_intune_p47_mttr_no_truncate
  before truncate
  on public.os_it_intune_scorecard_mttr_correlations
  for each statement execute function public.prevent_it_intune_phase47_ops_mutation();

drop trigger if exists os_it_intune_p47_expiry_dec_append_only
  on public.os_it_intune_promote_waive_expiry_decisions;
create trigger os_it_intune_p47_expiry_dec_append_only
  before update or delete
  on public.os_it_intune_promote_waive_expiry_decisions
  for each row execute function public.prevent_it_intune_phase47_ops_mutation();

drop trigger if exists os_it_intune_p47_expiry_dec_no_truncate
  on public.os_it_intune_promote_waive_expiry_decisions;
create trigger os_it_intune_p47_expiry_dec_no_truncate
  before truncate
  on public.os_it_intune_promote_waive_expiry_decisions
  for each statement execute function public.prevent_it_intune_phase47_ops_mutation();

drop trigger if exists os_it_intune_p47_alert_append_only
  on public.os_it_intune_phase47_ops_alerts;
create trigger os_it_intune_p47_alert_append_only
  before update or delete
  on public.os_it_intune_phase47_ops_alerts
  for each row execute function public.prevent_it_intune_phase47_ops_mutation();

drop trigger if exists os_it_intune_p47_alert_no_truncate
  on public.os_it_intune_phase47_ops_alerts;
create trigger os_it_intune_p47_alert_no_truncate
  before truncate
  on public.os_it_intune_phase47_ops_alerts
  for each statement execute function public.prevent_it_intune_phase47_ops_mutation();

-- ---------------------------------------------------------------------------
-- Helpers: expire approved waives past TTL; active waive with extend audit
-- ---------------------------------------------------------------------------
create or replace function public.expire_it_intune_promote_waive_approved_phase47()
returns integer
language plpgsql security definer set search_path=public as $$
declare
  v_count integer:=0;
begin
  -- Never updates breaker rows and never calls reset/close RPCs.
  -- Also expire stale Phase 46 proposed waives via existing helper.
  perform public.expire_it_intune_promote_waive_proposals_phase46();

  update public.os_it_intune_promote_waive_proposals
  set status='expired',
      row_version=row_version+1
  where status='approved'
    and expires_at<=now();
  get diagnostics v_count=row_count;
  return coalesce(v_count,0);
end;
$$;

create or replace function public.get_it_intune_active_promote_waive_phase47(
  p_recommendation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public as $$
declare
  v_waive jsonb;
  v_proposal public.os_it_intune_promote_waive_proposals%rowtype;
  v_extend_approved boolean:=false;
begin
  -- Observe-only lookup: expiration tick applied by propose/review/accept/worker.
  if p_recommendation_id is null then
    return jsonb_build_object(
      'found',false,
      'expired',false,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    );
  end if;

  v_waive:=public.get_it_intune_active_promote_waive_phase46(p_recommendation_id);
  if coalesce((v_waive->>'found')::boolean,false) then
    -- Active (non-expired) dual-approved waive. Note whether TTL was extended.
    select exists (
      select 1
      from public.os_it_intune_promote_waive_expiry_proposals e
      join public.os_it_intune_promote_waive_expiry_decisions d
        on d.expiry_proposal_id=e.expiry_proposal_id
      where e.waive_proposal_id=(v_waive->>'proposal_id')::uuid
        and e.action='extend'
        and e.status='approved'
        and d.decision='approved'
        and d.decided_by<>e.proposed_by
    ) into v_extend_approved;

    return coalesce(v_waive,'{}'::jsonb) || jsonb_build_object(
      'expired',false,
      'expiry_extended',coalesce(v_extend_approved,false),
      'phase47',true,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    );
  end if;

  -- Detect expired dual-approved waive that would need extend to remain usable.
  select p.* into v_proposal
  from public.os_it_intune_promote_waive_proposals p
  where p.recommendation_id=p_recommendation_id
    and p.status in ('approved','expired')
    and exists (
      select 1 from public.os_it_intune_promote_waive_decisions d
      where d.waive_proposal_id=p.proposal_id
        and d.decision='approved'
        and d.decided_by<>p.proposed_by
    )
  order by p.proposed_at desc, p.proposal_id desc
  limit 1;

  if found and (v_proposal.status='expired' or v_proposal.expires_at<=now()) then
    return jsonb_build_object(
      'found',false,
      'expired',true,
      'proposal_id',v_proposal.proposal_id,
      'recommendation_id',v_proposal.recommendation_id,
      'expires_at',v_proposal.expires_at,
      'status',v_proposal.status,
      'needs_dual_approved_extend',true,
      'phase47',true,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    );
  end if;

  return jsonb_build_object(
    'found',false,
    'expired',false,
    'phase47',true,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Propose / review dual-approver waive expiry (extend | expire)
-- ---------------------------------------------------------------------------
create or replace function public.propose_it_intune_promote_waive_expiry_phase47(
  p_waive_proposal_id uuid,
  p_actor_id uuid,
  p_action text,
  p_reason text,
  p_new_expires_at timestamptz default null,
  p_expected_row_version bigint default null
)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_waive public.os_it_intune_promote_waive_proposals%rowtype;
  v_reco public.os_it_intune_threshold_recommendation_drafts%rowtype;
  v_breaker public.os_it_intune_provider_breakers%rowtype;
  v_evidence jsonb;
  v_hash text;
  v_proposal public.os_it_intune_promote_waive_expiry_proposals%rowtype;
  v_max_hours integer:=public.it_intune_phase47_extend_max_hours();
begin
  -- Expiry proposals never update breaker rows and never call reset/close RPCs.
  perform public.expire_it_intune_promote_waive_approved_phase47();

  if p_action not in ('extend','expire') then
    raise exception 'Phase 47 waive expiry action must be extend or expire';
  end if;

  select * into v_waive
  from public.os_it_intune_promote_waive_proposals
  where proposal_id=p_waive_proposal_id;
  if not found then
    raise exception 'Phase 47 waive proposal not found for expiry action';
  end if;

  select * into v_reco
  from public.os_it_intune_threshold_recommendation_drafts
  where recommendation_id=v_waive.recommendation_id;
  select * into v_breaker
  from public.os_it_intune_provider_breakers
  where breaker_id=v_reco.breaker_id;

  if v_waive.status<>'approved'
     or length(trim(coalesce(p_reason,'')))<20
     or not public.it_intune_manual_review_actor_allowed(
       p_actor_id,v_breaker.entity_id) then
    raise exception 'Phase 47 waive expiry propose denied or waive not approved';
  end if;

  if not exists (
    select 1 from public.os_it_intune_promote_waive_decisions d
    where d.waive_proposal_id=p_waive_proposal_id
      and d.decision='approved'
      and d.decided_by<>v_waive.proposed_by
  ) then
    raise exception 'Phase 47 waive expiry requires an existing dual-approved waive';
  end if;

  if exists (
    select 1 from public.os_it_intune_promote_waive_expiry_proposals e
    where e.waive_proposal_id=p_waive_proposal_id
      and e.status='proposed'
  ) then
    raise exception 'Phase 47 waive expiry already proposed for this waive';
  end if;

  if p_action='extend' then
    if p_new_expires_at is null
       or p_new_expires_at<=now()
       or p_new_expires_at<=v_waive.expires_at
       or p_new_expires_at>now()+make_interval(hours => v_max_hours) then
      raise exception
        'Phase 47 extend requires new_expires_at after current expiry within max TTL';
    end if;
  else
    if p_new_expires_at is not null then
      raise exception 'Phase 47 expire action must not set new_expires_at';
    end if;
  end if;

  v_evidence:=public.it_intune_phase47_sanitize_aggregate(jsonb_build_object(
    'evidence_version','phase47-v1',
    'waive_kind','promote_exception_expiry',
    'waive_proposal_id',p_waive_proposal_id,
    'recommendation_id',v_waive.recommendation_id,
    'action',p_action,
    'proposed_by',p_actor_id,
    'current_expires_at',v_waive.expires_at,
    'new_expires_at',p_new_expires_at,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  ));
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_it_intune_promote_waive_expiry_proposals(
    waive_proposal_id,action,proposed_by,proposed_reason,new_expires_at,
    status,aggregate_evidence,evidence_sha256
  ) values (
    p_waive_proposal_id,p_action,p_actor_id,trim(p_reason),
    case when p_action='extend' then p_new_expires_at else null end,
    'proposed',v_evidence,v_hash
  ) returning * into v_proposal;

  return jsonb_build_object(
    'expiry_proposal_id',v_proposal.expiry_proposal_id,
    'waive_proposal_id',v_proposal.waive_proposal_id,
    'action',v_proposal.action,
    'status',v_proposal.status,
    'new_expires_at',v_proposal.new_expires_at,
    'row_version',v_proposal.row_version,
    'evidence_sha256',v_hash,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

create or replace function public.review_it_intune_promote_waive_expiry_phase47(
  p_expiry_proposal_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_statement text,
  p_expected_row_version bigint
)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_proposal public.os_it_intune_promote_waive_expiry_proposals%rowtype;
  v_waive public.os_it_intune_promote_waive_proposals%rowtype;
  v_reco public.os_it_intune_threshold_recommendation_drafts%rowtype;
  v_breaker public.os_it_intune_provider_breakers%rowtype;
  v_decision public.os_it_intune_promote_waive_expiry_decisions%rowtype;
  v_status text;
  v_evidence jsonb;
  v_hash text;
begin
  -- Dual-actor expiry review never updates breaker rows / reset/close RPCs.
  perform public.expire_it_intune_promote_waive_approved_phase47();

  select * into v_proposal
  from public.os_it_intune_promote_waive_expiry_proposals
  where expiry_proposal_id=p_expiry_proposal_id
  for update;
  if not found then
    raise exception 'Phase 47 waive expiry proposal not found';
  end if;

  select * into v_waive
  from public.os_it_intune_promote_waive_proposals
  where proposal_id=v_proposal.waive_proposal_id
  for update;
  select * into v_reco
  from public.os_it_intune_threshold_recommendation_drafts
  where recommendation_id=v_waive.recommendation_id;
  select * into v_breaker
  from public.os_it_intune_provider_breakers
  where breaker_id=v_reco.breaker_id;

  if exists (
    select 1 from public.os_it_intune_promote_waive_expiry_decisions
    where expiry_proposal_id=p_expiry_proposal_id
  ) then
    raise exception 'Phase 47 waive expiry proposal already has an immutable decision';
  end if;

  if p_decision not in ('approve','reject')
     or v_proposal.status<>'proposed'
     or v_proposal.proposed_by=p_actor_id
     or v_proposal.row_version<>p_expected_row_version
     or length(trim(coalesce(p_statement,'')))<20
     or not public.it_intune_manual_review_actor_allowed(
       p_actor_id,v_breaker.entity_id) then
    raise exception
      'Phase 47 independent waive expiry review denied, stale, or dual-approver required';
  end if;

  if p_decision='approve' then
    v_status:='approved';
  else
    v_status:='rejected';
  end if;

  v_evidence:=public.it_intune_phase47_sanitize_aggregate(jsonb_build_object(
    'evidence_version','phase47-v1',
    'waive_kind','promote_exception_expiry_decision',
    'expiry_proposal_id',p_expiry_proposal_id,
    'waive_proposal_id',v_proposal.waive_proposal_id,
    'action',v_proposal.action,
    'decision',v_status,
    'proposed_by',v_proposal.proposed_by,
    'decided_by',p_actor_id,
    'dual_actor',true,
    'new_expires_at',v_proposal.new_expires_at,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  ));
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_it_intune_promote_waive_expiry_decisions(
    expiry_proposal_id,decided_by,decision,statement,evidence_sha256
  ) values (
    p_expiry_proposal_id,p_actor_id,v_status,trim(p_statement),v_hash
  ) returning * into v_decision;

  update public.os_it_intune_promote_waive_expiry_proposals
  set status=v_status,
      row_version=row_version+1
  where expiry_proposal_id=p_expiry_proposal_id
    and row_version=p_expected_row_version
    and status='proposed';
  if not found then
    raise exception 'Phase 47 waive expiry proposal changed during review';
  end if;

  if v_status='approved' and v_proposal.action='extend' then
    update public.os_it_intune_promote_waive_proposals
    set expires_at=v_proposal.new_expires_at,
        row_version=row_version+1
    where proposal_id=v_proposal.waive_proposal_id
      and status='approved';
    if not found then
      raise exception 'Phase 47 waive extend denied — waive not approved or already expired';
    end if;
  elsif v_status='approved' and v_proposal.action='expire' then
    update public.os_it_intune_promote_waive_proposals
    set status='expired',
        expires_at=least(expires_at,now()),
        row_version=row_version+1
    where proposal_id=v_proposal.waive_proposal_id
      and status='approved';
    if not found then
      raise exception 'Phase 47 waive expire denied — waive not approved';
    end if;
  end if;

  return jsonb_build_object(
    'decision_id',v_decision.decision_id,
    'expiry_proposal_id',p_expiry_proposal_id,
    'waive_proposal_id',v_proposal.waive_proposal_id,
    'action',v_proposal.action,
    'decision',v_status,
    'dual_approved',v_status='approved',
    'new_expires_at',v_proposal.new_expires_at,
    'evidence_sha256',v_hash,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Correlate postmortem scorecards with soak-cycle MTTR proxy
-- ---------------------------------------------------------------------------
create or replace function public.correlate_it_intune_scorecard_mttr_phase47()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_sc record;
  v_bucket text;
  v_mttr integer;
  v_baseline integer:=public.it_intune_phase47_mttr_baseline_minutes();
  v_mttr_proxy numeric(5,4);
  v_delta numeric(5,4);
  v_evidence jsonb;
  v_hash text;
  v_recorded integer:=0;
  v_skipped integer:=0;
  v_mismatch integer:=0;
  v_threshold numeric:=public.it_intune_phase47_mttr_mismatch_threshold();
begin
  -- MTTR correlations never update breaker rows and never call reset/close RPCs.
  v_bucket:=to_char(date_trunc('hour',now()),'YYYYMMDD"T"HH24');

  for v_sc in
    select s.scorecard_id,s.postmortem_id,s.composite_score,s.recorded_at
    from public.os_it_intune_postmortem_quality_scorecards s
    order by s.recorded_at desc, s.scorecard_id desc
    limit 100
  loop
    if exists (
      select 1 from public.os_it_intune_scorecard_mttr_correlations c
      where c.scorecard_id=v_sc.scorecard_id
        and c.bucket_key=v_bucket
    ) then
      v_skipped:=v_skipped+1;
      continue;
    end if;

    select round(avg(c.cycle_elapsed_minutes))::integer into v_mttr
    from public.os_it_intune_soak_cycle_evidence c
    where c.postmortem_id=v_sc.postmortem_id
      and c.cycle_status='cycle_complete';

    if v_mttr is null then
      v_skipped:=v_skipped+1;
      continue;
    end if;

    -- High composite_score should align with low MTTR (fast recovery).
    v_mttr_proxy:=round(
      (1.0 - least(v_mttr::numeric / nullif(v_baseline,0)::numeric, 1.0))
    , 4);
    v_delta:=round(v_sc.composite_score - v_mttr_proxy, 4);

    if abs(v_delta) >= v_threshold then
      v_mismatch:=v_mismatch+1;
    end if;

    v_evidence:=public.it_intune_phase47_sanitize_aggregate(jsonb_build_object(
      'evidence_version','phase47-v1',
      'review_kind','scorecard_mttr_correlation',
      'postmortem_id',v_sc.postmortem_id,
      'scorecard_id',v_sc.scorecard_id,
      'cycle_elapsed_minutes',v_mttr,
      'mttr_baseline_minutes',v_baseline,
      'mttr_proxy_score',v_mttr_proxy,
      'composite_score',v_sc.composite_score,
      'correlation_delta',v_delta,
      'mismatch',abs(v_delta)>=v_threshold,
      'bucket_key',v_bucket,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    ));
    v_hash:=public.os_sha256_hex(v_evidence::text);

    insert into public.os_it_intune_scorecard_mttr_correlations(
      postmortem_id,scorecard_id,cycle_elapsed_minutes,composite_score,
      correlation_delta,aggregate_evidence,evidence_sha256,bucket_key
    ) values (
      v_sc.postmortem_id,v_sc.scorecard_id,v_mttr,v_sc.composite_score,
      v_delta,v_evidence,v_hash,v_bucket
    );
    v_recorded:=v_recorded+1;
  end loop;

  return jsonb_build_object(
    'correlations_recorded',v_recorded,
    'skipped',v_skipped,
    'mismatch_count',v_mismatch,
    'bucket_key',v_bucket,
    'mttr_baseline_minutes',v_baseline,
    'mismatch_threshold',v_threshold,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Promote gate / accept wrap: waived unusable if expired without dual-approved extend
-- ---------------------------------------------------------------------------
create or replace function public.get_it_intune_tuning_promote_gate_phase47(
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
  v_gate:=public.get_it_intune_tuning_promote_gate_phase46(
    p_recommendation_id, p_proposal_id);
  if p_recommendation_id is not null then
    v_waive:=public.get_it_intune_active_promote_waive_phase47(
      p_recommendation_id);
    if coalesce((v_waive->>'found')::boolean,false) then
      return coalesce(v_gate,'{}'::jsonb) || jsonb_build_object(
        'gate_status','waived',
        'dual_approved_waive',true,
        'waive_proposal_id',v_waive->>'proposal_id',
        'expiry_extended',coalesce((v_waive->>'expiry_extended')::boolean,false),
        'waive_expired',false,
        'phase47',true,
        'closes_or_resets_breaker',false,
        'entity_identifiers_included',false
      );
    end if;
    if coalesce((v_waive->>'expired')::boolean,false) then
      return coalesce(v_gate,'{}'::jsonb) || jsonb_build_object(
        'gate_status','blocked',
        'dual_approved_waive',false,
        'waive_expired',true,
        'needs_dual_approved_extend',true,
        'waive_proposal_id',v_waive->>'proposal_id',
        'phase47',true,
        'closes_or_resets_breaker',false,
        'entity_identifiers_included',false
      );
    end if;
  end if;
  return coalesce(v_gate,'{}'::jsonb) || jsonb_build_object(
    'dual_approved_waive',false,
    'waive_expired',false,
    'phase47',true,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

create or replace function public.accept_it_intune_threshold_recommendation_phase47(
  p_recommendation_id uuid,p_actor_id uuid,p_reason text,
  p_expected_breaker_version bigint,p_expected_row_version bigint
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_gate jsonb;
  v_status text;
  v_waive jsonb;
  v_result jsonb;
  v_expired_count integer;
begin
  -- Accept never closes/resets breakers beyond existing Phase 41 accept path.
  -- Waived promote must not proceed if expired unless expiry-extend dual-approved
  -- (extend renews expires_at so active waive lookup succeeds).
  v_expired_count:=public.expire_it_intune_promote_waive_approved_phase47();
  v_waive:=public.get_it_intune_active_promote_waive_phase47(p_recommendation_id);
  v_gate:=public.get_it_intune_tuning_promote_gate_phase47(
    p_recommendation_id, null);
  v_status:=coalesce(v_gate->>'gate_status','blocked');

  if coalesce((v_waive->>'expired')::boolean,false)
     and not coalesce((v_waive->>'found')::boolean,false) then
    raise exception
      'Phase 47 waived promote expired — dual-approved expiry-extend required before Accept';
  end if;

  if v_status='ready' then
    null;
  elsif v_status='waived'
     and coalesce((v_waive->>'found')::boolean,false) then
    if v_waive->>'proposed_by' is null
       or v_waive->>'decided_by' is null
       or (v_waive->>'proposed_by')=(v_waive->>'decided_by') then
      raise exception
        'Phase 47 waived promote requires dual-approver audit (proposer ≠ second approver)';
    end if;
  else
    raise exception
      'Phase 47 tuning promote gate blocked: need ready scorecard or non-expired dual-approved waive';
  end if;

  v_result:=public.accept_it_intune_threshold_recommendation_phase46(
    p_recommendation_id,p_actor_id,p_reason,
    p_expected_breaker_version,p_expected_row_version
  );

  return v_result || jsonb_build_object(
    'phase47_gate_status',v_status,
    'phase47_waive_expired_tick',v_expired_count,
    'expiry_extended',coalesce((v_waive->>'expiry_extended')::boolean,false),
    'phase46_wrapped',true,
    'closes_or_resets_breaker',false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Critical windows + alert recording
-- ---------------------------------------------------------------------------
create or replace function public.list_it_intune_phase47_critical_windows(
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
  v_threshold numeric:=public.it_intune_phase47_mttr_mismatch_threshold();
begin
  perform public.expire_it_intune_promote_waive_approved_phase47();

  v_bucket:=to_char(
    to_timestamp(
      (floor(extract(epoch from now())/(v_hours*3600.0))
        *(v_hours*3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','waive_expiry_pending',
      'window_key','waiveexp:'||e.expiry_proposal_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','warning',
      'waive_proposal_id',e.waive_proposal_id,
      'expiry_proposal_id',e.expiry_proposal_id,
      'action',e.action
    ) order by e.proposed_at desc)
    from public.os_it_intune_promote_waive_expiry_proposals e
    where e.status='proposed'
      and not exists (
        select 1 from public.os_it_intune_phase47_ops_alerts x
        where x.window_key=
          'waiveexp:'||e.expiry_proposal_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 25
  ), '[]'::jsonb) into v_part;
  v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','mttr_score_mismatch',
      'window_key','mttrmis:'||r.correlation_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','warning',
      'postmortem_id',r.postmortem_id,
      'scorecard_id',r.scorecard_id,
      'correlation_delta',r.correlation_delta,
      'cycle_elapsed_minutes',r.cycle_elapsed_minutes,
      'composite_score',r.composite_score
    ) order by r.recorded_at desc)
    from (
      select c.correlation_id,c.postmortem_id,c.scorecard_id,
        c.correlation_delta,c.cycle_elapsed_minutes,c.composite_score,
        c.recorded_at,
        row_number() over (
          partition by c.postmortem_id
          order by c.recorded_at desc, c.correlation_id desc
        ) rn
      from public.os_it_intune_scorecard_mttr_correlations c
      where c.recorded_at>=now()-interval '24 hours'
        and abs(c.correlation_delta) >= v_threshold
    ) r
    where r.rn=1
      and not exists (
        select 1 from public.os_it_intune_phase47_ops_alerts x
        where x.window_key=
          'mttrmis:'||r.correlation_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 25
  ), '[]'::jsonb) into v_part;
  v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','waive_expired',
      'window_key','waiveexd:'||w.proposal_id::text||':'||v_bucket||'h'||v_hours::text,
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
      )
      and not exists (
        select 1 from public.os_it_intune_phase47_ops_alerts x
        where x.window_key=
          'waiveexd:'||w.proposal_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 25
  ), '[]'::jsonb) into v_part;
  v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);

  return jsonb_build_object(
    'version','phase47-v1',
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',coalesce(v_pending,'[]'::jsonb),
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

create or replace function public.record_it_intune_phase47_ops_alert(p_alert jsonb)
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
  v_expiry uuid;
  v_pm uuid;
  v_sc uuid;
  v_evidence jsonb;
  v_hash text;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_alert,'{}'::jsonb))<>'object' then
    raise exception 'Phase 47 ops alert payload must be a JSON object';
  end if;

  v_kind:=coalesce(p_alert->>'alert_kind','');
  v_window:=coalesce(p_alert->>'window_key','');
  v_dest:=coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery:=coalesce(p_alert->>'delivery_status','recorded');
  v_code:=nullif(p_alert->>'response_code','')::integer;
  v_severity:=coalesce(nullif(p_alert->>'severity',''),'warning');
  v_reco:=nullif(p_alert->>'recommendation_id','')::uuid;
  v_waive:=nullif(p_alert->>'waive_proposal_id','')::uuid;
  v_expiry:=nullif(p_alert->>'expiry_proposal_id','')::uuid;
  v_pm:=nullif(p_alert->>'postmortem_id','')::uuid;
  v_sc:=nullif(p_alert->>'scorecard_id','')::uuid;

  if v_kind not in (
      'waive_expiry_pending','mttr_score_mismatch','waive_expired')
    or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
    or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
    or v_delivery not in
      ('delivered','skipped_no_webhook','failed','recorded')
    or v_severity not in ('warning','critical') then
    raise exception 'Phase 47 ops alert contract is invalid';
  end if;

  v_evidence:=public.it_intune_phase47_sanitize_aggregate(
    coalesce(p_alert->'aggregate_evidence','{}'::jsonb)
    || jsonb_build_object(
      'evidence_version','phase47-v1',
      'alert_kind',v_kind,
      'window_key',v_window,
      'severity',v_severity,
      'destination_key',v_dest,
      'delivery_status',v_delivery,
      'response_code',v_code,
      'recommendation_id',v_reco,
      'waive_proposal_id',v_waive,
      'expiry_proposal_id',v_expiry,
      'postmortem_id',v_pm,
      'scorecard_id',v_sc,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    )
  );
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_it_intune_phase47_ops_alerts(
    alert_kind,window_key,severity,destination_key,delivery_status,
    response_code,recommendation_id,waive_proposal_id,expiry_proposal_id,
    postmortem_id,scorecard_id,aggregate_evidence,evidence_sha256
  ) values (
    v_kind,v_window,v_severity,v_dest,v_delivery,v_code,
    v_reco,v_waive,v_expiry,v_pm,v_sc,v_evidence,v_hash
  )
  on conflict (window_key) do nothing
  returning alert_id into v_id;

  if v_id is null then
    select alert_id into v_id
    from public.os_it_intune_phase47_ops_alerts
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
create or replace view public.os_it_intune_phase47_health
with (security_invoker=true) as
select
  (select count(*) from public.os_it_intune_scorecard_mttr_correlations)
    as mttr_correlation_count,
  (select count(*) from public.os_it_intune_scorecard_mttr_correlations
    where abs(correlation_delta) >= public.it_intune_phase47_mttr_mismatch_threshold()
      and recorded_at>=now()-interval '7 days') as mttr_score_mismatch_7d,
  (select count(*) from public.os_it_intune_promote_waive_expiry_proposals
    where status='proposed') as waive_expiry_pending_count,
  (select count(*) from public.os_it_intune_promote_waive_expiry_proposals
    where status='approved' and action='extend') as waive_extend_approved_count,
  (select count(*) from public.os_it_intune_promote_waive_expiry_proposals
    where status='approved' and action='expire') as waive_expire_approved_count,
  (select count(*) from public.os_it_intune_promote_waive_expiry_decisions)
    as waive_expiry_decision_count,
  (select count(*) from public.os_it_intune_promote_waive_proposals
    where status='expired'
      and expires_at>=now()-interval '7 days') as waive_expired_7d,
  (select count(*) from public.os_it_intune_phase47_ops_alerts)
    as ops_alert_count,
  (select count(*) from public.os_it_intune_phase47_ops_alerts
    where delivery_status='delivered') as alerts_delivered_count,
  (select count(*) from public.os_it_intune_phase47_ops_alerts
    where delivery_status in ('failed','skipped_no_webhook'))
    as alerts_undelivered_count;
grant select on public.os_it_intune_phase47_health to authenticated;

create or replace view public.os_it_intune_scorecard_mttr_correlation_status
with (security_invoker=true) as
select distinct on (c.postmortem_id)
  c.correlation_id,c.postmortem_id,c.scorecard_id,
  c.cycle_elapsed_minutes,c.composite_score,c.correlation_delta,
  c.aggregate_evidence,c.evidence_sha256,c.recorded_at,
  s.ready_for_tuning_promote,p.status as postmortem_status
from public.os_it_intune_scorecard_mttr_correlations c
join public.os_it_intune_postmortem_quality_scorecards s
  on s.scorecard_id=c.scorecard_id
join public.os_it_intune_outage_postmortems p
  on p.postmortem_id=c.postmortem_id
order by c.postmortem_id, c.recorded_at desc, c.correlation_id desc;
grant select on public.os_it_intune_scorecard_mttr_correlation_status
  to authenticated;

create or replace view public.os_it_intune_promote_waive_expiry_status
with (security_invoker=true) as
select distinct on (e.waive_proposal_id)
  e.expiry_proposal_id,e.waive_proposal_id,e.action,e.proposed_by,
  e.proposed_reason,e.new_expires_at,e.status,e.proposed_at,e.row_version,
  e.evidence_sha256,
  d.decision_id,d.decided_by,d.decision as decision_status,d.decided_at,
  w.recommendation_id,w.expires_at as waive_expires_at,w.status as waive_status
from public.os_it_intune_promote_waive_expiry_proposals e
join public.os_it_intune_promote_waive_proposals w
  on w.proposal_id=e.waive_proposal_id
left join public.os_it_intune_promote_waive_expiry_decisions d
  on d.expiry_proposal_id=e.expiry_proposal_id
order by e.waive_proposal_id, e.proposed_at desc, e.expiry_proposal_id desc;
grant select on public.os_it_intune_promote_waive_expiry_status to authenticated;

create or replace function public.get_it_intune_phase47_ops_report()
returns jsonb
language plpgsql
stable
security definer
set search_path=public as $$
declare
  v_health jsonb;
  v_correlations jsonb;
  v_expiry jsonb;
  v_alerts jsonb;
begin
  select jsonb_build_object(
    'mttr_correlation_count',mttr_correlation_count,
    'mttr_score_mismatch_7d',mttr_score_mismatch_7d,
    'waive_expiry_pending_count',waive_expiry_pending_count,
    'waive_extend_approved_count',waive_extend_approved_count,
    'waive_expire_approved_count',waive_expire_approved_count,
    'waive_expiry_decision_count',waive_expiry_decision_count,
    'waive_expired_7d',waive_expired_7d,
    'ops_alert_count',ops_alert_count,
    'alerts_delivered_count',alerts_delivered_count,
    'alerts_undelivered_count',alerts_undelivered_count,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  ) into v_health
  from public.os_it_intune_phase47_health;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_correlations
  from (
    select c.correlation_id,c.postmortem_id,c.scorecard_id,
      c.cycle_elapsed_minutes,c.composite_score,c.correlation_delta,
      c.evidence_sha256,c.recorded_at
    from public.os_it_intune_scorecard_mttr_correlations c
    order by c.recorded_at desc
    limit 50
  ) x;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.proposed_at desc),
    '[]'::jsonb)
  into v_expiry
  from (
    select e.expiry_proposal_id,e.waive_proposal_id,e.action,e.status,
      e.proposed_by,e.new_expires_at,e.row_version,e.evidence_sha256,
      e.proposed_at
    from public.os_it_intune_promote_waive_expiry_proposals e
    order by e.proposed_at desc
    limit 50
  ) x;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_alerts
  from (
    select a.alert_id,a.alert_kind,a.window_key,a.severity,a.destination_key,
      a.delivery_status,a.response_code,a.recommendation_id,
      a.waive_proposal_id,a.expiry_proposal_id,a.postmortem_id,a.scorecard_id,
      a.evidence_sha256,a.recorded_at
    from public.os_it_intune_phase47_ops_alerts a
    order by a.recorded_at desc
    limit 50
  ) x;

  return coalesce(v_health,'{}'::jsonb) || jsonb_build_object(
    'version','phase47-v1',
    'mttr_correlations',v_correlations,
    'waive_expiry_proposals',v_expiry,
    'ops_alerts',v_alerts,
    'mttr_baseline_minutes',public.it_intune_phase47_mttr_baseline_minutes(),
    'mttr_mismatch_threshold',public.it_intune_phase47_mttr_mismatch_threshold()
  );
end;
$$;

revoke all on function public.it_intune_phase47_sanitize_aggregate(jsonb)
  from public,authenticated,service_role;
revoke all on function public.it_intune_phase47_mttr_baseline_minutes()
  from public,authenticated,service_role;
revoke all on function public.it_intune_phase47_mttr_mismatch_threshold()
  from public,authenticated,service_role;
revoke all on function public.it_intune_phase47_extend_max_hours()
  from public,authenticated,service_role;
revoke all on function public.expire_it_intune_promote_waive_approved_phase47()
  from public,authenticated;
revoke all on function public.get_it_intune_active_promote_waive_phase47(uuid)
  from public,authenticated;
revoke all on function public.propose_it_intune_promote_waive_expiry_phase47(
  uuid,uuid,text,text,timestamptz,bigint) from public,authenticated;
revoke all on function public.review_it_intune_promote_waive_expiry_phase47(
  uuid,uuid,text,text,bigint) from public,authenticated;
revoke all on function public.correlate_it_intune_scorecard_mttr_phase47()
  from public,authenticated;
revoke all on function public.get_it_intune_tuning_promote_gate_phase47(
  uuid,uuid) from public,authenticated;
revoke all on function public.accept_it_intune_threshold_recommendation_phase47(
  uuid,uuid,text,bigint,bigint) from public,authenticated;
revoke all on function public.list_it_intune_phase47_critical_windows(integer)
  from public,authenticated;
revoke all on function public.record_it_intune_phase47_ops_alert(jsonb)
  from public,authenticated;
revoke all on function public.get_it_intune_phase47_ops_report()
  from public,authenticated;
revoke all on function public.enforce_it_intune_promote_waive_expiry_dual_actor()
  from public,authenticated,service_role;

grant execute on function public.correlate_it_intune_scorecard_mttr_phase47(),
  public.accept_it_intune_threshold_recommendation_phase47(
    uuid,uuid,text,bigint,bigint),
  public.propose_it_intune_promote_waive_expiry_phase47(uuid,uuid,text,text,timestamptz,bigint),
  public.review_it_intune_promote_waive_expiry_phase47(
    uuid,uuid,text,text,bigint),
  public.list_it_intune_phase47_critical_windows(integer),
  public.record_it_intune_phase47_ops_alert(jsonb),
  public.get_it_intune_phase47_ops_report(),
  public.get_it_intune_active_promote_waive_phase47(uuid),
  public.get_it_intune_tuning_promote_gate_phase47(uuid,uuid),
  public.expire_it_intune_promote_waive_approved_phase47()
  to service_role;

grant execute on function public.get_it_intune_tuning_promote_gate_phase47(
  uuid,uuid),
  public.list_it_intune_phase47_critical_windows(integer),
  public.get_it_intune_phase47_ops_report(),
  public.get_it_intune_active_promote_waive_phase47(uuid),
  public.propose_it_intune_promote_waive_expiry_phase47(uuid,uuid,text,text,timestamptz,bigint),
  public.review_it_intune_promote_waive_expiry_phase47(
    uuid,uuid,text,text,bigint)
  to authenticated;

grant execute on function public.it_intune_phase47_mttr_baseline_minutes(),
  public.it_intune_phase47_mttr_mismatch_threshold(),
  public.it_intune_phase47_extend_max_hours()
  to authenticated, service_role;
