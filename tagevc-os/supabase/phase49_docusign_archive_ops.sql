-- Phase 49: multi-quarter cadence SLO tracking and budget revision proposals
-- (propose only — activation requires a distinct dual-human approval path)
-- over Phase 48 evidence. Apply after phase48_docusign_archive_ops.sql.
-- Safe to re-run.
-- Never create/void/resend envelopes. Evidence = digests/metadata only.
-- Never mutates snapshot retirement tables.

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

-- Bootstrap Phase 48 safe-metadata helper if prior DocuSign SQL was skipped.
create or replace function public.phase48_docusign_ops_safe_metadata(p_detail jsonb)
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

create or replace function public.phase49_docusign_ops_safe_metadata(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select public.phase48_docusign_ops_safe_metadata(p_detail);
$$;

-- ---------------------------------------------------------------------------
-- Phase 49: multi-quarter cadence SLO snapshots (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_multi_quarter_cadence_slos (
  slo_id uuid primary key default gen_random_uuid(),
  slo_key text not null unique
    check (slo_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  window_quarters integer not null check (window_quarters between 1 and 12),
  quarters_evaluated integer not null default 0
    check (quarters_evaluated >= 0),
  quarters_on_time integer not null default 0
    check (quarters_on_time >= 0),
  quarters_breached integer not null default 0
    check (quarters_breached >= 0),
  on_time_rate numeric,
  target_on_time_rate numeric not null default 0.7500
    check (target_on_time_rate between 0 and 1),
  breach boolean not null default false,
  severity text not null default 'unknown'
    check (severity in ('unknown','healthy','warning','critical')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_cadence_slo_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase49_docusign_ops_safe_metadata(metadata)
    ),
  constraint os_docusign_archive_cadence_slo_count_check
    check (quarters_on_time + quarters_breached <= quarters_evaluated)
);

create index if not exists os_docusign_archive_cadence_slo_created_idx
  on public.os_docusign_archive_multi_quarter_cadence_slos(created_at desc);
create index if not exists os_docusign_archive_cadence_slo_severity_idx
  on public.os_docusign_archive_multi_quarter_cadence_slos(severity, created_at desc);

alter table public.os_docusign_archive_multi_quarter_cadence_slos
  enable row level security;
drop policy if exists "os_docusign_archive_cadence_slo_select"
  on public.os_docusign_archive_multi_quarter_cadence_slos;
create policy "os_docusign_archive_cadence_slo_select"
  on public.os_docusign_archive_multi_quarter_cadence_slos for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_multi_quarter_cadence_slos
  from public, anon, authenticated;
grant select on public.os_docusign_archive_multi_quarter_cadence_slos
  to authenticated;

-- ---------------------------------------------------------------------------
-- Phase 49: budget revision PROPOSALS (append-only). NEVER auto-activated by
-- the proposing function — activation only via a distinct dual-human
-- approval path (2 distinct approving actors), mirroring the Intune
-- request/approve pattern.
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_budget_revision_proposals (
  proposal_id uuid primary key default gen_random_uuid(),
  proposal_key text not null unique
    check (proposal_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  source_proposal_id uuid
    references public.os_docusign_archive_budget_revision_proposals(proposal_id),
  budget_key text not null check (budget_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  prior_max_content_drift integer not null check (prior_max_content_drift >= 0),
  prior_max_storage_unavailable integer not null check (prior_max_storage_unavailable >= 0),
  proposed_max_content_drift integer not null check (proposed_max_content_drift >= 0),
  proposed_max_storage_unavailable integer not null check (proposed_max_storage_unavailable >= 0),
  window_days integer not null check (window_days between 1 and 90),
  status text not null check (status in
    ('proposed','activated','rejected','blocked')),
  block_reason text,
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_budget_prop_reason_check
    check (
      (status in ('proposed','activated') and block_reason is null)
      or (status in ('rejected','blocked') and block_reason is not null
        and length(block_reason) between 8 and 500)
    ),
  constraint os_docusign_archive_budget_prop_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase49_docusign_ops_safe_metadata(metadata)
    )
);

create index if not exists os_docusign_archive_budget_prop_created_idx
  on public.os_docusign_archive_budget_revision_proposals(created_at desc);
create index if not exists os_docusign_archive_budget_prop_status_idx
  on public.os_docusign_archive_budget_revision_proposals(status, created_at desc);

alter table public.os_docusign_archive_budget_revision_proposals
  enable row level security;
drop policy if exists "os_docusign_archive_budget_prop_select"
  on public.os_docusign_archive_budget_revision_proposals;
create policy "os_docusign_archive_budget_prop_select"
  on public.os_docusign_archive_budget_revision_proposals for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_budget_revision_proposals
  from public, anon, authenticated;
grant select on public.os_docusign_archive_budget_revision_proposals
  to authenticated;

-- ---------------------------------------------------------------------------
-- Phase 49: distinct-actor dual approvals for a budget revision proposal
-- (append-only; unique per proposal+actor so the same human cannot supply
-- both required approvals).
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_budget_revision_approvals (
  approval_id uuid primary key default gen_random_uuid(),
  approval_key text not null unique
    check (approval_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  proposal_id uuid not null
    references public.os_docusign_archive_budget_revision_proposals(proposal_id),
  actor_id uuid not null,
  decision text not null check (decision in ('approve','reject')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_budget_appr_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase49_docusign_ops_safe_metadata(metadata)
    )
);

create unique index if not exists os_docusign_archive_budget_appr_distinct_actor_idx
  on public.os_docusign_archive_budget_revision_approvals(proposal_id, actor_id);
create index if not exists os_docusign_archive_budget_appr_created_idx
  on public.os_docusign_archive_budget_revision_approvals(created_at desc);

alter table public.os_docusign_archive_budget_revision_approvals
  enable row level security;
drop policy if exists "os_docusign_archive_budget_appr_select"
  on public.os_docusign_archive_budget_revision_approvals;
create policy "os_docusign_archive_budget_appr_select"
  on public.os_docusign_archive_budget_revision_approvals for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_budget_revision_approvals
  from public, anon, authenticated;
grant select on public.os_docusign_archive_budget_revision_approvals
  to authenticated;

-- ---------------------------------------------------------------------------
-- Phase 49 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_phase49_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  alert_kind text not null,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null default 'critical'
    check (severity = 'critical'),
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
  constraint os_docusign_archive_p49_alert_kind_check
    check (alert_kind in (
      'cadence_slo_breach',
      'budget_revision_proposed',
      'budget_revision_activated'
    )),
  constraint os_docusign_archive_p49_alert_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase49_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_p49_alert_created_idx
  on public.os_docusign_archive_phase49_ops_alerts(created_at desc);
create index if not exists os_docusign_archive_p49_alert_kind_idx
  on public.os_docusign_archive_phase49_ops_alerts(alert_kind, created_at desc);

alter table public.os_docusign_archive_phase49_ops_alerts
  enable row level security;
drop policy if exists "os_docusign_archive_p49_alert_select"
  on public.os_docusign_archive_phase49_ops_alerts;
create policy "os_docusign_archive_p49_alert_select"
  on public.os_docusign_archive_phase49_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_phase49_ops_alerts
  from public, anon, authenticated;
grant select on public.os_docusign_archive_phase49_ops_alerts
  to authenticated;

create or replace function public.reject_docusign_phase49_ops_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Phase 49 DocuSign archive ops evidence is append-only';
end;
$$;

drop trigger if exists os_docusign_archive_cadence_slo_immutable
  on public.os_docusign_archive_multi_quarter_cadence_slos;
create trigger os_docusign_archive_cadence_slo_immutable
  before update or delete on public.os_docusign_archive_multi_quarter_cadence_slos
  for each row execute function public.reject_docusign_phase49_ops_mutation();
drop trigger if exists os_docusign_archive_cadence_slo_no_truncate
  on public.os_docusign_archive_multi_quarter_cadence_slos;
create trigger os_docusign_archive_cadence_slo_no_truncate
  before truncate on public.os_docusign_archive_multi_quarter_cadence_slos
  for each statement execute function public.reject_docusign_phase49_ops_mutation();

drop trigger if exists os_docusign_archive_budget_prop_immutable
  on public.os_docusign_archive_budget_revision_proposals;
create trigger os_docusign_archive_budget_prop_immutable
  before update or delete on public.os_docusign_archive_budget_revision_proposals
  for each row execute function public.reject_docusign_phase49_ops_mutation();
drop trigger if exists os_docusign_archive_budget_prop_no_truncate
  on public.os_docusign_archive_budget_revision_proposals;
create trigger os_docusign_archive_budget_prop_no_truncate
  before truncate on public.os_docusign_archive_budget_revision_proposals
  for each statement execute function public.reject_docusign_phase49_ops_mutation();

drop trigger if exists os_docusign_archive_budget_appr_immutable
  on public.os_docusign_archive_budget_revision_approvals;
create trigger os_docusign_archive_budget_appr_immutable
  before update or delete on public.os_docusign_archive_budget_revision_approvals
  for each row execute function public.reject_docusign_phase49_ops_mutation();
drop trigger if exists os_docusign_archive_budget_appr_no_truncate
  on public.os_docusign_archive_budget_revision_approvals;
create trigger os_docusign_archive_budget_appr_no_truncate
  before truncate on public.os_docusign_archive_budget_revision_approvals
  for each statement execute function public.reject_docusign_phase49_ops_mutation();

drop trigger if exists os_docusign_archive_p49_alert_immutable
  on public.os_docusign_archive_phase49_ops_alerts;
create trigger os_docusign_archive_p49_alert_immutable
  before update or delete on public.os_docusign_archive_phase49_ops_alerts
  for each row execute function public.reject_docusign_phase49_ops_mutation();
drop trigger if exists os_docusign_archive_p49_alert_no_truncate
  on public.os_docusign_archive_phase49_ops_alerts;
create trigger os_docusign_archive_p49_alert_no_truncate
  before truncate on public.os_docusign_archive_phase49_ops_alerts
  for each statement execute function public.reject_docusign_phase49_ops_mutation();

-- ---------------------------------------------------------------------------
-- Record a multi-quarter cadence SLO snapshot over Phase 47/48 quarterly
-- run evidence. Read + append-only.
-- ---------------------------------------------------------------------------
create or replace function public.record_docusign_multi_quarter_cadence_slo_phase49(
  p_metadata jsonb default '{}'::jsonb,
  p_window_quarters integer default 4
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_quarters integer := least(greatest(coalesce(p_window_quarters, 4), 1), 12);
  v_evaluated integer := 0;
  v_on_time integer := 0;
  v_breached integer := 0;
  v_rate numeric;
  v_target numeric := 0.7500;
  v_breach boolean := false;
  v_severity text := 'unknown';
  v_key text;
  v_hash text;
  v_id uuid;
  v_row public.os_docusign_archive_multi_quarter_cadence_slos%rowtype;
begin
  if not public.phase49_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 49 cadence SLO metadata is invalid or unsafe';
  end if;

  select count(*) filter (where r.status = 'completed'),
    count(*) filter (where r.status = 'drift_budget_breach')
  into v_on_time, v_breached
  from (
    select run_id, status, created_at
    from public.os_docusign_archive_subsequent_quarterly_runs
    where status in ('completed','drift_budget_breach')
    union all
    select run_id, status, created_at
    from public.os_docusign_archive_recurring_quarterly_runs
    where status in ('completed','drift_budget_breach')
    order by created_at desc
    limit v_quarters
  ) r;

  v_evaluated := v_on_time + v_breached;

  if v_evaluated = 0 then
    v_rate := null;
    v_severity := 'unknown';
  else
    v_rate := round(v_on_time::numeric / v_evaluated::numeric, 4);
    if v_rate >= v_target then
      v_severity := 'healthy';
    elsif v_rate >= (v_target - 0.25) then
      v_severity := 'warning';
    else
      v_severity := 'critical';
    end if;
  end if;

  v_breach := v_evaluated > 0 and v_rate < v_target;

  v_key := 'cadenceslo49:firm:' || to_char(now(),'YYYYMMDD"T"HH24');
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase49-v1',
    'kind','multi_quarter_cadence_slo',
    'slo_key',v_key,
    'window_quarters',v_quarters,
    'quarters_evaluated',v_evaluated,
    'quarters_on_time',v_on_time,
    'quarters_breached',v_breached,
    'on_time_rate',v_rate,
    'target_on_time_rate',v_target,
    'breach',v_breach,
    'severity',v_severity,
    'metadata',v_meta
  )::text);

  insert into public.os_docusign_archive_multi_quarter_cadence_slos(
    slo_key,window_quarters,quarters_evaluated,quarters_on_time,
    quarters_breached,on_time_rate,target_on_time_rate,breach,severity,
    metrics_sha256,metadata)
  values (
    v_key,v_quarters,v_evaluated,v_on_time,v_breached,v_rate,v_target,
    v_breach,v_severity,v_hash,
    v_meta || jsonb_build_object('contract_version','phase49-v1'))
  on conflict (slo_key) do nothing
  returning * into v_row;

  if v_row.slo_id is null then
    select * into v_row
    from public.os_docusign_archive_multi_quarter_cadence_slos
    where slo_key = v_key;
    return jsonb_build_object(
      'version','phase49-v1',
      'disposition','unchanged',
      'slo_id',v_row.slo_id,
      'slo_key',v_row.slo_key,
      'quarters_evaluated',v_row.quarters_evaluated,
      'on_time_rate',v_row.on_time_rate,
      'severity',v_row.severity,
      'breach',v_row.breach,
      'metrics_sha256',v_row.metrics_sha256);
  end if;

  return jsonb_build_object(
    'version','phase49-v1',
    'disposition','recorded',
    'slo_id',v_row.slo_id,
    'slo_key',v_row.slo_key,
    'quarters_evaluated',v_row.quarters_evaluated,
    'on_time_rate',v_row.on_time_rate,
    'severity',v_row.severity,
    'breach',v_row.breach,
    'metrics_sha256',v_row.metrics_sha256);
end;
$$;

-- ---------------------------------------------------------------------------
-- Propose (never activate) a budget revision when the cadence SLO breaches.
-- ---------------------------------------------------------------------------
create or replace function public.propose_docusign_budget_revision_phase49(
  p_metadata jsonb default '{}'::jsonb,
  p_lookback_days integer default 30
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_days integer := least(greatest(coalesce(p_lookback_days, 30), 1), 90);
  v_slo public.os_docusign_archive_multi_quarter_cadence_slos%rowtype;
  v_revision public.os_docusign_archive_drift_budget_revisions%rowtype;
  v_budget_key text := 'firm_signed_archives';
  v_prior_drift integer;
  v_prior_storage integer;
  v_prop_drift integer;
  v_prop_storage integer;
  v_window_days integer := 30;
  v_key text;
  v_hash text;
  v_id uuid;
  v_reason text;
  v_row public.os_docusign_archive_budget_revision_proposals%rowtype;
begin
  if not public.phase49_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 49 budget revision proposal metadata is invalid or unsafe';
  end if;

  select * into v_slo
  from public.os_docusign_archive_multi_quarter_cadence_slos
  order by created_at desc
  limit 1;

  if v_slo.slo_id is null or coalesce(v_slo.breach,false) is not true then
    return jsonb_build_object(
      'version','phase49-v1',
      'disposition','unchanged',
      'status','unchanged',
      'block_reason',null,
      'cadence_breach',coalesce(v_slo.breach,false));
  end if;

  select * into v_revision
  from public.os_docusign_archive_drift_budget_revisions r
  where r.status = 'activated'
  order by r.created_at desc
  limit 1;

  if v_revision.revision_id is null then
    v_key := 'budgetprop49:firm:blocked:no_active_revision:' || to_char(now(),'YYYYMMDD');
    v_reason := 'active_tightened_budget_required';
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase49-v1',
      'kind','budget_revision_proposal',
      'proposal_key',v_key,
      'status','blocked',
      'block_reason',v_reason
    )::text);
    insert into public.os_docusign_archive_budget_revision_proposals(
      proposal_key,budget_key,prior_max_content_drift,prior_max_storage_unavailable,
      proposed_max_content_drift,proposed_max_storage_unavailable,window_days,
      status,block_reason,metrics_sha256,metadata)
    values (
      v_key,v_budget_key,0,0,0,0,v_days,
      'blocked',v_reason,v_hash,
      v_meta || jsonb_build_object('contract_version','phase49-v1'))
    on conflict (proposal_key) do nothing
    returning proposal_id into v_id;
    return jsonb_build_object(
      'version','phase49-v1',
      'disposition','blocked',
      'status','blocked',
      'block_reason',v_reason,
      'proposal_id',v_id);
  end if;

  v_budget_key := v_revision.budget_key;
  v_prior_drift := v_revision.proposed_max_content_drift;
  v_prior_storage := v_revision.proposed_max_storage_unavailable;
  v_window_days := v_revision.window_days;

  v_prop_drift := greatest(v_prior_drift - 1, 0);
  v_prop_storage := v_prior_storage;
  if v_prop_drift = v_prior_drift then
    v_prop_storage := greatest(v_prior_storage - 1, 0);
  end if;

  if v_prop_drift >= v_prior_drift and v_prop_storage >= v_prior_storage then
    v_key := 'budgetprop49:firm:blocked:floor:' || v_budget_key || ':' || to_char(now(),'YYYYMMDD');
    v_reason := 'budget_already_at_zero_floor';
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase49-v1',
      'kind','budget_revision_proposal',
      'proposal_key',v_key,
      'status','blocked',
      'block_reason',v_reason
    )::text);
    insert into public.os_docusign_archive_budget_revision_proposals(
      proposal_key,budget_key,prior_max_content_drift,prior_max_storage_unavailable,
      proposed_max_content_drift,proposed_max_storage_unavailable,window_days,
      status,block_reason,metrics_sha256,metadata)
    values (
      v_key,v_budget_key,v_prior_drift,v_prior_storage,v_prop_drift,v_prop_storage,
      v_window_days,'blocked',v_reason,v_hash,
      v_meta || jsonb_build_object('contract_version','phase49-v1'))
    on conflict (proposal_key) do nothing
    returning proposal_id into v_id;
    return jsonb_build_object(
      'version','phase49-v1',
      'disposition','blocked',
      'status','blocked',
      'block_reason',v_reason,
      'proposal_id',v_id);
  end if;

  v_key := 'budgetprop49:firm:' || v_budget_key || ':' || v_prop_drift::text || ':' || v_prop_storage::text;

  select * into v_row
  from public.os_docusign_archive_budget_revision_proposals
  where proposal_key = v_key
    and status in ('proposed','activated')
  order by created_at desc
  limit 1;

  if v_row.proposal_id is not null then
    return jsonb_build_object(
      'version','phase49-v1',
      'disposition','unchanged',
      'status',v_row.status,
      'proposal_id',v_row.proposal_id,
      'proposal_key',v_row.proposal_key,
      'proposed_max_content_drift',v_row.proposed_max_content_drift,
      'proposed_max_storage_unavailable',v_row.proposed_max_storage_unavailable);
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase49-v1',
    'kind','budget_revision_proposal',
    'proposal_key',v_key,
    'budget_key',v_budget_key,
    'prior_max_content_drift',v_prior_drift,
    'prior_max_storage_unavailable',v_prior_storage,
    'proposed_max_content_drift',v_prop_drift,
    'proposed_max_storage_unavailable',v_prop_storage,
    'window_days',v_window_days,
    'status','proposed',
    'metadata',v_meta
  )::text);

  insert into public.os_docusign_archive_budget_revision_proposals(
    proposal_key,budget_key,prior_max_content_drift,prior_max_storage_unavailable,
    proposed_max_content_drift,proposed_max_storage_unavailable,window_days,
    status,block_reason,metrics_sha256,metadata)
  values (
    v_key,v_budget_key,v_prior_drift,v_prior_storage,v_prop_drift,v_prop_storage,
    v_window_days,'proposed',null,v_hash,
    v_meta || jsonb_build_object('contract_version','phase49-v1'))
  on conflict (proposal_key) do nothing
  returning * into v_row;

  if v_row.proposal_id is null then
    select * into v_row
    from public.os_docusign_archive_budget_revision_proposals
    where proposal_key = v_key;
    return jsonb_build_object(
      'version','phase49-v1',
      'disposition','unchanged',
      'status',v_row.status,
      'proposal_id',v_row.proposal_id,
      'proposal_key',v_row.proposal_key);
  end if;

  return jsonb_build_object(
    'version','phase49-v1',
    'disposition','proposed',
    'status','proposed',
    'proposal_id',v_row.proposal_id,
    'proposal_key',v_row.proposal_key,
    'budget_key',v_budget_key,
    'proposed_max_content_drift',v_prop_drift,
    'proposed_max_storage_unavailable',v_prop_storage,
    'metrics_sha256',v_hash);
end;
$$;

-- ---------------------------------------------------------------------------
-- Dual-human approval: activation requires 2 DISTINCT approving actors.
-- This is the ONLY path that can move a proposal toward activation.
-- ---------------------------------------------------------------------------
create or replace function public.approve_docusign_budget_revision_proposal_phase49(
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
  v_proposal public.os_docusign_archive_budget_revision_proposals%rowtype;
  v_approval_key text;
  v_hash text;
  v_id uuid;
  v_distinct_approvers integer := 0;
  v_budget jsonb;
  v_has_upsert boolean := false;
  v_activated_key text;
  v_activated_row public.os_docusign_archive_budget_revision_proposals%rowtype;
begin
  if p_proposal_id is null or p_actor_id is null
    or v_decision not in ('approve','reject')
    or not public.phase49_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 49 budget revision approval contract is invalid or unsafe';
  end if;

  select * into v_proposal
  from public.os_docusign_archive_budget_revision_proposals
  where proposal_id = p_proposal_id;

  if v_proposal.proposal_id is null then
    raise exception 'Budget revision proposal is unknown';
  end if;
  if v_proposal.status <> 'proposed' then
    return jsonb_build_object(
      'version','phase49-v1',
      'disposition','unchanged',
      'status',v_proposal.status,
      'proposal_id',v_proposal.proposal_id);
  end if;

  v_approval_key := p_proposal_id::text || ':' || p_actor_id::text;
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase49-v1',
    'kind','budget_revision_approval',
    'proposal_id',p_proposal_id,
    'actor_id',p_actor_id,
    'decision',v_decision
  )::text);

  insert into public.os_docusign_archive_budget_revision_approvals(
    approval_key,proposal_id,actor_id,decision,metrics_sha256,metadata)
  values (
    v_approval_key,p_proposal_id,p_actor_id,v_decision,v_hash,
    v_meta || jsonb_build_object('contract_version','phase49-v1'))
  on conflict (approval_key) do nothing
  returning approval_id into v_id;

  if v_id is null then
    return jsonb_build_object(
      'version','phase49-v1',
      'disposition','unchanged',
      'status','duplicate_actor_decision',
      'proposal_id',p_proposal_id);
  end if;

  if v_decision = 'reject' then
    v_activated_key := 'budgetprop49:rejected:' || p_proposal_id::text;
    insert into public.os_docusign_archive_budget_revision_proposals(
      proposal_key,source_proposal_id,budget_key,prior_max_content_drift,
      prior_max_storage_unavailable,proposed_max_content_drift,
      proposed_max_storage_unavailable,window_days,status,block_reason,
      metrics_sha256,metadata)
    values (
      v_activated_key,p_proposal_id,v_proposal.budget_key,
      v_proposal.prior_max_content_drift,v_proposal.prior_max_storage_unavailable,
      v_proposal.proposed_max_content_drift,v_proposal.proposed_max_storage_unavailable,
      v_proposal.window_days,'rejected','rejected_by_approver',
      public.os_sha256_hex('reject:' || p_proposal_id::text),
      v_meta || jsonb_build_object('contract_version','phase49-v1'))
    on conflict (proposal_key) do nothing;
    return jsonb_build_object(
      'version','phase49-v1',
      'disposition','rejected',
      'status','rejected',
      'proposal_id',p_proposal_id);
  end if;

  select count(distinct actor_id)::integer into v_distinct_approvers
  from public.os_docusign_archive_budget_revision_approvals
  where proposal_id = p_proposal_id
    and decision = 'approve';

  if v_distinct_approvers < 2 then
    return jsonb_build_object(
      'version','phase49-v1',
      'disposition','awaiting_second_approval',
      'status','proposed',
      'proposal_id',p_proposal_id,
      'distinct_approvers',v_distinct_approvers);
  end if;

  -- Dual-human approval satisfied: this is the existing dual-human path that
  -- may activate a tightened budget (mirrors Phase 45's upsert function).
  select exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'upsert_docusign_archive_drift_budget_phase45'
  ) into v_has_upsert;

  if v_has_upsert then
    begin
      v_budget := public.upsert_docusign_archive_drift_budget_phase45(
        v_proposal.budget_key,
        v_proposal.proposed_max_content_drift,
        v_proposal.proposed_max_storage_unavailable,
        v_proposal.window_days,
        'active',
        v_meta || jsonb_build_object(
          'contract_version','phase49-v1',
          'dual_approved_proposal_id',v_proposal.proposal_id
        )
      );
    exception when others then
      v_budget := null;
    end;
  end if;

  v_activated_key := 'budgetprop49:activated:' || p_proposal_id::text;
  insert into public.os_docusign_archive_budget_revision_proposals(
    proposal_key,source_proposal_id,budget_key,prior_max_content_drift,
    prior_max_storage_unavailable,proposed_max_content_drift,
    proposed_max_storage_unavailable,window_days,status,block_reason,
    metrics_sha256,metadata)
  values (
    v_activated_key,p_proposal_id,v_proposal.budget_key,
    v_proposal.prior_max_content_drift,v_proposal.prior_max_storage_unavailable,
    v_proposal.proposed_max_content_drift,v_proposal.proposed_max_storage_unavailable,
    v_proposal.window_days,'activated',null,
    public.os_sha256_hex(jsonb_build_object(
      'version','phase49-v1',
      'kind','budget_revision_activated',
      'source_proposal_id',p_proposal_id,
      'activated_budget_id',v_budget->>'budget_id'
    )::text),
    v_meta || jsonb_build_object(
      'contract_version','phase49-v1',
      'dual_approved',true,
      'activated_budget_id',v_budget->>'budget_id'))
  on conflict (proposal_key) do nothing
  returning * into v_activated_row;

  return jsonb_build_object(
    'version','phase49-v1',
    'disposition','activated',
    'status','activated',
    'proposal_id',coalesce(v_activated_row.proposal_id,p_proposal_id),
    'source_proposal_id',p_proposal_id,
    'distinct_approvers',v_distinct_approvers);
end;
$$;

-- ---------------------------------------------------------------------------
-- List critical windows that still need an idempotent ops alert insert
-- ---------------------------------------------------------------------------
create or replace function public.list_docusign_archive_phase49_critical_windows(
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
  v_slo public.os_docusign_archive_multi_quarter_cadence_slos%rowtype;
  v_proposal public.os_docusign_archive_budget_revision_proposals%rowtype;
  v_key text;
begin
  v_bucket := to_char(
    to_timestamp(
      (floor(extract(epoch from now()) / (v_hours * 3600.0))
        * (v_hours * 3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  select * into v_slo
  from public.os_docusign_archive_multi_quarter_cadence_slos
  order by created_at desc
  limit 1;

  if v_slo.slo_id is not null and coalesce(v_slo.breach,false) then
    v_key := 'cadencebreach49:firm:' || v_bucket || 'h' || v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase49_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','cadence_slo_breach',
        'window_key',v_key,
        'severity','critical',
        'slo_id',v_slo.slo_id,
        'on_time_rate',v_slo.on_time_rate,
        'quarters_evaluated',v_slo.quarters_evaluated,
        'metrics_sha256',v_slo.metrics_sha256
      ));
    end if;
  end if;

  select * into v_proposal
  from public.os_docusign_archive_budget_revision_proposals
  order by created_at desc
  limit 1;

  if v_proposal.proposal_id is not null and v_proposal.status = 'proposed' then
    v_key := 'budgetproposed49:firm:' || v_proposal.proposal_id::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase49_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','budget_revision_proposed',
        'window_key',v_key,
        'severity','critical',
        'proposal_id',v_proposal.proposal_id,
        'budget_key',v_proposal.budget_key,
        'metrics_sha256',v_proposal.metrics_sha256
      ));
    end if;
  end if;

  if v_proposal.proposal_id is not null and v_proposal.status = 'activated' then
    v_key := 'budgetactivated49:firm:' || v_proposal.proposal_id::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase49_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','budget_revision_activated',
        'window_key',v_key,
        'severity','critical',
        'proposal_id',v_proposal.proposal_id,
        'budget_key',v_proposal.budget_key,
        'metrics_sha256',v_proposal.metrics_sha256
      ));
    end if;
  end if;

  return jsonb_build_object(
    'version','phase49-v1',
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',v_pending
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record one critical ops alert after delivery attempt (idempotent window_key)
-- ---------------------------------------------------------------------------
create or replace function public.record_docusign_archive_phase49_ops_alert(
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
  v_hash text;
  v_meta jsonb;
  v_id uuid;
  v_status text;
begin
  if jsonb_typeof(coalesce(p_alert,'{}'::jsonb)) <> 'object' then
    raise exception 'Phase 49 ops alert payload must be a JSON object';
  end if;

  v_kind := coalesce(p_alert->>'alert_kind','');
  v_window := coalesce(p_alert->>'window_key','');
  v_dest := coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery := coalesce(p_alert->>'delivery_status','recorded');
  v_code := nullif(p_alert->>'response_code','')::integer;
  v_meta := coalesce(p_alert->'metadata','{}'::jsonb);

  if v_kind not in (
       'cadence_slo_breach',
       'budget_revision_proposed',
       'budget_revision_activated'
     )
     or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
     or v_dest ~* '://|^https?'
     or v_delivery not in
       ('delivered','skipped_no_webhook','failed','recorded')
     or not public.phase49_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 49 ops alert contract is invalid or unsafe';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase49-v1',
    'alert_kind',v_kind,
    'window_key',v_window,
    'severity','critical',
    'destination_key',v_dest,
    'delivery_status',v_delivery,
    'response_code',v_code
  )::text);

  insert into public.os_docusign_archive_phase49_ops_alerts(
    alert_kind,window_key,severity,destination_key,
    delivery_status,response_code,metrics_sha256,metadata)
  values (
    v_kind,v_window,'critical',v_dest,
    v_delivery,v_code,v_hash,
    v_meta || jsonb_build_object('contract_version','phase49-v1'))
  on conflict (window_key) do nothing
  returning alert_id, delivery_status into v_id, v_status;

  if v_id is null then
    select alert_id, delivery_status into v_id, v_status
    from public.os_docusign_archive_phase49_ops_alerts
    where window_key = v_window;
    return jsonb_build_object(
      'version','phase49-v1',
      'alert_id',v_id,
      'window_key',v_window,
      'delivery_status',v_status,
      'inserted',false);
  end if;

  return jsonb_build_object(
    'version','phase49-v1',
    'alert_id',v_id,
    'window_key',v_window,
    'delivery_status',v_status,
    'inserted',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Hub report: cadence SLO + budget proposal visibility + recurring
-- performance visibility (read-only over Phase 48 evidence)
-- ---------------------------------------------------------------------------
create or replace function public.get_docusign_archive_phase49_ops_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_slo public.os_docusign_archive_multi_quarter_cadence_slos%rowtype;
  v_proposal public.os_docusign_archive_budget_revision_proposals%rowtype;
  v_report public.os_docusign_archive_recurring_performance_reports%rowtype;
  v_alerts jsonb;
  v_pending_proposals integer := 0;
  v_activated_proposals integer := 0;
  v_alert_delivery text := 'none';
  v_failed boolean := false;
  v_skipped boolean := false;
  v_delivered boolean := false;
  v_recorded boolean := false;
begin
  select * into v_slo
  from public.os_docusign_archive_multi_quarter_cadence_slos
  order by created_at desc
  limit 1;

  select * into v_proposal
  from public.os_docusign_archive_budget_revision_proposals
  order by created_at desc
  limit 1;

  select * into v_report
  from public.os_docusign_archive_recurring_performance_reports
  order by created_at desc
  limit 1;

  select count(*)::integer into v_pending_proposals
  from public.os_docusign_archive_budget_revision_proposals
  where status = 'proposed';

  select count(*)::integer into v_activated_proposals
  from public.os_docusign_archive_budget_revision_proposals
  where status = 'activated';

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
  into v_alerts
  from (
    select alert_id, alert_kind, window_key, severity, destination_key,
      delivery_status, response_code, metrics_sha256, created_at
    from public.os_docusign_archive_phase49_ops_alerts
    order by created_at desc
    limit 20
  ) a;

  select
    bool_or(x.delivery_status = 'failed'),
    bool_or(x.delivery_status = 'skipped_no_webhook'),
    bool_or(x.delivery_status = 'delivered'),
    bool_or(x.delivery_status = 'recorded')
  into v_failed, v_skipped, v_delivered, v_recorded
  from public.os_docusign_archive_phase49_ops_alerts x
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
    'version','phase49-v1',
    'cadence_slo_severity',coalesce(v_slo.severity,'unknown'),
    'cadence_on_time_rate',v_slo.on_time_rate,
    'cadence_breach',coalesce(v_slo.breach,false),
    'budget_proposal_status',coalesce(v_proposal.status,'none'),
    'pending_proposal_count',v_pending_proposals,
    'activated_proposal_count',v_activated_proposals,
    'recurring_run_status',coalesce(v_report.subsequent_run_status,'none'),
    'drift_performance',coalesce(v_report.drift_performance,'unknown'),
    'alert_delivery',v_alert_delivery,
    'latest_cadence_slo', case
      when v_slo.slo_id is null then null
      else jsonb_build_object(
        'slo_id',v_slo.slo_id,
        'slo_key',v_slo.slo_key,
        'window_quarters',v_slo.window_quarters,
        'quarters_evaluated',v_slo.quarters_evaluated,
        'quarters_on_time',v_slo.quarters_on_time,
        'quarters_breached',v_slo.quarters_breached,
        'on_time_rate',v_slo.on_time_rate,
        'target_on_time_rate',v_slo.target_on_time_rate,
        'breach',v_slo.breach,
        'severity',v_slo.severity,
        'created_at',v_slo.created_at
      )
    end,
    'latest_budget_proposal', case
      when v_proposal.proposal_id is null then null
      else jsonb_build_object(
        'proposal_id',v_proposal.proposal_id,
        'proposal_key',v_proposal.proposal_key,
        'budget_key',v_proposal.budget_key,
        'proposed_max_content_drift',v_proposal.proposed_max_content_drift,
        'proposed_max_storage_unavailable',v_proposal.proposed_max_storage_unavailable,
        'status',v_proposal.status,
        'block_reason',v_proposal.block_reason,
        'created_at',v_proposal.created_at
      )
    end,
    'alerts',coalesce(v_alerts,'[]'::jsonb),
    'destination_key','ops_alerts',
    'never_creates_voids_or_resends_envelopes',true
  );
end;
$$;

revoke all on function public.phase49_docusign_ops_safe_metadata(jsonb)
  from public, anon, authenticated;
revoke all on function public.record_docusign_multi_quarter_cadence_slo_phase49(jsonb,integer)
  from public, anon, authenticated;
revoke all on function public.propose_docusign_budget_revision_phase49(jsonb,integer)
  from public, anon, authenticated;
revoke all on function public.approve_docusign_budget_revision_proposal_phase49(uuid,uuid,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.list_docusign_archive_phase49_critical_windows(integer)
  from public, anon;
revoke all on function public.record_docusign_archive_phase49_ops_alert(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_docusign_archive_phase49_ops_report()
  from public, anon;

grant execute on function public.phase49_docusign_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.list_docusign_archive_phase49_critical_windows(integer)
  to authenticated, service_role;
grant execute on function public.get_docusign_archive_phase49_ops_report()
  to authenticated, service_role;
grant execute on function public.approve_docusign_budget_revision_proposal_phase49(uuid,uuid,text,jsonb)
  to authenticated, service_role;

grant execute on function public.record_docusign_multi_quarter_cadence_slo_phase49(jsonb,integer)
  to service_role;
grant execute on function public.propose_docusign_budget_revision_phase49(jsonb,integer)
  to service_role;
grant execute on function public.record_docusign_archive_phase49_ops_alert(jsonb)
  to service_role;
grant execute on function public.os_sha256_hex(text)
  to authenticated, service_role;
