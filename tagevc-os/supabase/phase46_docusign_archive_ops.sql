-- Phase 46: DocuSign first quarterly completion, recurring arms, drift tighten.
-- Depends on phase45_docusign_archive_ops.sql.
-- Completes first quarterly review from Phase 43/45 gate + runbook evidence.
-- Arms recurring quarterly cadence. Tightens drift budgets from baselines.
-- Improves integrity cadence visibility. Never create/void/resend envelopes.
-- Evidence = digests/metadata only. Never mutates snapshot retirement tables.
-- Safe to re-run.

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

create or replace function public.phase46_docusign_ops_safe_metadata(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select public.phase45_docusign_ops_safe_metadata(p_detail);
$$;

-- ---------------------------------------------------------------------------
-- Append-only first quarterly completion evidence (completed/blocked)
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_first_quarterly_completion (
  completion_id uuid primary key default gen_random_uuid(),
  completion_key text not null unique
    check (completion_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  status text not null
    check (status in ('completed','blocked')),
  gate_ready boolean not null default false,
  gate_completed boolean not null default false,
  runbook_completed boolean not null default false,
  block_reason text,
  metrics_sha256 text not null
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_fq_complete_reason_check
    check (
      (status = 'completed' and block_reason is null)
      or (
        status = 'blocked'
        and block_reason is not null
        and length(block_reason) between 8 and 500
      )
    ),
  constraint os_docusign_archive_fq_complete_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase46_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_fq_complete_created_idx
  on public.os_docusign_archive_first_quarterly_completion(created_at desc);
create index if not exists os_docusign_archive_fq_complete_status_idx
  on public.os_docusign_archive_first_quarterly_completion(status, created_at desc);

alter table public.os_docusign_archive_first_quarterly_completion
  enable row level security;
drop policy if exists "os_docusign_archive_fq_complete_select"
  on public.os_docusign_archive_first_quarterly_completion;
create policy "os_docusign_archive_fq_complete_select"
  on public.os_docusign_archive_first_quarterly_completion for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_first_quarterly_completion
  from public, anon, authenticated;
grant select on public.os_docusign_archive_first_quarterly_completion
  to authenticated;

-- ---------------------------------------------------------------------------
-- Append-only recurring quarterly arms (armed/disarmed)
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_recurring_quarterly_arms (
  arm_id uuid primary key default gen_random_uuid(),
  arm_key text not null unique
    check (arm_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  completion_id uuid
    references public.os_docusign_archive_first_quarterly_completion(completion_id),
  armed_at timestamptz not null default now(),
  next_due timestamptz not null,
  cadence_months integer not null default 3
    check (cadence_months between 1 and 12),
  status text not null
    check (status in ('armed','disarmed')),
  metrics_sha256 text not null
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_recur_arm_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase46_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_recur_arm_created_idx
  on public.os_docusign_archive_recurring_quarterly_arms(created_at desc);
create index if not exists os_docusign_archive_recur_arm_status_idx
  on public.os_docusign_archive_recurring_quarterly_arms(status, created_at desc)
  where status='armed';

alter table public.os_docusign_archive_recurring_quarterly_arms
  enable row level security;
drop policy if exists "os_docusign_archive_recur_arm_select"
  on public.os_docusign_archive_recurring_quarterly_arms;
create policy "os_docusign_archive_recur_arm_select"
  on public.os_docusign_archive_recurring_quarterly_arms for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_recurring_quarterly_arms
  from public, anon, authenticated;
grant select on public.os_docusign_archive_recurring_quarterly_arms
  to authenticated;

-- ---------------------------------------------------------------------------
-- Append-only drift budget revisions (proposed/activated); lower max drift
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_drift_budget_revisions (
  revision_id uuid primary key default gen_random_uuid(),
  budget_key text not null
    check (budget_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  baseline_snapshot_id uuid,
  prior_max_content_drift integer not null
    check (prior_max_content_drift >= 0),
  prior_max_storage_unavailable integer not null
    check (prior_max_storage_unavailable >= 0),
  proposed_max_content_drift integer not null
    check (proposed_max_content_drift >= 0),
  proposed_max_storage_unavailable integer not null
    check (proposed_max_storage_unavailable >= 0),
  window_days integer not null
    check (window_days between 1 and 90),
  status text not null
    check (status in ('proposed','activated')),
  metrics_sha256 text not null
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_drift_rev_tighten_check
    check (
      proposed_max_content_drift <= prior_max_content_drift
      and proposed_max_storage_unavailable <= prior_max_storage_unavailable
      and (
        proposed_max_content_drift < prior_max_content_drift
        or proposed_max_storage_unavailable < prior_max_storage_unavailable
      )
    ),
  constraint os_docusign_archive_drift_rev_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase46_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_drift_rev_created_idx
  on public.os_docusign_archive_drift_budget_revisions(created_at desc);
create index if not exists os_docusign_archive_drift_rev_key_idx
  on public.os_docusign_archive_drift_budget_revisions(budget_key, created_at desc);
create index if not exists os_docusign_archive_drift_rev_status_idx
  on public.os_docusign_archive_drift_budget_revisions(status, created_at desc);

alter table public.os_docusign_archive_drift_budget_revisions
  enable row level security;
drop policy if exists "os_docusign_archive_drift_rev_select"
  on public.os_docusign_archive_drift_budget_revisions;
create policy "os_docusign_archive_drift_rev_select"
  on public.os_docusign_archive_drift_budget_revisions for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_drift_budget_revisions
  from public, anon, authenticated;
grant select on public.os_docusign_archive_drift_budget_revisions
  to authenticated;

-- ---------------------------------------------------------------------------
-- Append-only integrity cadence ops (enhanced visibility + health)
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_integrity_cadence_ops (
  ops_id uuid primary key default gen_random_uuid(),
  last_sample_at timestamptz,
  last_full_at timestamptz,
  last_quarterly_at timestamptz,
  next_quarterly_due timestamptz,
  sample_overdue boolean not null default false,
  full_overdue boolean not null default false,
  quarterly_overdue boolean not null default false,
  health text not null
    check (health in ('healthy','watch','critical','unknown')),
  metrics_sha256 text not null
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_cadence_ops_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase46_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_cadence_ops_created_idx
  on public.os_docusign_archive_integrity_cadence_ops(created_at desc);
create index if not exists os_docusign_archive_cadence_ops_health_idx
  on public.os_docusign_archive_integrity_cadence_ops(health, created_at desc);

alter table public.os_docusign_archive_integrity_cadence_ops
  enable row level security;
drop policy if exists "os_docusign_archive_cadence_ops_select"
  on public.os_docusign_archive_integrity_cadence_ops;
create policy "os_docusign_archive_cadence_ops_select"
  on public.os_docusign_archive_integrity_cadence_ops for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_integrity_cadence_ops
  from public, anon, authenticated;
grant select on public.os_docusign_archive_integrity_cadence_ops
  to authenticated;

-- ---------------------------------------------------------------------------
-- Append-only Phase 46 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_phase46_ops_alerts (
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
  constraint os_docusign_archive_p46_alert_kind_check
    check (alert_kind in (
      'first_quarterly_incomplete',
      'recurring_unarmed',
      'drift_budget_tighten_due',
      'cadence_unhealthy'
    )),
  constraint os_docusign_archive_p46_alert_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase46_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_p46_alert_created_idx
  on public.os_docusign_archive_phase46_ops_alerts(created_at desc);
create index if not exists os_docusign_archive_p46_alert_kind_idx
  on public.os_docusign_archive_phase46_ops_alerts(alert_kind, created_at desc);

alter table public.os_docusign_archive_phase46_ops_alerts
  enable row level security;
drop policy if exists "os_docusign_archive_p46_alert_select"
  on public.os_docusign_archive_phase46_ops_alerts;
create policy "os_docusign_archive_p46_alert_select"
  on public.os_docusign_archive_phase46_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_phase46_ops_alerts
  from public, anon, authenticated;
grant select on public.os_docusign_archive_phase46_ops_alerts
  to authenticated;

create or replace function public.reject_docusign_phase46_ops_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Phase 46 DocuSign archive ops evidence is append-only';
end;
$$;

drop trigger if exists os_docusign_archive_fq_complete_immutable
  on public.os_docusign_archive_first_quarterly_completion;
create trigger os_docusign_archive_fq_complete_immutable
  before update or delete on public.os_docusign_archive_first_quarterly_completion
  for each row execute function public.reject_docusign_phase46_ops_mutation();
drop trigger if exists os_docusign_archive_fq_complete_no_truncate
  on public.os_docusign_archive_first_quarterly_completion;
create trigger os_docusign_archive_fq_complete_no_truncate
  before truncate on public.os_docusign_archive_first_quarterly_completion
  for each statement execute function public.reject_docusign_phase46_ops_mutation();

drop trigger if exists os_docusign_archive_recur_arm_immutable
  on public.os_docusign_archive_recurring_quarterly_arms;
create trigger os_docusign_archive_recur_arm_immutable
  before update or delete on public.os_docusign_archive_recurring_quarterly_arms
  for each row execute function public.reject_docusign_phase46_ops_mutation();
drop trigger if exists os_docusign_archive_recur_arm_no_truncate
  on public.os_docusign_archive_recurring_quarterly_arms;
create trigger os_docusign_archive_recur_arm_no_truncate
  before truncate on public.os_docusign_archive_recurring_quarterly_arms
  for each statement execute function public.reject_docusign_phase46_ops_mutation();

drop trigger if exists os_docusign_archive_drift_rev_immutable
  on public.os_docusign_archive_drift_budget_revisions;
create trigger os_docusign_archive_drift_rev_immutable
  before update or delete on public.os_docusign_archive_drift_budget_revisions
  for each row execute function public.reject_docusign_phase46_ops_mutation();
drop trigger if exists os_docusign_archive_drift_rev_no_truncate
  on public.os_docusign_archive_drift_budget_revisions;
create trigger os_docusign_archive_drift_rev_no_truncate
  before truncate on public.os_docusign_archive_drift_budget_revisions
  for each statement execute function public.reject_docusign_phase46_ops_mutation();

drop trigger if exists os_docusign_archive_cadence_ops_immutable
  on public.os_docusign_archive_integrity_cadence_ops;
create trigger os_docusign_archive_cadence_ops_immutable
  before update or delete on public.os_docusign_archive_integrity_cadence_ops
  for each row execute function public.reject_docusign_phase46_ops_mutation();
drop trigger if exists os_docusign_archive_cadence_ops_no_truncate
  on public.os_docusign_archive_integrity_cadence_ops;
create trigger os_docusign_archive_cadence_ops_no_truncate
  before truncate on public.os_docusign_archive_integrity_cadence_ops
  for each statement execute function public.reject_docusign_phase46_ops_mutation();

drop trigger if exists os_docusign_archive_p46_alert_immutable
  on public.os_docusign_archive_phase46_ops_alerts;
create trigger os_docusign_archive_p46_alert_immutable
  before update or delete on public.os_docusign_archive_phase46_ops_alerts
  for each row execute function public.reject_docusign_phase46_ops_mutation();
drop trigger if exists os_docusign_archive_p46_alert_no_truncate
  on public.os_docusign_archive_phase46_ops_alerts;
create trigger os_docusign_archive_p46_alert_no_truncate
  before truncate on public.os_docusign_archive_phase46_ops_alerts
  for each statement execute function public.reject_docusign_phase46_ops_mutation();

-- ---------------------------------------------------------------------------
-- Complete first quarterly review (Phase 45 gates + Phase 43 runbook)
-- ---------------------------------------------------------------------------
create or replace function public.complete_docusign_first_quarterly_review_phase46(
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_gate_ready boolean := false;
  v_gate_completed boolean := false;
  v_runbook_completed boolean := false;
  v_gates jsonb;
  v_first_done boolean := false;
  v_status text;
  v_reason text;
  v_key text := 'fqcomplete:firm:first_quarterly_review';
  v_hash text;
  v_id uuid;
  v_existing public.os_docusign_archive_first_quarterly_completion%rowtype;
begin
  if not public.phase46_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 46 first quarterly completion metadata is invalid or unsafe';
  end if;

  select * into v_existing
  from public.os_docusign_archive_first_quarterly_completion c
  where c.completion_key = v_key
    and c.status = 'completed'
  order by c.created_at desc
  limit 1;

  if v_existing.completion_id is not null then
    return jsonb_build_object(
      'disposition','unchanged',
      'completion_id',v_existing.completion_id,
      'completion_key',v_existing.completion_key,
      'status',v_existing.status,
      'gate_ready',v_existing.gate_ready,
      'gate_completed',v_existing.gate_completed,
      'runbook_completed',v_existing.runbook_completed,
      'block_reason',v_existing.block_reason,
      'metrics_sha256',v_existing.metrics_sha256,
      'contract_version','phase46-v1'
    );
  end if;

  select exists (
    select 1 from public.os_docusign_archive_gate_clearing_evidence e
    where e.step_kind='first_quarterly_ready' and e.status='ready'
  ) into v_gate_ready;

  select exists (
    select 1 from public.os_docusign_archive_gate_clearing_evidence e
    where e.step_kind='first_quarterly_completed' and e.status='completed'
  ) into v_gate_completed;

  select exists (
    select 1 from public.os_docusign_first_quarterly_runbook_evidence r
    where r.step_kind='first_quarterly_completed'
  ) into v_runbook_completed;

  v_gates := public.evaluate_docusign_first_quarterly_gates_phase43(null);
  v_first_done := coalesce((v_gates->>'first_quarterly_completed')::boolean, false);

  if (v_gate_ready or v_gate_completed)
     and v_runbook_completed
     and v_first_done then
    v_status := 'completed';
    v_reason := null;
  else
    v_status := 'blocked';
    if not (v_gate_ready or v_gate_completed) then
      v_reason := 'phase45_gate_clearing_not_ready';
    elsif not v_runbook_completed then
      v_reason := 'phase43_runbook_not_completed';
    else
      v_reason := 'phase43_first_quarterly_gates_incomplete';
    end if;
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase46-v1',
    'kind','first_quarterly_completion',
    'completion_key',v_key,
    'status',v_status,
    'gate_ready',v_gate_ready,
    'gate_completed',v_gate_completed,
    'runbook_completed',v_runbook_completed,
    'first_quarterly_completed',v_first_done,
    'block_reason',v_reason,
    'metadata',v_meta
  )::text);

  if v_status = 'completed' then
    insert into public.os_docusign_archive_first_quarterly_completion(
      completion_key,status,gate_ready,gate_completed,runbook_completed,
      block_reason,metrics_sha256,metadata)
    values (
      v_key,v_status,v_gate_ready,v_gate_completed,v_runbook_completed,
      v_reason,v_hash,
      v_meta || jsonb_build_object('contract_version','phase46-v1'))
    on conflict (completion_key) do nothing
    returning completion_id into v_id;

    if v_id is null then
      select * into v_existing
      from public.os_docusign_archive_first_quarterly_completion
      where completion_key = v_key;
      return jsonb_build_object(
        'disposition','unchanged',
        'completion_id',v_existing.completion_id,
        'completion_key',v_existing.completion_key,
        'status',v_existing.status,
        'gate_ready',v_existing.gate_ready,
        'gate_completed',v_existing.gate_completed,
        'runbook_completed',v_existing.runbook_completed,
        'block_reason',v_existing.block_reason,
        'metrics_sha256',v_existing.metrics_sha256,
        'contract_version','phase46-v1'
      );
    end if;

    return jsonb_build_object(
      'disposition','completed',
      'completion_id',v_id,
      'completion_key',v_key,
      'status',v_status,
      'gate_ready',v_gate_ready,
      'gate_completed',v_gate_completed,
      'runbook_completed',v_runbook_completed,
      'block_reason',null,
      'metrics_sha256',v_hash,
      'contract_version','phase46-v1'
    );
  end if;

  -- Blocked attempts are append-only with unique key per reason window.
  v_key := 'fqblocked:firm:'||v_reason||':'||to_char(now(),'YYYYMMDD');
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase46-v1',
    'kind','first_quarterly_completion',
    'completion_key',v_key,
    'status',v_status,
    'gate_ready',v_gate_ready,
    'gate_completed',v_gate_completed,
    'runbook_completed',v_runbook_completed,
    'first_quarterly_completed',v_first_done,
    'block_reason',v_reason,
    'metadata',v_meta
  )::text);

  insert into public.os_docusign_archive_first_quarterly_completion(
    completion_key,status,gate_ready,gate_completed,runbook_completed,
    block_reason,metrics_sha256,metadata)
  values (
    v_key,v_status,v_gate_ready,v_gate_completed,v_runbook_completed,
    v_reason,v_hash,
    v_meta || jsonb_build_object('contract_version','phase46-v1'))
  on conflict (completion_key) do nothing
  returning completion_id into v_id;

  if v_id is null then
    select * into v_existing
    from public.os_docusign_archive_first_quarterly_completion
    where completion_key = v_key;
    return jsonb_build_object(
      'disposition','blocked',
      'completion_id',v_existing.completion_id,
      'completion_key',v_existing.completion_key,
      'status','blocked',
      'gate_ready',v_existing.gate_ready,
      'gate_completed',v_existing.gate_completed,
      'runbook_completed',v_existing.runbook_completed,
      'block_reason',v_existing.block_reason,
      'metrics_sha256',v_existing.metrics_sha256,
      'contract_version','phase46-v1'
    );
  end if;

  return jsonb_build_object(
    'disposition','blocked',
    'completion_id',v_id,
    'completion_key',v_key,
    'status','blocked',
    'gate_ready',v_gate_ready,
    'gate_completed',v_gate_completed,
    'runbook_completed',v_runbook_completed,
    'block_reason',v_reason,
    'metrics_sha256',v_hash,
    'contract_version','phase46-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Arm recurring quarterly process (requires completed first quarterly)
-- ---------------------------------------------------------------------------
create or replace function public.arm_docusign_recurring_quarterly_phase46(
  p_cadence_months integer default 3,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_months integer := least(greatest(coalesce(p_cadence_months, 3), 1), 12);
  v_completion public.os_docusign_archive_first_quarterly_completion%rowtype;
  v_existing public.os_docusign_archive_recurring_quarterly_arms%rowtype;
  v_key text := 'recurarm:firm:quarterly';
  v_armed_at timestamptz := now();
  v_next_due timestamptz;
  v_hash text;
  v_id uuid;
begin
  if not public.phase46_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 46 recurring arm metadata is invalid or unsafe';
  end if;

  select * into v_existing
  from public.os_docusign_archive_recurring_quarterly_arms a
  where a.arm_key = v_key
    and a.status = 'armed'
  order by a.created_at desc
  limit 1;

  if v_existing.arm_id is not null then
    return jsonb_build_object(
      'disposition','unchanged',
      'arm_id',v_existing.arm_id,
      'arm_key',v_existing.arm_key,
      'completion_id',v_existing.completion_id,
      'armed_at',v_existing.armed_at,
      'next_due',v_existing.next_due,
      'cadence_months',v_existing.cadence_months,
      'status',v_existing.status,
      'metrics_sha256',v_existing.metrics_sha256,
      'contract_version','phase46-v1'
    );
  end if;

  select * into v_completion
  from public.os_docusign_archive_first_quarterly_completion c
  where c.status = 'completed'
  order by c.created_at desc
  limit 1;

  if v_completion.completion_id is null then
    return jsonb_build_object(
      'disposition','blocked',
      'status','disarmed',
      'block_reason','first_quarterly_completion_required',
      'contract_version','phase46-v1'
    );
  end if;

  v_next_due := v_armed_at + make_interval(months => v_months);
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase46-v1',
    'kind','recurring_quarterly_arm',
    'arm_key',v_key,
    'completion_id',v_completion.completion_id,
    'armed_at',v_armed_at,
    'next_due',v_next_due,
    'cadence_months',v_months,
    'status','armed',
    'metadata',v_meta
  )::text);

  insert into public.os_docusign_archive_recurring_quarterly_arms(
    arm_key,completion_id,armed_at,next_due,cadence_months,
    status,metrics_sha256,metadata)
  values (
    v_key,v_completion.completion_id,v_armed_at,v_next_due,v_months,
    'armed',v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase46-v1',
      'completion_key',v_completion.completion_key
    ))
  on conflict (arm_key) do nothing
  returning arm_id into v_id;

  if v_id is null then
    select * into v_existing
    from public.os_docusign_archive_recurring_quarterly_arms
    where arm_key = v_key;
    return jsonb_build_object(
      'disposition','unchanged',
      'arm_id',v_existing.arm_id,
      'arm_key',v_existing.arm_key,
      'completion_id',v_existing.completion_id,
      'armed_at',v_existing.armed_at,
      'next_due',v_existing.next_due,
      'cadence_months',v_existing.cadence_months,
      'status',v_existing.status,
      'metrics_sha256',v_existing.metrics_sha256,
      'contract_version','phase46-v1'
    );
  end if;

  return jsonb_build_object(
    'disposition','armed',
    'arm_id',v_id,
    'arm_key',v_key,
    'completion_id',v_completion.completion_id,
    'armed_at',v_armed_at,
    'next_due',v_next_due,
    'cadence_months',v_months,
    'status','armed',
    'metrics_sha256',v_hash,
    'contract_version','phase46-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Propose tightened drift budget from baseline snapshot
-- ---------------------------------------------------------------------------
create or replace function public.tighten_docusign_drift_budget_phase46(
  p_budget_key text default 'firm_signed_archives',
  p_proposed_max_content_drift integer default null,
  p_proposed_max_storage_unavailable integer default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text := coalesce(nullif(trim(p_budget_key), ''), 'firm_signed_archives');
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_budget public.os_docusign_archive_drift_budgets%rowtype;
  v_baseline public.os_docusign_archive_drift_snapshots%rowtype;
  v_prior_drift integer;
  v_prior_storage integer;
  v_prop_drift integer;
  v_prop_storage integer;
  v_days integer;
  v_hash text;
  v_row public.os_docusign_archive_drift_budget_revisions%rowtype;
  v_existing public.os_docusign_archive_drift_budget_revisions%rowtype;
begin
  if v_key !~ '^[a-z][a-z0-9_]{0,62}$'
     or not public.phase46_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 46 drift budget tighten contract is invalid or unsafe';
  end if;

  select * into v_budget
  from public.os_docusign_archive_drift_budgets b
  where b.budget_key = v_key
    and b.status = 'active'
  order by b.created_at desc
  limit 1;

  if v_budget.budget_id is null then
    return jsonb_build_object(
      'disposition','blocked',
      'block_reason','active_drift_budget_required',
      'budget_key',v_key,
      'contract_version','phase46-v1'
    );
  end if;

  select * into v_baseline
  from public.os_docusign_archive_drift_snapshots
  order by created_at desc
  limit 1;

  if v_baseline.snapshot_id is null then
    return jsonb_build_object(
      'disposition','blocked',
      'block_reason','baseline_drift_snapshot_required',
      'budget_key',v_key,
      'contract_version','phase46-v1'
    );
  end if;

  v_prior_drift := v_budget.max_content_drift_per_window;
  v_prior_storage := v_budget.max_storage_unavailable;
  v_days := v_budget.window_days;

  -- Tighten toward observed baseline with a small buffer (at least 0).
  v_prop_drift := coalesce(
    p_proposed_max_content_drift,
    greatest(v_baseline.content_drift_count, 0)
  );
  v_prop_storage := coalesce(
    p_proposed_max_storage_unavailable,
    greatest(v_baseline.storage_unavailable_count, 0)
  );

  if v_prop_drift > v_prior_drift then
    v_prop_drift := v_prior_drift;
  end if;
  if v_prop_storage > v_prior_storage then
    v_prop_storage := v_prior_storage;
  end if;

  if v_prop_drift >= v_prior_drift
     and v_prop_storage >= v_prior_storage then
    return jsonb_build_object(
      'disposition','blocked',
      'block_reason','proposed_limits_not_tighter',
      'budget_key',v_key,
      'prior_max_content_drift',v_prior_drift,
      'prior_max_storage_unavailable',v_prior_storage,
      'baseline_snapshot_id',v_baseline.snapshot_id,
      'baseline_content_drift_count',v_baseline.content_drift_count,
      'baseline_storage_unavailable_count',v_baseline.storage_unavailable_count,
      'contract_version','phase46-v1'
    );
  end if;

  select * into v_existing
  from public.os_docusign_archive_drift_budget_revisions r
  where r.budget_key = v_key
    and r.status = 'proposed'
    and r.proposed_max_content_drift = v_prop_drift
    and r.proposed_max_storage_unavailable = v_prop_storage
    and r.window_days = v_days
  order by r.created_at desc
  limit 1;

  if v_existing.revision_id is not null then
    return jsonb_build_object(
      'disposition','unchanged',
      'revision_id',v_existing.revision_id,
      'budget_key',v_existing.budget_key,
      'baseline_snapshot_id',v_existing.baseline_snapshot_id,
      'prior_max_content_drift',v_existing.prior_max_content_drift,
      'prior_max_storage_unavailable',v_existing.prior_max_storage_unavailable,
      'proposed_max_content_drift',v_existing.proposed_max_content_drift,
      'proposed_max_storage_unavailable',v_existing.proposed_max_storage_unavailable,
      'window_days',v_existing.window_days,
      'status',v_existing.status,
      'metrics_sha256',v_existing.metrics_sha256,
      'contract_version','phase46-v1'
    );
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase46-v1',
    'kind','drift_budget_revision',
    'budget_key',v_key,
    'baseline_snapshot_id',v_baseline.snapshot_id,
    'prior_max_content_drift',v_prior_drift,
    'prior_max_storage_unavailable',v_prior_storage,
    'proposed_max_content_drift',v_prop_drift,
    'proposed_max_storage_unavailable',v_prop_storage,
    'window_days',v_days,
    'status','proposed',
    'metadata',v_meta
  )::text);

  insert into public.os_docusign_archive_drift_budget_revisions(
    budget_key,baseline_snapshot_id,
    prior_max_content_drift,prior_max_storage_unavailable,
    proposed_max_content_drift,proposed_max_storage_unavailable,
    window_days,status,metrics_sha256,metadata)
  values (
    v_key,v_baseline.snapshot_id,
    v_prior_drift,v_prior_storage,
    v_prop_drift,v_prop_storage,
    v_days,'proposed',v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase46-v1',
      'source_budget_id',v_budget.budget_id
    ))
  returning * into v_row;

  return jsonb_build_object(
    'disposition','proposed',
    'revision_id',v_row.revision_id,
    'budget_key',v_row.budget_key,
    'baseline_snapshot_id',v_row.baseline_snapshot_id,
    'prior_max_content_drift',v_row.prior_max_content_drift,
    'prior_max_storage_unavailable',v_row.prior_max_storage_unavailable,
    'proposed_max_content_drift',v_row.proposed_max_content_drift,
    'proposed_max_storage_unavailable',v_row.proposed_max_storage_unavailable,
    'window_days',v_row.window_days,
    'status',v_row.status,
    'metrics_sha256',v_row.metrics_sha256,
    'contract_version','phase46-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Activate a proposed drift budget revision (writes new active Phase 45 budget)
-- ---------------------------------------------------------------------------
create or replace function public.activate_docusign_drift_budget_revision_phase46(
  p_revision_id uuid,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_proposed public.os_docusign_archive_drift_budget_revisions%rowtype;
  v_hash text;
  v_activated public.os_docusign_archive_drift_budget_revisions%rowtype;
  v_budget jsonb;
begin
  if p_revision_id is null
     or not public.phase46_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 46 drift budget activation contract is invalid or unsafe';
  end if;

  select * into v_proposed
  from public.os_docusign_archive_drift_budget_revisions
  where revision_id = p_revision_id;

  if not found or v_proposed.status is distinct from 'proposed' then
    return jsonb_build_object(
      'disposition','blocked',
      'block_reason','proposed_revision_required',
      'revision_id',p_revision_id,
      'contract_version','phase46-v1'
    );
  end if;

  select * into v_activated
  from public.os_docusign_archive_drift_budget_revisions r
  where r.status = 'activated'
    and r.metadata->>'source_revision_id' = p_revision_id::text
  order by r.created_at desc
  limit 1;

  if v_activated.revision_id is not null then
    return jsonb_build_object(
      'disposition','unchanged',
      'revision_id',v_activated.revision_id,
      'source_revision_id',p_revision_id,
      'budget_key',v_activated.budget_key,
      'baseline_snapshot_id',v_activated.baseline_snapshot_id,
      'proposed_max_content_drift',v_activated.proposed_max_content_drift,
      'proposed_max_storage_unavailable',v_activated.proposed_max_storage_unavailable,
      'window_days',v_activated.window_days,
      'status',v_activated.status,
      'metrics_sha256',v_activated.metrics_sha256,
      'contract_version','phase46-v1'
    );
  end if;

  v_budget := public.upsert_docusign_archive_drift_budget_phase45(
    v_proposed.budget_key,
    v_proposed.proposed_max_content_drift,
    v_proposed.proposed_max_storage_unavailable,
    v_proposed.window_days,
    'active',
    v_meta || jsonb_build_object(
      'contract_version','phase46-v1',
      'activated_revision_id',v_proposed.revision_id,
      'baseline_snapshot_id',v_proposed.baseline_snapshot_id
    )
  );

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase46-v1',
    'kind','drift_budget_revision',
    'revision_id',v_proposed.revision_id,
    'budget_key',v_proposed.budget_key,
    'baseline_snapshot_id',v_proposed.baseline_snapshot_id,
    'prior_max_content_drift',v_proposed.prior_max_content_drift,
    'prior_max_storage_unavailable',v_proposed.prior_max_storage_unavailable,
    'proposed_max_content_drift',v_proposed.proposed_max_content_drift,
    'proposed_max_storage_unavailable',v_proposed.proposed_max_storage_unavailable,
    'window_days',v_proposed.window_days,
    'status','activated',
    'activated_budget_id',v_budget->>'budget_id',
    'metadata',v_meta
  )::text);

  insert into public.os_docusign_archive_drift_budget_revisions(
    budget_key,baseline_snapshot_id,
    prior_max_content_drift,prior_max_storage_unavailable,
    proposed_max_content_drift,proposed_max_storage_unavailable,
    window_days,status,metrics_sha256,metadata)
  values (
    v_proposed.budget_key,v_proposed.baseline_snapshot_id,
    v_proposed.prior_max_content_drift,v_proposed.prior_max_storage_unavailable,
    v_proposed.proposed_max_content_drift,v_proposed.proposed_max_storage_unavailable,
    v_proposed.window_days,'activated',v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase46-v1',
      'source_revision_id',v_proposed.revision_id,
      'activated_budget_id',v_budget->>'budget_id'
    ))
  returning * into v_activated;

  return jsonb_build_object(
    'disposition','activated',
    'revision_id',v_activated.revision_id,
    'source_revision_id',v_proposed.revision_id,
    'budget_key',v_activated.budget_key,
    'baseline_snapshot_id',v_activated.baseline_snapshot_id,
    'proposed_max_content_drift',v_activated.proposed_max_content_drift,
    'proposed_max_storage_unavailable',v_activated.proposed_max_storage_unavailable,
    'window_days',v_activated.window_days,
    'status',v_activated.status,
    'budget',v_budget,
    'metrics_sha256',v_activated.metrics_sha256,
    'contract_version','phase46-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record enhanced integrity cadence ops visibility
-- ---------------------------------------------------------------------------
create or replace function public.record_docusign_integrity_cadence_ops_phase46(
  p_metadata jsonb default '{}'::jsonb,
  p_sample_sla_days integer default 7
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_sample_sla integer := least(greatest(coalesce(p_sample_sla_days, 7), 1), 90);
  v_last_sample timestamptz;
  v_last_full timestamptz;
  v_last_quarterly timestamptz;
  v_next_due timestamptz;
  v_sample_overdue boolean;
  v_full_overdue boolean;
  v_quarterly_overdue boolean;
  v_health text;
  v_arm public.os_docusign_archive_recurring_quarterly_arms%rowtype;
  v_hash text;
  v_row public.os_docusign_archive_integrity_cadence_ops%rowtype;
begin
  if not public.phase46_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 46 cadence ops metadata is invalid or unsafe';
  end if;

  select max(r.completed_at) into v_last_sample
  from public.os_docusign_archive_governance_runs r
  where r.run_kind='integrity_scan'
    and r.scan_mode='sample'
    and r.status in ('completed','partial')
    and r.completed_at is not null;

  select max(r.completed_at) into v_last_full
  from public.os_docusign_archive_governance_runs r
  where r.run_kind='integrity_scan'
    and r.scan_mode='full'
    and r.status in ('completed','partial')
    and r.completed_at is not null;

  select max(e.created_at) into v_last_quarterly
  from public.os_docusign_archive_campaign_ops_events e
  where e.event_kind in ('quarterly_first_milestone','quarterly_completed');

  select * into v_arm
  from public.os_docusign_archive_recurring_quarterly_arms a
  where a.status='armed'
  order by a.created_at desc
  limit 1;

  v_full_overdue := public.is_docusign_quarterly_full_integrity_due();

  if v_arm.arm_id is not null then
    v_next_due := v_arm.next_due;
  else
    v_next_due := date_trunc('quarter', timezone('utc', now())) + interval '3 months';
  end if;

  v_sample_overdue := false;
  if v_last_sample is null then
    v_sample_overdue := true;
  elsif v_last_sample < now() - make_interval(days => v_sample_sla) then
    v_sample_overdue := true;
  end if;

  v_quarterly_overdue := false;
  if v_arm.arm_id is not null and v_arm.next_due <= now() then
    v_quarterly_overdue := true;
  elsif v_full_overdue then
    v_quarterly_overdue := true;
  end if;

  if (v_sample_overdue and v_full_overdue)
     or (v_sample_overdue and v_quarterly_overdue)
     or (v_full_overdue and v_quarterly_overdue) then
    v_health := 'critical';
  elsif v_sample_overdue or v_full_overdue or v_quarterly_overdue then
    v_health := 'watch';
  elsif v_last_sample is not null or v_last_full is not null then
    v_health := 'healthy';
  else
    v_health := 'unknown';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase46-v1',
    'kind','integrity_cadence_ops',
    'last_sample_at',v_last_sample,
    'last_full_at',v_last_full,
    'last_quarterly_at',v_last_quarterly,
    'next_quarterly_due',v_next_due,
    'sample_overdue',v_sample_overdue,
    'full_overdue',v_full_overdue,
    'quarterly_overdue',v_quarterly_overdue,
    'health',v_health,
    'sample_sla_days',v_sample_sla,
    'metadata',v_meta
  )::text);

  insert into public.os_docusign_archive_integrity_cadence_ops(
    last_sample_at,last_full_at,last_quarterly_at,next_quarterly_due,
    sample_overdue,full_overdue,quarterly_overdue,health,
    metrics_sha256,metadata)
  values (
    v_last_sample,v_last_full,v_last_quarterly,v_next_due,
    v_sample_overdue,v_full_overdue,v_quarterly_overdue,v_health,
    v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase46-v1',
      'sample_sla_days',v_sample_sla,
      'arm_id',v_arm.arm_id
    ))
  returning * into v_row;

  return jsonb_build_object(
    'disposition','recorded',
    'ops_id',v_row.ops_id,
    'last_sample_at',v_row.last_sample_at,
    'last_full_at',v_row.last_full_at,
    'last_quarterly_at',v_row.last_quarterly_at,
    'next_quarterly_due',v_row.next_quarterly_due,
    'sample_overdue',v_row.sample_overdue,
    'full_overdue',v_row.full_overdue,
    'quarterly_overdue',v_row.quarterly_overdue,
    'health',v_row.health,
    'metrics_sha256',v_row.metrics_sha256,
    'contract_version','phase46-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- List critical windows that still need an idempotent ops alert insert
-- ---------------------------------------------------------------------------
create or replace function public.list_docusign_archive_phase46_critical_windows(
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
  v_completion public.os_docusign_archive_first_quarterly_completion%rowtype;
  v_arm public.os_docusign_archive_recurring_quarterly_arms%rowtype;
  v_cadence public.os_docusign_archive_integrity_cadence_ops%rowtype;
  v_budget public.os_docusign_archive_drift_budgets%rowtype;
  v_baseline public.os_docusign_archive_drift_snapshots%rowtype;
  v_activated public.os_docusign_archive_drift_budget_revisions%rowtype;
  v_key text;
  v_can_tighten boolean := false;
begin
  v_bucket := to_char(
    to_timestamp(
      (floor(extract(epoch from now()) / (v_hours * 3600.0))
        * (v_hours * 3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  select * into v_completion
  from public.os_docusign_archive_first_quarterly_completion c
  where c.status = 'completed'
  order by c.created_at desc
  limit 1;

  select * into v_arm
  from public.os_docusign_archive_recurring_quarterly_arms a
  where a.status = 'armed'
  order by a.created_at desc
  limit 1;

  select * into v_cadence
  from public.os_docusign_archive_integrity_cadence_ops
  order by created_at desc
  limit 1;

  select * into v_budget
  from public.os_docusign_archive_drift_budgets b
  where b.status='active'
  order by b.created_at desc
  limit 1;

  select * into v_baseline
  from public.os_docusign_archive_drift_snapshots
  order by created_at desc
  limit 1;

  select * into v_activated
  from public.os_docusign_archive_drift_budget_revisions r
  where r.status='activated'
  order by r.created_at desc
  limit 1;

  if v_completion.completion_id is null then
    v_key := 'fqincomp:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase46_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','first_quarterly_incomplete',
        'window_key',v_key,
        'severity','critical'
      ));
    end if;
  end if;

  if v_completion.completion_id is not null and v_arm.arm_id is null then
    v_key := 'recurunarm46:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase46_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','recurring_unarmed',
        'window_key',v_key,
        'severity','critical',
        'completion_id',v_completion.completion_id
      ));
    end if;
  end if;

  if v_budget.budget_id is not null
     and v_baseline.snapshot_id is not null then
    if (
         v_baseline.content_drift_count < v_budget.max_content_drift_per_window
         or v_baseline.storage_unavailable_count < v_budget.max_storage_unavailable
       )
       and (
         v_activated.revision_id is null
         or v_activated.created_at < now() - interval '30 days'
       ) then
      v_can_tighten := true;
    end if;
  end if;

  if v_can_tighten then
    v_key := 'drifttight:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase46_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','drift_budget_tighten_due',
        'window_key',v_key,
        'severity','critical',
        'budget_id',v_budget.budget_id,
        'baseline_snapshot_id',v_baseline.snapshot_id,
        'max_content_drift_per_window',v_budget.max_content_drift_per_window,
        'max_storage_unavailable',v_budget.max_storage_unavailable,
        'baseline_content_drift_count',v_baseline.content_drift_count,
        'baseline_storage_unavailable_count',v_baseline.storage_unavailable_count
      ));
    end if;
  end if;

  if v_cadence.ops_id is not null
     and v_cadence.health in ('watch','critical') then
    v_key := 'cadenceunh:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase46_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','cadence_unhealthy',
        'window_key',v_key,
        'severity','critical',
        'metrics_sha256',v_cadence.metrics_sha256,
        'ops_id',v_cadence.ops_id,
        'health',v_cadence.health,
        'sample_overdue',v_cadence.sample_overdue,
        'full_overdue',v_cadence.full_overdue,
        'quarterly_overdue',v_cadence.quarterly_overdue,
        'last_sample_at',v_cadence.last_sample_at,
        'last_full_at',v_cadence.last_full_at,
        'last_quarterly_at',v_cadence.last_quarterly_at,
        'next_quarterly_due',v_cadence.next_quarterly_due
      ));
    end if;
  end if;

  return jsonb_build_object(
    'version','phase46-v1',
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',v_pending
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record one critical ops alert after delivery attempt (idempotent window_key)
-- ---------------------------------------------------------------------------
create or replace function public.record_docusign_archive_phase46_ops_alert(
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
    raise exception 'Phase 46 ops alert payload must be a JSON object';
  end if;

  v_kind := coalesce(p_alert->>'alert_kind','');
  v_window := coalesce(p_alert->>'window_key','');
  v_dest := coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery := coalesce(p_alert->>'delivery_status','recorded');
  v_code := nullif(p_alert->>'response_code','')::integer;
  v_meta := coalesce(p_alert->'metadata','{}'::jsonb);

  if v_kind not in (
       'first_quarterly_incomplete',
       'recurring_unarmed',
       'drift_budget_tighten_due',
       'cadence_unhealthy'
     )
     or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
     or v_dest ~* '://|^https?'
     or v_delivery not in
       ('delivered','skipped_no_webhook','failed','recorded')
     or not public.phase46_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 46 ops alert contract is invalid or unsafe';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase46-v1',
    'alert_kind',v_kind,
    'window_key',v_window,
    'severity','critical',
    'destination_key',v_dest,
    'delivery_status',v_delivery,
    'response_code',v_code
  )::text);

  insert into public.os_docusign_archive_phase46_ops_alerts(
    alert_kind,window_key,severity,destination_key,
    delivery_status,response_code,metrics_sha256,metadata)
  values (
    v_kind,v_window,'critical',v_dest,
    v_delivery,v_code,v_hash,
    v_meta || jsonb_build_object('contract_version','phase46-v1'))
  on conflict (window_key) do nothing
  returning alert_id, delivery_status into v_id, v_status;

  if v_id is null then
    select alert_id, delivery_status into v_id, v_status
    from public.os_docusign_archive_phase46_ops_alerts
    where window_key = v_window;
    return jsonb_build_object(
      'version','phase46-v1',
      'alert_id',v_id,
      'window_key',v_window,
      'delivery_status',v_status,
      'inserted',false);
  end if;

  return jsonb_build_object(
    'version','phase46-v1',
    'alert_id',v_id,
    'window_key',v_window,
    'delivery_status',v_status,
    'inserted',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Hub report: first quarterly, recurring arms, drift revisions, cadence ops
-- ---------------------------------------------------------------------------
create or replace function public.get_docusign_archive_phase46_ops_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_completion public.os_docusign_archive_first_quarterly_completion%rowtype;
  v_arm public.os_docusign_archive_recurring_quarterly_arms%rowtype;
  v_revision public.os_docusign_archive_drift_budget_revisions%rowtype;
  v_cadence public.os_docusign_archive_integrity_cadence_ops%rowtype;
  v_alerts jsonb;
  v_first_status text := 'incomplete';
  v_recurring_status text := 'unarmed';
  v_drift_revision_status text := 'none';
  v_cadence_health text := 'unknown';
  v_alert_delivery text := 'none';
  v_critical_open integer := 0;
begin
  select * into v_completion
  from public.os_docusign_archive_first_quarterly_completion c
  where c.status = 'completed'
  order by c.created_at desc
  limit 1;

  if v_completion.completion_id is null then
    select * into v_completion
    from public.os_docusign_archive_first_quarterly_completion
    order by created_at desc
    limit 1;
  end if;

  select * into v_arm
  from public.os_docusign_archive_recurring_quarterly_arms a
  where a.status = 'armed'
  order by a.created_at desc
  limit 1;

  select * into v_revision
  from public.os_docusign_archive_drift_budget_revisions
  order by created_at desc
  limit 1;

  select * into v_cadence
  from public.os_docusign_archive_integrity_cadence_ops
  order by created_at desc
  limit 1;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
  into v_alerts
  from (
    select alert_id, alert_kind, window_key, severity, destination_key,
      delivery_status, response_code, metrics_sha256, created_at
    from public.os_docusign_archive_phase46_ops_alerts
    order by created_at desc
    limit 20
  ) a;

  if v_completion.completion_id is not null
     and v_completion.status = 'completed' then
    v_first_status := 'completed';
  elsif v_completion.completion_id is not null
     and v_completion.status = 'blocked' then
    v_first_status := 'blocked';
  end if;

  if v_arm.arm_id is not null then
    v_recurring_status := 'armed';
  end if;

  if v_revision.revision_id is not null then
    v_drift_revision_status := v_revision.status;
  end if;

  if v_cadence.ops_id is not null then
    v_cadence_health := v_cadence.health;
  end if;

  select count(*)::integer into v_critical_open
  from public.os_docusign_archive_phase46_ops_alerts a
  where a.created_at >= now() - interval '7 days';

  select coalesce((
    select case
      when bool_or(x.delivery_status = 'failed') then 'failed'
      when bool_or(x.delivery_status = 'skipped_no_webhook') then 'skipped_no_webhook'
      when bool_or(x.delivery_status = 'delivered') then 'delivered'
      when bool_or(x.delivery_status = 'recorded') then 'recorded'
      else 'none'
    end
    from public.os_docusign_archive_phase46_ops_alerts x
    where x.created_at >= now() - interval '7 days'
  ), 'none') into v_alert_delivery;

  return jsonb_build_object(
    'version','phase46-v1',
    'first_quarterly_status',v_first_status,
    'recurring_quarterly_status',v_recurring_status,
    'drift_revision_status',v_drift_revision_status,
    'cadence_health',v_cadence_health,
    'alert_delivery',v_alert_delivery,
    'critical_alert_count',v_critical_open,
    'first_quarterly_completed',v_first_status = 'completed',
    'recurring_quarterly_armed',v_recurring_status = 'armed',
    'latest_completion', case
      when v_completion.completion_id is null then null
      else jsonb_build_object(
        'completion_id',v_completion.completion_id,
        'completion_key',v_completion.completion_key,
        'status',v_completion.status,
        'gate_ready',v_completion.gate_ready,
        'gate_completed',v_completion.gate_completed,
        'runbook_completed',v_completion.runbook_completed,
        'block_reason',v_completion.block_reason,
        'metrics_sha256',v_completion.metrics_sha256,
        'created_at',v_completion.created_at
      )
    end,
    'latest_arm', case
      when v_arm.arm_id is null then null
      else jsonb_build_object(
        'arm_id',v_arm.arm_id,
        'arm_key',v_arm.arm_key,
        'completion_id',v_arm.completion_id,
        'armed_at',v_arm.armed_at,
        'next_due',v_arm.next_due,
        'cadence_months',v_arm.cadence_months,
        'status',v_arm.status,
        'metrics_sha256',v_arm.metrics_sha256,
        'created_at',v_arm.created_at
      )
    end,
    'latest_revision', case
      when v_revision.revision_id is null then null
      else jsonb_build_object(
        'revision_id',v_revision.revision_id,
        'budget_key',v_revision.budget_key,
        'baseline_snapshot_id',v_revision.baseline_snapshot_id,
        'prior_max_content_drift',v_revision.prior_max_content_drift,
        'prior_max_storage_unavailable',v_revision.prior_max_storage_unavailable,
        'proposed_max_content_drift',v_revision.proposed_max_content_drift,
        'proposed_max_storage_unavailable',v_revision.proposed_max_storage_unavailable,
        'window_days',v_revision.window_days,
        'status',v_revision.status,
        'metrics_sha256',v_revision.metrics_sha256,
        'created_at',v_revision.created_at
      )
    end,
    'latest_cadence', case
      when v_cadence.ops_id is null then null
      else jsonb_build_object(
        'ops_id',v_cadence.ops_id,
        'last_sample_at',v_cadence.last_sample_at,
        'last_full_at',v_cadence.last_full_at,
        'last_quarterly_at',v_cadence.last_quarterly_at,
        'next_quarterly_due',v_cadence.next_quarterly_due,
        'sample_overdue',v_cadence.sample_overdue,
        'full_overdue',v_cadence.full_overdue,
        'quarterly_overdue',v_cadence.quarterly_overdue,
        'health',v_cadence.health,
        'metrics_sha256',v_cadence.metrics_sha256,
        'created_at',v_cadence.created_at
      )
    end,
    'alerts',coalesce(v_alerts,'[]'::jsonb),
    'destination_key','ops_alerts'
  );
end;
$$;

revoke all on function public.reject_docusign_phase46_ops_mutation()
  from public, anon, authenticated;
revoke all on function public.complete_docusign_first_quarterly_review_phase46(jsonb)
  from public, anon, authenticated;
revoke all on function public.arm_docusign_recurring_quarterly_phase46(integer,jsonb)
  from public, anon, authenticated;
revoke all on function public.tighten_docusign_drift_budget_phase46(
  text,integer,integer,jsonb)
  from public, anon, authenticated;
revoke all on function public.activate_docusign_drift_budget_revision_phase46(
  uuid,jsonb)
  from public, anon, authenticated;
revoke all on function public.record_docusign_integrity_cadence_ops_phase46(
  jsonb,integer)
  from public, anon, authenticated;
revoke all on function public.list_docusign_archive_phase46_critical_windows(integer)
  from public, anon;
revoke all on function public.record_docusign_archive_phase46_ops_alert(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_docusign_archive_phase46_ops_report()
  from public, anon;

grant execute on function public.phase46_docusign_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.list_docusign_archive_phase46_critical_windows(integer)
  to authenticated, service_role;
grant execute on function public.get_docusign_archive_phase46_ops_report()
  to authenticated, service_role;
grant execute on function public.complete_docusign_first_quarterly_review_phase46(jsonb)
  to service_role;
grant execute on function public.arm_docusign_recurring_quarterly_phase46(integer,jsonb)
  to service_role;
grant execute on function public.tighten_docusign_drift_budget_phase46(
  text,integer,integer,jsonb)
  to service_role;
grant execute on function public.activate_docusign_drift_budget_revision_phase46(
  uuid,jsonb)
  to service_role;
grant execute on function public.record_docusign_integrity_cadence_ops_phase46(
  jsonb,integer)
  to service_role;
grant execute on function public.record_docusign_archive_phase46_ops_alert(jsonb)
  to service_role;
grant execute on function public.os_sha256_hex(text)
  to authenticated, service_role;
