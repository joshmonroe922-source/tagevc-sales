-- Phase 50: gated DUAL-APPROVED promotion from Phase 49 autopilot dry-run
-- ("would_promote") into the actual Phase 47 cohort auto-reject promote RPC,
-- plus cohort readiness/promotion visibility. Apply after
-- phase49_marketing_revenue_ops.sql. Safe to re-run.
-- Never stores secret values — hashes, counts, statuses, and safe metadata only.
-- Never mutates snapshot retirement tables. NEVER auto-approves money: a
-- proposal can only move toward "applied" after 2 DISTINCT human approvers
-- (neither of whom may be the proposer) explicitly approve it. Never calls
-- any money-correction approve RPC (e.g. review_marketing_revenue_correction).

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

-- Bootstrap Phase 49 safe-metadata helper if prior Marketing SQL was skipped.
create or replace function public.phase49_marketing_ops_safe_metadata(p_detail jsonb)
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

create or replace function public.phase50_marketing_ops_safe_metadata(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select public.phase49_marketing_ops_safe_metadata(p_detail);
$$;

-- ---------------------------------------------------------------------------
-- Append-only dual-approve promotion proposals sourced from a Phase 49
-- "would_promote" dry-run snapshot. Each state transition is a NEW row
-- (proposal_key varies per transition) referencing source_proposal_id, so the
-- table stays append-only while still expressing a status lifecycle.
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_dry_run_promotion_proposals (
  proposal_id uuid primary key default gen_random_uuid(),
  proposal_key text not null unique
    check (proposal_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  source_proposal_id uuid
    references public.os_marketing_revenue_dry_run_promotion_proposals(proposal_id),
  dry_run_id uuid
    references public.os_marketing_revenue_autopilot_dry_run_snapshots(dry_run_id),
  cohort_id uuid not null
    references public.os_marketing_revenue_promotion_cohorts(cohort_id),
  proposed_by uuid not null,
  status text not null check (status in
    ('pending','approved','rejected','blocked','applied')),
  block_reason text,
  promotion_id uuid,
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (public.phase50_marketing_ops_safe_metadata(metadata)),
  check (
    (status in ('pending','approved','applied') and block_reason is null)
    or (status in ('rejected','blocked') and block_reason is not null
      and length(block_reason) between 8 and 500)
  ),
  -- Never auto-approves money: a proposal can only be created from a dry-run
  -- that already predicted 'would_promote'; the RPC layer enforces this too.
  check (coalesce((metadata->>'never_auto_approves_money')::boolean,true) = true)
);

-- Only one open (pending) dual-approve proposal per cohort at a time.
create unique index if not exists os_mkt_rev_p50_promo_prop_open_uidx
  on public.os_marketing_revenue_dry_run_promotion_proposals(cohort_id)
  where status = 'pending';
create index if not exists os_mkt_rev_p50_promo_prop_created_idx
  on public.os_marketing_revenue_dry_run_promotion_proposals(created_at desc);
create index if not exists os_mkt_rev_p50_promo_prop_status_idx
  on public.os_marketing_revenue_dry_run_promotion_proposals(status, created_at desc);
create index if not exists os_mkt_rev_p50_promo_prop_cohort_idx
  on public.os_marketing_revenue_dry_run_promotion_proposals(cohort_id, created_at desc);

alter table public.os_marketing_revenue_dry_run_promotion_proposals
  enable row level security;
drop policy if exists "os_mkt_rev_p50_promo_prop_select"
  on public.os_marketing_revenue_dry_run_promotion_proposals;
create policy "os_mkt_rev_p50_promo_prop_select"
  on public.os_marketing_revenue_dry_run_promotion_proposals for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_marketing_revenue_dry_run_promotion_proposals
  from public, anon, authenticated;
grant select on public.os_marketing_revenue_dry_run_promotion_proposals
  to authenticated;

-- ---------------------------------------------------------------------------
-- Append-only distinct-actor dual approvals. Unique per proposal+actor so the
-- same human cannot supply both required approvals.
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_dry_run_promotion_approvals (
  approval_id uuid primary key default gen_random_uuid(),
  approval_key text not null unique
    check (approval_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  proposal_id uuid not null
    references public.os_marketing_revenue_dry_run_promotion_proposals(proposal_id),
  actor_id uuid not null,
  decision text not null check (decision in ('approve','reject')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (public.phase50_marketing_ops_safe_metadata(metadata))
);

create unique index if not exists os_mkt_rev_p50_promo_appr_distinct_actor_idx
  on public.os_marketing_revenue_dry_run_promotion_approvals(proposal_id, actor_id);
create index if not exists os_mkt_rev_p50_promo_appr_created_idx
  on public.os_marketing_revenue_dry_run_promotion_approvals(created_at desc);

alter table public.os_marketing_revenue_dry_run_promotion_approvals
  enable row level security;
drop policy if exists "os_mkt_rev_p50_promo_appr_select"
  on public.os_marketing_revenue_dry_run_promotion_approvals;
create policy "os_mkt_rev_p50_promo_appr_select"
  on public.os_marketing_revenue_dry_run_promotion_approvals for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_marketing_revenue_dry_run_promotion_approvals
  from public, anon, authenticated;
grant select on public.os_marketing_revenue_dry_run_promotion_approvals
  to authenticated;

-- ---------------------------------------------------------------------------
-- Append-only cohort readiness/promotion visibility snapshots.
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_cohort_readiness_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  snapshot_key text not null unique
    check (snapshot_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  cohort_id uuid not null
    references public.os_marketing_revenue_promotion_cohorts(cohort_id),
  readiness_status text not null check (readiness_status in
    ('ready','soaking','blocked','pending_dual_approval','unknown')),
  consecutive_healthy_windows integer not null default 0
    check (consecutive_healthy_windows >= 0),
  windows_required integer not null default 0
    check (windows_required >= 0),
  pending_proposal_count integer not null default 0
    check (pending_proposal_count >= 0),
  applied_proposal_count integer not null default 0
    check (applied_proposal_count >= 0),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (public.phase50_marketing_ops_safe_metadata(metadata))
);

create index if not exists os_mkt_rev_p50_readiness_created_idx
  on public.os_marketing_revenue_cohort_readiness_snapshots(created_at desc);
create index if not exists os_mkt_rev_p50_readiness_cohort_idx
  on public.os_marketing_revenue_cohort_readiness_snapshots(cohort_id, created_at desc);

alter table public.os_marketing_revenue_cohort_readiness_snapshots
  enable row level security;
drop policy if exists "os_mkt_rev_p50_readiness_select"
  on public.os_marketing_revenue_cohort_readiness_snapshots;
create policy "os_mkt_rev_p50_readiness_select"
  on public.os_marketing_revenue_cohort_readiness_snapshots for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_marketing_revenue_cohort_readiness_snapshots
  from public, anon, authenticated;
grant select on public.os_marketing_revenue_cohort_readiness_snapshots
  to authenticated;

-- ---------------------------------------------------------------------------
-- Phase 50 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_phase50_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  entity_id text references public.entities(entity_id),
  cohort_id uuid,
  proposal_id uuid,
  alert_kind text not null,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null default 'critical' check (severity = 'critical'),
  destination_key text not null check (destination_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  delivery_status text not null check (delivery_status in
    ('delivered','skipped_no_webhook','failed','recorded')),
  response_code integer check (response_code is null or response_code between 100 and 599),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_mkt_rev_p50_alert_kind_check
    check (alert_kind in (
      'promotion_proposal_awaiting_second_approval',
      'promotion_proposal_applied',
      'cohort_readiness_blocked'
    )),
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (public.phase50_marketing_ops_safe_metadata(metadata))
);

create index if not exists os_mkt_rev_p50_alert_created_idx
  on public.os_marketing_revenue_phase50_ops_alerts(created_at desc);
create index if not exists os_mkt_rev_p50_alert_kind_idx
  on public.os_marketing_revenue_phase50_ops_alerts(alert_kind, created_at desc);

alter table public.os_marketing_revenue_phase50_ops_alerts
  enable row level security;
drop policy if exists "os_mkt_rev_p50_alert_select"
  on public.os_marketing_revenue_phase50_ops_alerts;
create policy "os_mkt_rev_p50_alert_select"
  on public.os_marketing_revenue_phase50_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_marketing_revenue_phase50_ops_alerts
  from public, anon, authenticated;
grant select on public.os_marketing_revenue_phase50_ops_alerts
  to authenticated;

create or replace function public.reject_marketing_phase50_ops_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Marketing revenue Phase 50 ops evidence is append-only';
end;
$$;

drop trigger if exists os_mkt_rev_p50_promo_prop_immutable
  on public.os_marketing_revenue_dry_run_promotion_proposals;
create trigger os_mkt_rev_p50_promo_prop_immutable
  before update or delete on public.os_marketing_revenue_dry_run_promotion_proposals
  for each row execute function public.reject_marketing_phase50_ops_mutation();
drop trigger if exists os_mkt_rev_p50_promo_prop_no_truncate
  on public.os_marketing_revenue_dry_run_promotion_proposals;
create trigger os_mkt_rev_p50_promo_prop_no_truncate
  before truncate on public.os_marketing_revenue_dry_run_promotion_proposals
  for each statement execute function public.reject_marketing_phase50_ops_mutation();

drop trigger if exists os_mkt_rev_p50_promo_appr_immutable
  on public.os_marketing_revenue_dry_run_promotion_approvals;
create trigger os_mkt_rev_p50_promo_appr_immutable
  before update or delete on public.os_marketing_revenue_dry_run_promotion_approvals
  for each row execute function public.reject_marketing_phase50_ops_mutation();
drop trigger if exists os_mkt_rev_p50_promo_appr_no_truncate
  on public.os_marketing_revenue_dry_run_promotion_approvals;
create trigger os_mkt_rev_p50_promo_appr_no_truncate
  before truncate on public.os_marketing_revenue_dry_run_promotion_approvals
  for each statement execute function public.reject_marketing_phase50_ops_mutation();

drop trigger if exists os_mkt_rev_p50_readiness_immutable
  on public.os_marketing_revenue_cohort_readiness_snapshots;
create trigger os_mkt_rev_p50_readiness_immutable
  before update or delete on public.os_marketing_revenue_cohort_readiness_snapshots
  for each row execute function public.reject_marketing_phase50_ops_mutation();
drop trigger if exists os_mkt_rev_p50_readiness_no_truncate
  on public.os_marketing_revenue_cohort_readiness_snapshots;
create trigger os_mkt_rev_p50_readiness_no_truncate
  before truncate on public.os_marketing_revenue_cohort_readiness_snapshots
  for each statement execute function public.reject_marketing_phase50_ops_mutation();

drop trigger if exists os_mkt_rev_p50_alert_immutable
  on public.os_marketing_revenue_phase50_ops_alerts;
create trigger os_mkt_rev_p50_alert_immutable
  before update or delete on public.os_marketing_revenue_phase50_ops_alerts
  for each row execute function public.reject_marketing_phase50_ops_mutation();
drop trigger if exists os_mkt_rev_p50_alert_no_truncate
  on public.os_marketing_revenue_phase50_ops_alerts;
create trigger os_mkt_rev_p50_alert_no_truncate
  before truncate on public.os_marketing_revenue_phase50_ops_alerts
  for each statement execute function public.reject_marketing_phase50_ops_mutation();

-- ---------------------------------------------------------------------------
-- Propose (NEVER auto-approve) a dual-approve promotion from an existing
-- Phase 49 dry-run snapshot that predicted 'would_promote'. This function
-- NEVER calls promote — it only records intent for two distinct humans to
-- review.
-- ---------------------------------------------------------------------------
create or replace function public.propose_marketing_dry_run_promote_phase50(
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_payload->'metadata', '{}'::jsonb);
  v_dry_run_id uuid := nullif(p_payload->>'dry_run_id','')::uuid;
  v_actor uuid := nullif(p_payload->>'proposed_by','')::uuid;
  v_dry_run public.os_marketing_revenue_autopilot_dry_run_snapshots%rowtype;
  v_key text;
  v_hash text;
  v_row public.os_marketing_revenue_dry_run_promotion_proposals%rowtype;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Dual-approve promotion proposal payload must be a JSON object';
  end if;
  if v_dry_run_id is null or v_actor is null
    or not public.phase50_marketing_ops_safe_metadata(v_meta) then
    raise exception 'Dual-approve promotion proposal requires dry_run_id, proposed_by, and safe metadata';
  end if;

  select * into v_dry_run
  from public.os_marketing_revenue_autopilot_dry_run_snapshots
  where dry_run_id = v_dry_run_id;
  if v_dry_run.dry_run_id is null then
    raise exception 'Dry-run snapshot is unknown';
  end if;
  if v_dry_run.predicted_status <> 'would_promote' then
    raise exception 'Only a would_promote dry-run snapshot may be proposed for promotion';
  end if;

  if exists (
    select 1 from public.os_marketing_revenue_dry_run_promotion_proposals p
    where p.cohort_id = v_dry_run.cohort_id and p.status = 'pending'
  ) then
    select * into v_row
    from public.os_marketing_revenue_dry_run_promotion_proposals
    where cohort_id = v_dry_run.cohort_id and status = 'pending'
    order by created_at desc
    limit 1;
    return jsonb_build_object(
      'version','phase50-v1',
      'disposition','unchanged',
      'status','pending',
      'proposal_id',v_row.proposal_id,
      'proposal_key',v_row.proposal_key,
      'never_auto_approves_money',true);
  end if;

  v_key := left(
    'promoprop50:' || v_dry_run.cohort_id::text || ':' || v_dry_run_id::text,
    200);
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase50-v1',
    'kind','dry_run_promotion_proposal',
    'proposal_key',v_key,
    'cohort_id',v_dry_run.cohort_id,
    'dry_run_id',v_dry_run_id,
    'proposed_by',v_actor
  )::text);

  insert into public.os_marketing_revenue_dry_run_promotion_proposals(
    proposal_key,dry_run_id,cohort_id,proposed_by,status,metrics_sha256,metadata)
  values (
    v_key,v_dry_run_id,v_dry_run.cohort_id,v_actor,'pending',v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase50-v1',
      'never_auto_approves_money',true,
      'never_calls_correction_approve',true))
  on conflict (proposal_key) do nothing
  returning * into v_row;

  if v_row.proposal_id is null then
    select * into v_row
    from public.os_marketing_revenue_dry_run_promotion_proposals
    where proposal_key = v_key;
    return jsonb_build_object(
      'version','phase50-v1',
      'disposition','unchanged',
      'status',v_row.status,
      'proposal_id',v_row.proposal_id,
      'proposal_key',v_row.proposal_key,
      'never_auto_approves_money',true);
  end if;

  return jsonb_build_object(
    'version','phase50-v1',
    'disposition','proposed',
    'status','pending',
    'proposal_id',v_row.proposal_id,
    'proposal_key',v_row.proposal_key,
    'cohort_id',v_row.cohort_id,
    'never_auto_approves_money',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Dual-human approval: only after 2 DISTINCT approving actors (neither of
-- whom is the proposer) does this call the EXISTING Phase 47 cohort
-- auto-reject promote RPC. NEVER calls any money-correction approve RPC.
-- ---------------------------------------------------------------------------
create or replace function public.approve_marketing_dry_run_promote_phase50(
  p_proposal_id uuid,
  p_actor_id uuid,
  p_decision text default 'approve',
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_decision text := coalesce(nullif(trim(lower(p_decision)), ''), 'approve');
  v_proposal public.os_marketing_revenue_dry_run_promotion_proposals%rowtype;
  v_approval_key text;
  v_hash text;
  v_id uuid;
  v_distinct_approvers integer := 0;
  v_promote jsonb;
  v_block_reason text;
  v_result_key text;
  v_result_row public.os_marketing_revenue_dry_run_promotion_proposals%rowtype;
begin
  if p_proposal_id is null or p_actor_id is null
    or v_decision not in ('approve','reject')
    or not public.phase50_marketing_ops_safe_metadata(v_meta) then
    raise exception 'Phase 50 dual-approve promotion contract is invalid or unsafe';
  end if;

  select * into v_proposal
  from public.os_marketing_revenue_dry_run_promotion_proposals
  where proposal_id = p_proposal_id;
  if v_proposal.proposal_id is null then
    raise exception 'Dual-approve promotion proposal is unknown';
  end if;
  if v_proposal.proposed_by = p_actor_id then
    raise exception 'Proposer may not also approve their own promotion proposal';
  end if;
  if v_proposal.status <> 'pending' then
    return jsonb_build_object(
      'version','phase50-v1',
      'disposition','unchanged',
      'status',v_proposal.status,
      'proposal_id',v_proposal.proposal_id,
      'never_auto_approves_money',true);
  end if;

  v_approval_key := p_proposal_id::text || ':' || p_actor_id::text;
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase50-v1',
    'kind','dry_run_promotion_approval',
    'proposal_id',p_proposal_id,
    'actor_id',p_actor_id,
    'decision',v_decision
  )::text);

  insert into public.os_marketing_revenue_dry_run_promotion_approvals(
    approval_key,proposal_id,actor_id,decision,metrics_sha256,metadata)
  values (
    v_approval_key,p_proposal_id,p_actor_id,v_decision,v_hash,
    v_meta || jsonb_build_object('contract_version','phase50-v1'))
  on conflict (approval_key) do nothing
  returning approval_id into v_id;

  if v_id is null then
    return jsonb_build_object(
      'version','phase50-v1',
      'disposition','unchanged',
      'status','duplicate_actor_decision',
      'proposal_id',p_proposal_id,
      'never_auto_approves_money',true);
  end if;

  if v_decision = 'reject' then
    v_result_key := 'promoprop50:rejected:' || p_proposal_id::text;
    insert into public.os_marketing_revenue_dry_run_promotion_proposals(
      proposal_key,source_proposal_id,dry_run_id,cohort_id,proposed_by,
      status,block_reason,metrics_sha256,metadata)
    values (
      v_result_key,p_proposal_id,v_proposal.dry_run_id,v_proposal.cohort_id,
      v_proposal.proposed_by,'rejected','rejected_by_approver',
      public.os_sha256_hex('reject:' || p_proposal_id::text),
      v_meta || jsonb_build_object('contract_version','phase50-v1'))
    on conflict (proposal_key) do nothing;
    return jsonb_build_object(
      'version','phase50-v1',
      'disposition','rejected',
      'status','rejected',
      'proposal_id',p_proposal_id,
      'never_auto_approves_money',true);
  end if;

  select count(distinct actor_id)::integer into v_distinct_approvers
  from public.os_marketing_revenue_dry_run_promotion_approvals
  where proposal_id = p_proposal_id
    and decision = 'approve'
    and actor_id <> v_proposal.proposed_by;

  if v_distinct_approvers < 2 then
    return jsonb_build_object(
      'version','phase50-v1',
      'disposition','awaiting_second_approval',
      'status','pending',
      'proposal_id',p_proposal_id,
      'distinct_approvers',v_distinct_approvers,
      'never_auto_approves_money',true);
  end if;

  -- Dual-human approval satisfied. This is the ONLY path that may call the
  -- existing Phase 47 cohort auto-reject promote RPC. Never auto-approves
  -- money and never calls any correction-approve RPC.
  begin
    v_promote := public.promote_marketing_auto_reject_cohort_phase47(
      jsonb_build_object(
        'cohort_id',v_proposal.cohort_id,
        'created_by',p_actor_id,
        'metadata', v_meta || jsonb_build_object(
          'contract_version','phase50-v1',
          'dual_approved',true,
          'source_proposal_id',v_proposal.proposal_id)
      ));
  exception when others then
    v_block_reason := sqlerrm;
    v_promote := null;
  end;

  if v_promote is null
    or coalesce(v_promote->>'promotion_status','') <> 'promoted' then
    v_result_key := 'promoprop50:blocked:' || p_proposal_id::text;
    insert into public.os_marketing_revenue_dry_run_promotion_proposals(
      proposal_key,source_proposal_id,dry_run_id,cohort_id,proposed_by,
      status,block_reason,promotion_id,metrics_sha256,metadata)
    values (
      v_result_key,p_proposal_id,v_proposal.dry_run_id,v_proposal.cohort_id,
      v_proposal.proposed_by,'blocked',
      left(coalesce(v_block_reason, coalesce(v_promote->>'block_reason','promotion_blocked')),500),
      nullif(v_promote->>'promotion_id','')::uuid,
      public.os_sha256_hex('blocked:' || p_proposal_id::text),
      v_meta || jsonb_build_object('contract_version','phase50-v1'))
    on conflict (proposal_key) do nothing
    returning * into v_result_row;
    return jsonb_build_object(
      'version','phase50-v1',
      'disposition','blocked',
      'status','blocked',
      'proposal_id',p_proposal_id,
      'block_reason',v_result_row.block_reason,
      'distinct_approvers',v_distinct_approvers,
      'never_auto_approves_money',true);
  end if;

  v_result_key := 'promoprop50:applied:' || p_proposal_id::text;
  insert into public.os_marketing_revenue_dry_run_promotion_proposals(
    proposal_key,source_proposal_id,dry_run_id,cohort_id,proposed_by,
    status,promotion_id,metrics_sha256,metadata)
  values (
    v_result_key,p_proposal_id,v_proposal.dry_run_id,v_proposal.cohort_id,
    v_proposal.proposed_by,'applied',
    nullif(v_promote->>'promotion_id','')::uuid,
    public.os_sha256_hex('applied:' || p_proposal_id::text),
    v_meta || jsonb_build_object(
      'contract_version','phase50-v1',
      'dual_approved',true,
      'promotion_id',v_promote->>'promotion_id'))
  on conflict (proposal_key) do nothing
  returning * into v_result_row;

  return jsonb_build_object(
    'version','phase50-v1',
    'disposition','applied',
    'status','applied',
    'proposal_id',coalesce(v_result_row.proposal_id,p_proposal_id),
    'source_proposal_id',p_proposal_id,
    'promotion_id',v_promote->>'promotion_id',
    'distinct_approvers',v_distinct_approvers,
    'never_auto_approves_money',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Record a read + append-only cohort readiness/promotion-visibility snapshot.
-- ---------------------------------------------------------------------------
create or replace function public.record_marketing_cohort_readiness_snapshot_phase50(
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_payload->'metadata', '{}'::jsonb);
  v_actor uuid := nullif(p_payload->>'actor_id','')::uuid;
  v_cohort public.os_marketing_revenue_promotion_cohorts%rowtype;
  v_dry_run public.os_marketing_revenue_autopilot_dry_run_snapshots%rowtype;
  v_pending integer;
  v_applied integer;
  v_status text;
  v_key text;
  v_hash text;
  v_id uuid;
  v_recorded integer := 0;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Cohort readiness snapshot payload must be a JSON object';
  end if;
  if not public.phase50_marketing_ops_safe_metadata(v_meta) then
    raise exception 'Cohort readiness snapshot metadata is invalid or unsafe';
  end if;

  for v_cohort in
    select * from public.os_marketing_revenue_promotion_cohorts
    where status = 'active'
    order by created_at desc
    limit 50
  loop
    select * into v_dry_run
    from public.os_marketing_revenue_autopilot_dry_run_snapshots
    where cohort_id = v_cohort.cohort_id
    order by created_at desc
    limit 1;

    select count(*)::integer into v_pending
    from public.os_marketing_revenue_dry_run_promotion_proposals
    where cohort_id = v_cohort.cohort_id and status = 'pending';

    select count(*)::integer into v_applied
    from public.os_marketing_revenue_dry_run_promotion_proposals
    where cohort_id = v_cohort.cohort_id and status = 'applied';

    if v_dry_run.dry_run_id is null then
      v_status := 'unknown';
    elsif v_pending > 0 then
      v_status := 'pending_dual_approval';
    elsif v_dry_run.predicted_status = 'would_block' then
      v_status := 'blocked';
    elsif v_dry_run.predicted_status = 'would_wait' then
      v_status := 'soaking';
    else
      v_status := 'ready';
    end if;

    v_key := left(
      'readiness50:' || v_cohort.cohort_id::text || ':' ||
        to_char(now(),'YYYYMMDD"T"HH24'),
      200);
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase50-v1',
      'kind','cohort_readiness_snapshot',
      'cohort_id',v_cohort.cohort_id,
      'readiness_status',v_status,
      'consecutive_healthy_windows',coalesce(v_dry_run.consecutive_healthy_windows,0),
      'windows_required',coalesce(v_dry_run.windows_required,0),
      'pending_proposal_count',v_pending,
      'applied_proposal_count',v_applied
    )::text);

    insert into public.os_marketing_revenue_cohort_readiness_snapshots(
      snapshot_key,cohort_id,readiness_status,consecutive_healthy_windows,
      windows_required,pending_proposal_count,applied_proposal_count,
      metrics_sha256,metadata)
    values (
      v_key,v_cohort.cohort_id,v_status,
      coalesce(v_dry_run.consecutive_healthy_windows,0),
      coalesce(v_dry_run.windows_required,0),v_pending,v_applied,v_hash,
      v_meta || jsonb_build_object('contract_version','phase50-v1'))
    on conflict (snapshot_key) do nothing
    returning snapshot_id into v_id;

    if v_id is not null then
      v_recorded := v_recorded + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'version','phase50-v1',
    'snapshots_recorded',v_recorded,
    'never_auto_approves_money',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- List critical windows that still need an idempotent ops alert insert
-- ---------------------------------------------------------------------------
create or replace function public.list_marketing_revenue_phase50_critical_windows(
  p_days integer default 30,
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
  v_proposal public.os_marketing_revenue_dry_run_promotion_proposals%rowtype;
  v_readiness public.os_marketing_revenue_cohort_readiness_snapshots%rowtype;
  v_key text;
begin
  v_bucket := to_char(
    to_timestamp(
      (floor(extract(epoch from now()) / (v_hours * 3600.0))
        * (v_hours * 3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  select * into v_proposal
  from public.os_marketing_revenue_dry_run_promotion_proposals
  where status = 'pending'
  order by created_at desc
  limit 1;

  if v_proposal.proposal_id is not null then
    v_key := 'promoawait50:firm:' || v_proposal.proposal_id::text || ':' || v_bucket || 'h' || v_hours::text;
    if not exists (
      select 1 from public.os_marketing_revenue_phase50_ops_alerts a
      where a.window_key = v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','promotion_proposal_awaiting_second_approval',
        'cohort_id',v_proposal.cohort_id,
        'proposal_id',v_proposal.proposal_id,
        'window_key',v_key,
        'severity','critical',
        'metrics_sha256',v_proposal.metrics_sha256
      ));
    end if;
  end if;

  select * into v_proposal
  from public.os_marketing_revenue_dry_run_promotion_proposals
  where status = 'applied'
  order by created_at desc
  limit 1;

  if v_proposal.proposal_id is not null then
    v_key := 'promoapplied50:firm:' || v_proposal.proposal_id::text;
    if not exists (
      select 1 from public.os_marketing_revenue_phase50_ops_alerts a
      where a.window_key = v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','promotion_proposal_applied',
        'cohort_id',v_proposal.cohort_id,
        'proposal_id',v_proposal.proposal_id,
        'window_key',v_key,
        'severity','critical',
        'metrics_sha256',v_proposal.metrics_sha256
      ));
    end if;
  end if;

  select * into v_readiness
  from public.os_marketing_revenue_cohort_readiness_snapshots
  where readiness_status = 'blocked'
  order by created_at desc
  limit 1;

  if v_readiness.snapshot_id is not null then
    v_key := 'readinessblocked50:firm:' || v_bucket || 'h' || v_hours::text;
    if not exists (
      select 1 from public.os_marketing_revenue_phase50_ops_alerts a
      where a.window_key = v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','cohort_readiness_blocked',
        'cohort_id',v_readiness.cohort_id,
        'proposal_id',null,
        'window_key',v_key,
        'severity','critical',
        'metrics_sha256',v_readiness.metrics_sha256
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
-- Record one critical ops alert after delivery attempt (idempotent window_key)
-- ---------------------------------------------------------------------------
create or replace function public.record_marketing_revenue_phase50_ops_alert(
  p_alert jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_kind text;
  v_window text;
  v_cohort uuid;
  v_proposal uuid;
  v_dest text;
  v_delivery text;
  v_code integer;
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
  v_cohort := nullif(p_alert->>'cohort_id','')::uuid;
  v_proposal := nullif(p_alert->>'proposal_id','')::uuid;
  v_dest := coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery := coalesce(p_alert->>'delivery_status','recorded');
  v_code := nullif(p_alert->>'response_code','')::integer;
  v_meta := coalesce(p_alert->'metadata','{}'::jsonb);

  if v_kind not in (
       'promotion_proposal_awaiting_second_approval',
       'promotion_proposal_applied',
       'cohort_readiness_blocked'
     )
     or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
     or v_dest ~* '://|^https?'
     or v_delivery not in
       ('delivered','skipped_no_webhook','failed','recorded')
     or not public.phase50_marketing_ops_safe_metadata(v_meta) then
    raise exception 'Phase 50 ops alert contract is invalid or unsafe';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase50-v1',
    'alert_kind',v_kind,
    'cohort_id',v_cohort,
    'proposal_id',v_proposal,
    'window_key',v_window,
    'severity','critical',
    'destination_key',v_dest,
    'delivery_status',v_delivery,
    'response_code',v_code
  )::text);

  insert into public.os_marketing_revenue_phase50_ops_alerts(
    cohort_id,proposal_id,alert_kind,window_key,severity,destination_key,
    delivery_status,response_code,metrics_sha256,metadata)
  values (
    v_cohort,v_proposal,v_kind,v_window,'critical',v_dest,
    v_delivery,v_code,v_hash,
    v_meta || jsonb_build_object('contract_version','phase50-v1'))
  on conflict (window_key) do nothing
  returning alert_id, delivery_status into v_id, v_status;

  if v_id is null then
    select alert_id, delivery_status into v_id, v_status
    from public.os_marketing_revenue_phase50_ops_alerts
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
-- Hub report: dual-approve promotion visibility + cohort readiness + alerts
-- ---------------------------------------------------------------------------
create or replace function public.get_marketing_revenue_phase50_ops_report(
  p_entity_id text default null,
  p_days integer default 30
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 90);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_proposals jsonb;
  v_readiness jsonb;
  v_alerts jsonb;
  v_pending_count integer := 0;
  v_applied_count integer := 0;
  v_blocked_count integer := 0;
  v_rejected_count integer := 0;
  v_promotion_health text := 'unknown';
  v_alert_delivery text := 'none';
  v_failed boolean := false;
  v_skipped boolean := false;
  v_delivered boolean := false;
  v_recorded boolean := false;
begin
  select
    count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'applied'),
    count(*) filter (where status = 'blocked'),
    count(*) filter (where status = 'rejected')
  into v_pending_count, v_applied_count, v_blocked_count, v_rejected_count
  from public.os_marketing_revenue_dry_run_promotion_proposals
  where created_at >= v_since
    and (p_entity_id is null or true);

  if v_pending_count + v_applied_count + v_blocked_count + v_rejected_count = 0 then
    v_promotion_health := 'unknown';
  elsif v_blocked_count = 0 then
    v_promotion_health := 'healthy';
  elsif v_applied_count > 0 then
    v_promotion_health := 'watch';
  else
    v_promotion_health := 'critical';
  end if;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc), '[]'::jsonb)
  into v_proposals
  from (
    select proposal_id, proposal_key, source_proposal_id, cohort_id,
      proposed_by, status, block_reason, promotion_id, metrics_sha256, created_at
    from public.os_marketing_revenue_dry_run_promotion_proposals
    where created_at >= v_since
    order by created_at desc
    limit 50
  ) p;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb)
  into v_readiness
  from (
    select distinct on (cohort_id) snapshot_id, cohort_id, readiness_status,
      consecutive_healthy_windows, windows_required, pending_proposal_count,
      applied_proposal_count, created_at
    from public.os_marketing_revenue_cohort_readiness_snapshots
    where created_at >= v_since
    order by cohort_id, created_at desc
    limit 50
  ) r;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
  into v_alerts
  from (
    select alert_id, cohort_id, proposal_id, alert_kind, window_key, severity,
      destination_key, delivery_status, response_code, metrics_sha256, created_at
    from public.os_marketing_revenue_phase50_ops_alerts
    order by created_at desc
    limit 20
  ) a;

  select
    bool_or(x.delivery_status = 'failed'),
    bool_or(x.delivery_status = 'skipped_no_webhook'),
    bool_or(x.delivery_status = 'delivered'),
    bool_or(x.delivery_status = 'recorded')
  into v_failed, v_skipped, v_delivered, v_recorded
  from public.os_marketing_revenue_phase50_ops_alerts x
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
    'window_days',v_days,
    'promotion_health',v_promotion_health,
    'alert_delivery',v_alert_delivery,
    'pending_proposal_count',v_pending_count,
    'applied_proposal_count',v_applied_count,
    'blocked_proposal_count',v_blocked_count,
    'rejected_proposal_count',v_rejected_count,
    'proposals',coalesce(v_proposals,'[]'::jsonb),
    'cohort_readiness',coalesce(v_readiness,'[]'::jsonb),
    'alerts',coalesce(v_alerts,'[]'::jsonb),
    'destination_key','ops_alerts',
    'never_auto_approves_money',true
  );
end;
$$;

revoke all on function public.phase50_marketing_ops_safe_metadata(jsonb)
  from public, anon, authenticated;
revoke all on function public.propose_marketing_dry_run_promote_phase50(jsonb)
  from public, anon, authenticated;
revoke all on function public.approve_marketing_dry_run_promote_phase50(uuid,uuid,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.record_marketing_cohort_readiness_snapshot_phase50(jsonb)
  from public, anon, authenticated;
revoke all on function public.list_marketing_revenue_phase50_critical_windows(integer,integer)
  from public, anon, authenticated;
revoke all on function public.record_marketing_revenue_phase50_ops_alert(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_marketing_revenue_phase50_ops_report(text,integer)
  from public, anon, authenticated;

grant execute on function public.phase50_marketing_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.list_marketing_revenue_phase50_critical_windows(integer,integer)
  to authenticated, service_role;
grant execute on function public.get_marketing_revenue_phase50_ops_report(text,integer)
  to authenticated, service_role;
grant execute on function public.propose_marketing_dry_run_promote_phase50(jsonb)
  to authenticated, service_role;
grant execute on function public.approve_marketing_dry_run_promote_phase50(uuid,uuid,text,jsonb)
  to authenticated, service_role;

grant execute on function public.record_marketing_cohort_readiness_snapshot_phase50(jsonb)
  to service_role;
grant execute on function public.record_marketing_revenue_phase50_ops_alert(jsonb)
  to service_role;
grant execute on function public.os_sha256_hex(text)
  to authenticated, service_role;
