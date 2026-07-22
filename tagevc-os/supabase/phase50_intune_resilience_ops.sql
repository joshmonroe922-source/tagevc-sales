-- Phase 50: extend propose -> 2 DISTINCT approvers -> apply to breaker
-- tuning proposals and promote-waive proposals. Visibility into suggested
-- vs applied for both. Apply after phase49_intune_resilience_ops.sql.
-- Observe-only against breaker state: never closes, resets, or mutates
-- breakers outside the existing single-reviewer RPCs, which this file gates
-- behind an ADDITIONAL distinct dual-approval requirement. NEVER auto-closes
-- or resets breakers without the dual-approve human path. Aggregates never
-- include entity identifiers. Observe-only layers stay observe-only unless
-- going through this dual-approve apply path.

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

-- Bootstrap Phase 49 sanitize helper if prior Intune SQL was skipped.
create or replace function public.it_intune_phase49_sanitize_aggregate(p_evidence jsonb)
returns jsonb
language sql immutable set search_path=public as $$
  select coalesce(p_evidence,'{}'::jsonb)
    - 'entity_id' - 'entity_ids' - 'entity_scope' - 'entity_scopes'
    || jsonb_build_object('entity_identifiers_included',false);
$$;

create or replace function public.it_intune_phase50_sanitize_aggregate(p_evidence jsonb)
returns jsonb
language sql immutable set search_path=public as $$
  select public.it_intune_phase49_sanitize_aggregate(p_evidence);
$$;

-- ---------------------------------------------------------------------------
-- Append-only dual distinct-actor approvals for breaker tuning proposals.
-- This is an ADDITIONAL gate in front of the existing single-reviewer
-- review_it_intune_breaker_tuning RPC — never replaces or bypasses it.
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_breaker_tuning_phase50_approvals (
  approval_id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null
    references public.os_it_intune_breaker_tuning_proposals(proposal_id),
  actor_id uuid not null,
  decision text not null check (decision in ('approve','reject')),
  statement text not null check (length(statement) between 20 and 1000),
  aggregate_evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p50_tune_appr_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  ),
  constraint os_it_intune_p50_tune_appr_no_auto_close check (
    coalesce((aggregate_evidence->>'closes_or_resets_breaker')::boolean,false)=false
  ),
  constraint os_it_intune_p50_tune_appr_unique
    unique (proposal_id, actor_id)
);

create index if not exists os_it_intune_p50_tune_appr_prop_idx
  on public.os_it_intune_breaker_tuning_phase50_approvals(proposal_id, recorded_at desc);

alter table public.os_it_intune_breaker_tuning_phase50_approvals
  enable row level security;
drop policy if exists "os_it_intune_p50_tune_appr_select"
  on public.os_it_intune_breaker_tuning_phase50_approvals;
create policy "os_it_intune_p50_tune_appr_select"
  on public.os_it_intune_breaker_tuning_phase50_approvals for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_breaker_tuning_phase50_approvals to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_breaker_tuning_phase50_approvals
  from public,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Append-only breaker tuning dual-approve apply outcomes.
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_breaker_tuning_phase50_apply_events (
  event_id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null
    references public.os_it_intune_breaker_tuning_proposals(proposal_id),
  disposition text not null
    check (disposition in (
      'awaiting_second_approval','applied','blocked','recorded_reject'
    )),
  distinct_approvers integer not null default 0
    check (distinct_approvers >= 0),
  block_reason text,
  aggregate_evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p50_tune_evt_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  ),
  constraint os_it_intune_p50_tune_evt_no_auto_close check (
    coalesce((aggregate_evidence->>'closes_or_resets_breaker')::boolean,false)=false
  )
);

create index if not exists os_it_intune_p50_tune_evt_prop_idx
  on public.os_it_intune_breaker_tuning_phase50_apply_events(proposal_id, recorded_at desc);
create index if not exists os_it_intune_p50_tune_evt_disp_idx
  on public.os_it_intune_breaker_tuning_phase50_apply_events(disposition, recorded_at desc);

alter table public.os_it_intune_breaker_tuning_phase50_apply_events
  enable row level security;
drop policy if exists "os_it_intune_p50_tune_evt_select"
  on public.os_it_intune_breaker_tuning_phase50_apply_events;
create policy "os_it_intune_p50_tune_evt_select"
  on public.os_it_intune_breaker_tuning_phase50_apply_events for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_breaker_tuning_phase50_apply_events to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_breaker_tuning_phase50_apply_events
  from public,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Append-only dual distinct-actor approvals for promote-waive proposals.
-- ADDITIONAL gate in front of the existing single-reviewer
-- review_it_intune_promote_waive_phase46 RPC.
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_promote_waive_phase50_approvals (
  approval_id uuid primary key default gen_random_uuid(),
  waive_proposal_id uuid not null
    references public.os_it_intune_promote_waive_proposals(proposal_id),
  actor_id uuid not null,
  decision text not null check (decision in ('approve','reject')),
  statement text not null check (length(statement) between 20 and 1000),
  aggregate_evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p50_waive_appr_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  ),
  constraint os_it_intune_p50_waive_appr_no_auto_close check (
    coalesce((aggregate_evidence->>'closes_or_resets_breaker')::boolean,false)=false
  ),
  constraint os_it_intune_p50_waive_appr_unique
    unique (waive_proposal_id, actor_id)
);

create index if not exists os_it_intune_p50_waive_appr_prop_idx
  on public.os_it_intune_promote_waive_phase50_approvals(waive_proposal_id, recorded_at desc);

alter table public.os_it_intune_promote_waive_phase50_approvals
  enable row level security;
drop policy if exists "os_it_intune_p50_waive_appr_select"
  on public.os_it_intune_promote_waive_phase50_approvals;
create policy "os_it_intune_p50_waive_appr_select"
  on public.os_it_intune_promote_waive_phase50_approvals for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_promote_waive_phase50_approvals to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_promote_waive_phase50_approvals
  from public,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Append-only promote-waive dual-approve apply outcomes.
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_promote_waive_phase50_apply_events (
  event_id uuid primary key default gen_random_uuid(),
  waive_proposal_id uuid not null
    references public.os_it_intune_promote_waive_proposals(proposal_id),
  disposition text not null
    check (disposition in (
      'awaiting_second_approval','applied','blocked','recorded_reject'
    )),
  distinct_approvers integer not null default 0
    check (distinct_approvers >= 0),
  block_reason text,
  aggregate_evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p50_waive_evt_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  ),
  constraint os_it_intune_p50_waive_evt_no_auto_close check (
    coalesce((aggregate_evidence->>'closes_or_resets_breaker')::boolean,false)=false
  )
);

create index if not exists os_it_intune_p50_waive_evt_prop_idx
  on public.os_it_intune_promote_waive_phase50_apply_events(waive_proposal_id, recorded_at desc);
create index if not exists os_it_intune_p50_waive_evt_disp_idx
  on public.os_it_intune_promote_waive_phase50_apply_events(disposition, recorded_at desc);

alter table public.os_it_intune_promote_waive_phase50_apply_events
  enable row level security;
drop policy if exists "os_it_intune_p50_waive_evt_select"
  on public.os_it_intune_promote_waive_phase50_apply_events;
create policy "os_it_intune_p50_waive_evt_select"
  on public.os_it_intune_promote_waive_phase50_apply_events for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_promote_waive_phase50_apply_events to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_promote_waive_phase50_apply_events
  from public,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Append-only Phase 50 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_phase50_ops_alerts (
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
  proposal_id uuid,
  aggregate_evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null,
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p50_alert_kind_check
    check (alert_kind in (
      'breaker_tuning_awaiting_second_approval',
      'breaker_tuning_applied',
      'promote_waive_awaiting_second_approval',
      'promote_waive_applied'
    )),
  constraint os_it_intune_p50_alert_severity_check
    check (severity in ('warning','critical')),
  constraint os_it_intune_p50_alert_delivery_check
    check (delivery_status in
      ('delivered','skipped_no_webhook','failed','recorded')),
  constraint os_it_intune_p50_alert_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_it_intune_p50_alert_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  )
);

create index if not exists os_it_intune_p50_alert_kind_recorded_idx
  on public.os_it_intune_phase50_ops_alerts(alert_kind, recorded_at desc);

alter table public.os_it_intune_phase50_ops_alerts
  enable row level security;
drop policy if exists "os_it_intune_p50_alert_select"
  on public.os_it_intune_phase50_ops_alerts;
create policy "os_it_intune_p50_alert_select"
  on public.os_it_intune_phase50_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_phase50_ops_alerts to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_phase50_ops_alerts
  from public,authenticated,service_role;

create or replace function public.prevent_it_intune_phase50_ops_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'Phase 50 Intune dual-approve gate evidence is append-only';
end;
$$;

drop trigger if exists os_it_intune_p50_tune_appr_append_only
  on public.os_it_intune_breaker_tuning_phase50_approvals;
create trigger os_it_intune_p50_tune_appr_append_only
  before update or delete
  on public.os_it_intune_breaker_tuning_phase50_approvals
  for each row execute function public.prevent_it_intune_phase50_ops_mutation();
drop trigger if exists os_it_intune_p50_tune_appr_no_truncate
  on public.os_it_intune_breaker_tuning_phase50_approvals;
create trigger os_it_intune_p50_tune_appr_no_truncate
  before truncate
  on public.os_it_intune_breaker_tuning_phase50_approvals
  for each statement execute function public.prevent_it_intune_phase50_ops_mutation();

drop trigger if exists os_it_intune_p50_tune_evt_append_only
  on public.os_it_intune_breaker_tuning_phase50_apply_events;
create trigger os_it_intune_p50_tune_evt_append_only
  before update or delete
  on public.os_it_intune_breaker_tuning_phase50_apply_events
  for each row execute function public.prevent_it_intune_phase50_ops_mutation();
drop trigger if exists os_it_intune_p50_tune_evt_no_truncate
  on public.os_it_intune_breaker_tuning_phase50_apply_events;
create trigger os_it_intune_p50_tune_evt_no_truncate
  before truncate
  on public.os_it_intune_breaker_tuning_phase50_apply_events
  for each statement execute function public.prevent_it_intune_phase50_ops_mutation();

drop trigger if exists os_it_intune_p50_waive_appr_append_only
  on public.os_it_intune_promote_waive_phase50_approvals;
create trigger os_it_intune_p50_waive_appr_append_only
  before update or delete
  on public.os_it_intune_promote_waive_phase50_approvals
  for each row execute function public.prevent_it_intune_phase50_ops_mutation();
drop trigger if exists os_it_intune_p50_waive_appr_no_truncate
  on public.os_it_intune_promote_waive_phase50_approvals;
create trigger os_it_intune_p50_waive_appr_no_truncate
  before truncate
  on public.os_it_intune_promote_waive_phase50_approvals
  for each statement execute function public.prevent_it_intune_phase50_ops_mutation();

drop trigger if exists os_it_intune_p50_waive_evt_append_only
  on public.os_it_intune_promote_waive_phase50_apply_events;
create trigger os_it_intune_p50_waive_evt_append_only
  before update or delete
  on public.os_it_intune_promote_waive_phase50_apply_events
  for each row execute function public.prevent_it_intune_phase50_ops_mutation();
drop trigger if exists os_it_intune_p50_waive_evt_no_truncate
  on public.os_it_intune_promote_waive_phase50_apply_events;
create trigger os_it_intune_p50_waive_evt_no_truncate
  before truncate
  on public.os_it_intune_promote_waive_phase50_apply_events
  for each statement execute function public.prevent_it_intune_phase50_ops_mutation();

drop trigger if exists os_it_intune_p50_alert_append_only
  on public.os_it_intune_phase50_ops_alerts;
create trigger os_it_intune_p50_alert_append_only
  before update or delete
  on public.os_it_intune_phase50_ops_alerts
  for each row execute function public.prevent_it_intune_phase50_ops_mutation();
drop trigger if exists os_it_intune_p50_alert_no_truncate
  on public.os_it_intune_phase50_ops_alerts;
create trigger os_it_intune_p50_alert_no_truncate
  before truncate
  on public.os_it_intune_phase50_ops_alerts
  for each statement execute function public.prevent_it_intune_phase50_ops_mutation();

-- ---------------------------------------------------------------------------
-- Dual distinct-actor approval gate for breaker tuning. Only after 2
-- DISTINCT approving actors (neither the proposer) does this call the
-- EXISTING single-reviewer review_it_intune_breaker_tuning RPC. Never
-- auto-closes or resets breakers — that RPC already refuses to tune a
-- non-closed breaker.
-- ---------------------------------------------------------------------------
create or replace function public.approve_it_intune_breaker_tuning_phase50(
  p_proposal_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_statement text,
  p_expected_breaker_version bigint
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_proposal public.os_it_intune_breaker_tuning_proposals%rowtype;
  v_breaker public.os_it_intune_provider_breakers%rowtype;
  v_decision text:=coalesce(nullif(trim(lower(p_decision)),''),'approve');
  v_statement text:=trim(coalesce(p_statement,''));
  v_id uuid;
  v_distinct integer:=0;
  v_evidence jsonb;
  v_hash text;
  v_review_result jsonb;
  v_block_reason text;
begin
  if p_proposal_id is null or p_actor_id is null
    or v_decision not in ('approve','reject')
    or length(v_statement) < 20 or length(v_statement) > 1000 then
    raise exception 'Phase 50 breaker tuning approval is invalid';
  end if;

  select * into v_proposal
  from public.os_it_intune_breaker_tuning_proposals
  where proposal_id=p_proposal_id;
  if not found then
    raise exception 'Breaker tuning proposal not found';
  end if;

  select * into v_breaker
  from public.os_it_intune_provider_breakers
  where breaker_id=v_proposal.breaker_id;

  if p_actor_id = v_proposal.proposed_by
    or not public.it_intune_manual_review_actor_allowed(
      p_actor_id,v_breaker.entity_id) then
    raise exception 'Phase 50 breaker tuning approver denied or is the proposer';
  end if;

  if exists (
    select 1 from public.os_it_intune_breaker_tuning_decisions
    where proposal_id=p_proposal_id
  ) then
    return jsonb_build_object(
      'disposition','unchanged',
      'status','already_decided',
      'proposal_id',p_proposal_id,
      'closes_or_resets_breaker',false);
  end if;

  v_evidence:=public.it_intune_phase50_sanitize_aggregate(jsonb_build_object(
    'evidence_version','phase50-v1',
    'kind','breaker_tuning_phase50_approval',
    'proposal_id',p_proposal_id,
    'decision',v_decision,
    'statement_sha256',public.os_sha256_hex(v_statement),
    'closes_or_resets_breaker',false
  ));
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_it_intune_breaker_tuning_phase50_approvals(
    proposal_id,actor_id,decision,statement,aggregate_evidence,evidence_sha256
  ) values (
    p_proposal_id,p_actor_id,v_decision,v_statement,v_evidence,v_hash
  )
  on conflict (proposal_id,actor_id) do nothing
  returning approval_id into v_id;

  if v_id is null then
    return jsonb_build_object(
      'disposition','unchanged',
      'status','duplicate_actor_decision',
      'proposal_id',p_proposal_id,
      'closes_or_resets_breaker',false);
  end if;

  if v_decision='reject' then
    insert into public.os_it_intune_breaker_tuning_phase50_apply_events(
      proposal_id,disposition,distinct_approvers,block_reason,
      aggregate_evidence,evidence_sha256
    ) values (
      p_proposal_id,'recorded_reject',0,null,v_evidence,v_hash
    );
    return jsonb_build_object(
      'disposition','recorded_reject',
      'proposal_id',p_proposal_id,
      'closes_or_resets_breaker',false);
  end if;

  select count(distinct actor_id)::integer into v_distinct
  from public.os_it_intune_breaker_tuning_phase50_approvals
  where proposal_id=p_proposal_id and decision='approve';

  if v_distinct < 2 then
    insert into public.os_it_intune_breaker_tuning_phase50_apply_events(
      proposal_id,disposition,distinct_approvers,block_reason,
      aggregate_evidence,evidence_sha256
    ) values (
      p_proposal_id,'awaiting_second_approval',v_distinct,null,v_evidence,v_hash
    );
    return jsonb_build_object(
      'disposition','awaiting_second_approval',
      'proposal_id',p_proposal_id,
      'distinct_approvers',v_distinct,
      'closes_or_resets_breaker',false);
  end if;

  -- Dual-human gate satisfied. This is the ONLY path that calls the
  -- existing single-reviewer breaker tuning RPC — never auto-applied.
  begin
    v_review_result:=public.review_it_intune_breaker_tuning(
      p_proposal_id, p_actor_id, 'approve', v_statement,
      p_expected_breaker_version
    );
  exception when others then
    v_block_reason:=sqlerrm;
    v_review_result:=null;
  end;

  if v_review_result is null then
    insert into public.os_it_intune_breaker_tuning_phase50_apply_events(
      proposal_id,disposition,distinct_approvers,block_reason,
      aggregate_evidence,evidence_sha256
    ) values (
      p_proposal_id,'blocked',v_distinct,
      coalesce(v_block_reason,'tuning_review_denied'),v_evidence,v_hash
    );
    return jsonb_build_object(
      'disposition','blocked',
      'proposal_id',p_proposal_id,
      'block_reason',coalesce(v_block_reason,'tuning_review_denied'),
      'distinct_approvers',v_distinct,
      'closes_or_resets_breaker',false);
  end if;

  insert into public.os_it_intune_breaker_tuning_phase50_apply_events(
    proposal_id,disposition,distinct_approvers,block_reason,
    aggregate_evidence,evidence_sha256
  ) values (
    p_proposal_id,'applied',v_distinct,null,v_evidence,v_hash
  );

  return jsonb_build_object(
    'disposition','applied',
    'proposal_id',p_proposal_id,
    'distinct_approvers',v_distinct,
    'config_version_no',v_review_result->>'config_version_no',
    'closes_or_resets_breaker',false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Dual distinct-actor approval gate for promote-waive. Only after 2 DISTINCT
-- approving actors (neither the proposer) does this call the EXISTING
-- single-reviewer review_it_intune_promote_waive_phase46 RPC.
-- ---------------------------------------------------------------------------
create or replace function public.approve_it_intune_promote_waive_phase50(
  p_proposal_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_statement text,
  p_expected_row_version bigint
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_proposal public.os_it_intune_promote_waive_proposals%rowtype;
  v_reco public.os_it_intune_threshold_recommendation_drafts%rowtype;
  v_breaker public.os_it_intune_provider_breakers%rowtype;
  v_decision text:=coalesce(nullif(trim(lower(p_decision)),''),'approve');
  v_statement text:=trim(coalesce(p_statement,''));
  v_id uuid;
  v_distinct integer:=0;
  v_evidence jsonb;
  v_hash text;
  v_review_result jsonb;
  v_block_reason text;
begin
  if p_proposal_id is null or p_actor_id is null
    or v_decision not in ('approve','reject')
    or length(v_statement) < 20 or length(v_statement) > 1000 then
    raise exception 'Phase 50 promote-waive approval is invalid';
  end if;

  select * into v_proposal
  from public.os_it_intune_promote_waive_proposals
  where proposal_id=p_proposal_id;
  if not found then
    raise exception 'Promote-waive proposal not found';
  end if;

  select * into v_reco
  from public.os_it_intune_threshold_recommendation_drafts
  where recommendation_id=v_proposal.recommendation_id;
  select * into v_breaker
  from public.os_it_intune_provider_breakers
  where breaker_id=v_reco.breaker_id;

  if p_actor_id = v_proposal.proposed_by
    or not public.it_intune_manual_review_actor_allowed(
      p_actor_id,v_breaker.entity_id) then
    raise exception 'Phase 50 promote-waive approver denied or is the proposer';
  end if;

  if exists (
    select 1 from public.os_it_intune_promote_waive_decisions
    where waive_proposal_id=p_proposal_id
  ) then
    return jsonb_build_object(
      'disposition','unchanged',
      'status','already_decided',
      'proposal_id',p_proposal_id,
      'closes_or_resets_breaker',false);
  end if;

  v_evidence:=public.it_intune_phase50_sanitize_aggregate(jsonb_build_object(
    'evidence_version','phase50-v1',
    'kind','promote_waive_phase50_approval',
    'proposal_id',p_proposal_id,
    'decision',v_decision,
    'statement_sha256',public.os_sha256_hex(v_statement),
    'closes_or_resets_breaker',false
  ));
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_it_intune_promote_waive_phase50_approvals(
    waive_proposal_id,actor_id,decision,statement,aggregate_evidence,evidence_sha256
  ) values (
    p_proposal_id,p_actor_id,v_decision,v_statement,v_evidence,v_hash
  )
  on conflict (waive_proposal_id,actor_id) do nothing
  returning approval_id into v_id;

  if v_id is null then
    return jsonb_build_object(
      'disposition','unchanged',
      'status','duplicate_actor_decision',
      'proposal_id',p_proposal_id,
      'closes_or_resets_breaker',false);
  end if;

  if v_decision='reject' then
    insert into public.os_it_intune_promote_waive_phase50_apply_events(
      waive_proposal_id,disposition,distinct_approvers,block_reason,
      aggregate_evidence,evidence_sha256
    ) values (
      p_proposal_id,'recorded_reject',0,null,v_evidence,v_hash
    );
    return jsonb_build_object(
      'disposition','recorded_reject',
      'proposal_id',p_proposal_id,
      'closes_or_resets_breaker',false);
  end if;

  select count(distinct actor_id)::integer into v_distinct
  from public.os_it_intune_promote_waive_phase50_approvals
  where waive_proposal_id=p_proposal_id and decision='approve';

  if v_distinct < 2 then
    insert into public.os_it_intune_promote_waive_phase50_apply_events(
      waive_proposal_id,disposition,distinct_approvers,block_reason,
      aggregate_evidence,evidence_sha256
    ) values (
      p_proposal_id,'awaiting_second_approval',v_distinct,null,v_evidence,v_hash
    );
    return jsonb_build_object(
      'disposition','awaiting_second_approval',
      'proposal_id',p_proposal_id,
      'distinct_approvers',v_distinct,
      'closes_or_resets_breaker',false);
  end if;

  -- Dual-human gate satisfied. This is the ONLY path that calls the
  -- existing single-reviewer promote-waive RPC — never auto-applied.
  begin
    v_review_result:=public.review_it_intune_promote_waive_phase46(
      p_proposal_id, p_actor_id, 'approve', v_statement,
      p_expected_row_version
    );
  exception when others then
    v_block_reason:=sqlerrm;
    v_review_result:=null;
  end;

  if v_review_result is null then
    insert into public.os_it_intune_promote_waive_phase50_apply_events(
      waive_proposal_id,disposition,distinct_approvers,block_reason,
      aggregate_evidence,evidence_sha256
    ) values (
      p_proposal_id,'blocked',v_distinct,
      coalesce(v_block_reason,'waive_review_denied'),v_evidence,v_hash
    );
    return jsonb_build_object(
      'disposition','blocked',
      'proposal_id',p_proposal_id,
      'block_reason',coalesce(v_block_reason,'waive_review_denied'),
      'distinct_approvers',v_distinct,
      'closes_or_resets_breaker',false);
  end if;

  insert into public.os_it_intune_promote_waive_phase50_apply_events(
    waive_proposal_id,disposition,distinct_approvers,block_reason,
    aggregate_evidence,evidence_sha256
  ) values (
    p_proposal_id,'applied',v_distinct,null,v_evidence,v_hash
  );

  return jsonb_build_object(
    'disposition','applied',
    'proposal_id',p_proposal_id,
    'distinct_approvers',v_distinct,
    'waive_decision',v_review_result->>'decision',
    'closes_or_resets_breaker',false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Critical windows + alert recording — visibility only, never applies.
-- ---------------------------------------------------------------------------
create or replace function public.list_it_intune_phase50_critical_windows(
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
  v_bucket:=to_char(
    to_timestamp(
      (floor(extract(epoch from now())/(v_hours*3600.0))
        *(v_hours*3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','breaker_tuning_awaiting_second_approval',
      'window_key','tunewait50:'||e.event_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','warning',
      'proposal_id',e.proposal_id
    ) order by e.recorded_at desc)
    from public.os_it_intune_breaker_tuning_phase50_apply_events e
    where e.disposition='awaiting_second_approval'
      and e.recorded_at>=now()-make_interval(hours => v_hours)
      and not exists (
        select 1 from public.os_it_intune_phase50_ops_alerts x
        where x.window_key=
          'tunewait50:'||e.event_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 25
  ), '[]'::jsonb) into v_part;
  v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','breaker_tuning_applied',
      'window_key','tuneapplied50:'||e.event_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','warning',
      'proposal_id',e.proposal_id
    ) order by e.recorded_at desc)
    from public.os_it_intune_breaker_tuning_phase50_apply_events e
    where e.disposition='applied'
      and e.recorded_at>=now()-make_interval(hours => v_hours)
      and not exists (
        select 1 from public.os_it_intune_phase50_ops_alerts x
        where x.window_key=
          'tuneapplied50:'||e.event_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 25
  ), '[]'::jsonb) into v_part;
  v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','promote_waive_awaiting_second_approval',
      'window_key','waivewait50:'||e.event_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','warning',
      'proposal_id',e.waive_proposal_id
    ) order by e.recorded_at desc)
    from public.os_it_intune_promote_waive_phase50_apply_events e
    where e.disposition='awaiting_second_approval'
      and e.recorded_at>=now()-make_interval(hours => v_hours)
      and not exists (
        select 1 from public.os_it_intune_phase50_ops_alerts x
        where x.window_key=
          'waivewait50:'||e.event_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 25
  ), '[]'::jsonb) into v_part;
  v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','promote_waive_applied',
      'window_key','waiveapplied50:'||e.event_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','warning',
      'proposal_id',e.waive_proposal_id
    ) order by e.recorded_at desc)
    from public.os_it_intune_promote_waive_phase50_apply_events e
    where e.disposition='applied'
      and e.recorded_at>=now()-make_interval(hours => v_hours)
      and not exists (
        select 1 from public.os_it_intune_phase50_ops_alerts x
        where x.window_key=
          'waiveapplied50:'||e.event_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 25
  ), '[]'::jsonb) into v_part;
  v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);

  return jsonb_build_object(
    'version','phase50-v1',
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',coalesce(v_pending,'[]'::jsonb),
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

create or replace function public.record_it_intune_phase50_ops_alert(p_alert jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_kind text;
  v_window text;
  v_dest text;
  v_delivery text;
  v_code integer;
  v_severity text;
  v_proposal uuid;
  v_evidence jsonb;
  v_hash text;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_alert,'{}'::jsonb))<>'object' then
    raise exception 'Phase 50 ops alert payload must be a JSON object';
  end if;

  v_kind:=coalesce(p_alert->>'alert_kind','');
  v_window:=coalesce(p_alert->>'window_key','');
  v_dest:=coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery:=coalesce(p_alert->>'delivery_status','recorded');
  v_code:=nullif(p_alert->>'response_code','')::integer;
  v_severity:=coalesce(nullif(p_alert->>'severity',''),'warning');
  v_proposal:=nullif(p_alert->>'proposal_id','')::uuid;

  if v_kind not in (
      'breaker_tuning_awaiting_second_approval','breaker_tuning_applied',
      'promote_waive_awaiting_second_approval','promote_waive_applied')
    or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
    or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
    or v_delivery not in
      ('delivered','skipped_no_webhook','failed','recorded')
    or v_severity not in ('warning','critical') then
    raise exception 'Phase 50 ops alert contract is invalid';
  end if;

  v_evidence:=public.it_intune_phase50_sanitize_aggregate(
    coalesce(p_alert->'aggregate_evidence','{}'::jsonb)
    || jsonb_build_object(
      'evidence_version','phase50-v1',
      'alert_kind',v_kind,
      'window_key',v_window,
      'severity',v_severity,
      'destination_key',v_dest,
      'delivery_status',v_delivery,
      'response_code',v_code,
      'proposal_id',v_proposal,
      'closes_or_resets_breaker',false
    )
  );
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_it_intune_phase50_ops_alerts(
    alert_kind,window_key,severity,destination_key,delivery_status,
    response_code,proposal_id,aggregate_evidence,evidence_sha256
  ) values (
    v_kind,v_window,v_severity,v_dest,v_delivery,v_code,
    v_proposal,v_evidence,v_hash
  )
  on conflict (window_key) do nothing
  returning alert_id into v_id;

  if v_id is null then
    select alert_id into v_id
    from public.os_it_intune_phase50_ops_alerts
    where window_key=v_window;
    return jsonb_build_object(
      'inserted',false,
      'alert_id',v_id,
      'window_key',v_window,
      'closes_or_resets_breaker',false);
  end if;

  return jsonb_build_object(
    'inserted',true,
    'alert_id',v_id,
    'window_key',v_window,
    'closes_or_resets_breaker',false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Ops report: suggested vs applied visibility for breaker tuning and
-- promote-waive. Aggregates never include entity identifiers.
-- ---------------------------------------------------------------------------
create or replace function public.get_it_intune_phase50_ops_report()
returns jsonb
language plpgsql
stable
security definer
set search_path=public as $$
declare
  v_tune_suggested integer:=0;
  v_tune_awaiting integer:=0;
  v_tune_applied integer:=0;
  v_tune_blocked integer:=0;
  v_waive_suggested integer:=0;
  v_waive_awaiting integer:=0;
  v_waive_applied integer:=0;
  v_waive_blocked integer:=0;
  v_tune_events jsonb;
  v_waive_events jsonb;
  v_alerts jsonb;
begin
  select count(*)::integer into v_tune_suggested
  from public.os_it_intune_breaker_tuning_proposals;

  select count(*)::integer into v_tune_awaiting
  from public.os_it_intune_breaker_tuning_phase50_apply_events
  where disposition='awaiting_second_approval';

  select count(*)::integer into v_tune_applied
  from public.os_it_intune_breaker_tuning_phase50_apply_events
  where disposition='applied';

  select count(*)::integer into v_tune_blocked
  from public.os_it_intune_breaker_tuning_phase50_apply_events
  where disposition='blocked';

  select count(*)::integer into v_waive_suggested
  from public.os_it_intune_promote_waive_proposals;

  select count(*)::integer into v_waive_awaiting
  from public.os_it_intune_promote_waive_phase50_apply_events
  where disposition='awaiting_second_approval';

  select count(*)::integer into v_waive_applied
  from public.os_it_intune_promote_waive_phase50_apply_events
  where disposition='applied';

  select count(*)::integer into v_waive_blocked
  from public.os_it_intune_promote_waive_phase50_apply_events
  where disposition='blocked';

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_tune_events
  from (
    select e.event_id,e.proposal_id,e.disposition,e.distinct_approvers,
      e.block_reason,e.evidence_sha256,e.recorded_at
    from public.os_it_intune_breaker_tuning_phase50_apply_events e
    order by e.recorded_at desc
    limit 50
  ) x;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_waive_events
  from (
    select e.event_id,e.waive_proposal_id,e.disposition,e.distinct_approvers,
      e.block_reason,e.evidence_sha256,e.recorded_at
    from public.os_it_intune_promote_waive_phase50_apply_events e
    order by e.recorded_at desc
    limit 50
  ) x;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_alerts
  from (
    select al.alert_id,al.alert_kind,al.window_key,al.severity,
      al.destination_key,al.delivery_status,al.response_code,
      al.proposal_id,al.evidence_sha256,al.recorded_at
    from public.os_it_intune_phase50_ops_alerts al
    order by al.recorded_at desc
    limit 50
  ) x;

  return jsonb_build_object(
    'version','phase50-v1',
    'breaker_tuning_suggested_count',v_tune_suggested,
    'breaker_tuning_awaiting_second_approval_count',v_tune_awaiting,
    'breaker_tuning_applied_count',v_tune_applied,
    'breaker_tuning_blocked_count',v_tune_blocked,
    'promote_waive_suggested_count',v_waive_suggested,
    'promote_waive_awaiting_second_approval_count',v_waive_awaiting,
    'promote_waive_applied_count',v_waive_applied,
    'promote_waive_blocked_count',v_waive_blocked,
    'breaker_tuning_apply_events',v_tune_events,
    'promote_waive_apply_events',v_waive_events,
    'ops_alerts',v_alerts,
    'destination_key','ops_alerts',
    'requires_dual_approval',true,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

revoke all on function public.it_intune_phase50_sanitize_aggregate(jsonb)
  from public,authenticated,service_role;
revoke all on function public.approve_it_intune_breaker_tuning_phase50(uuid,uuid,text,text,bigint)
  from public;
revoke all on function public.approve_it_intune_promote_waive_phase50(uuid,uuid,text,text,bigint)
  from public;
revoke all on function public.list_it_intune_phase50_critical_windows(integer)
  from public,authenticated;
revoke all on function public.record_it_intune_phase50_ops_alert(jsonb)
  from public,authenticated;
revoke all on function public.get_it_intune_phase50_ops_report()
  from public,authenticated;
revoke all on function public.prevent_it_intune_phase50_ops_mutation()
  from public,authenticated,service_role;

grant execute on function public.approve_it_intune_breaker_tuning_phase50(uuid,uuid,text,text,bigint),
  public.approve_it_intune_promote_waive_phase50(uuid,uuid,text,text,bigint)
  to authenticated, service_role;

grant execute on function public.list_it_intune_phase50_critical_windows(integer),
  public.record_it_intune_phase50_ops_alert(jsonb),
  public.get_it_intune_phase50_ops_report()
  to service_role;

grant execute on function public.list_it_intune_phase50_critical_windows(integer),
  public.get_it_intune_phase50_ops_report()
  to authenticated;
