-- Phase 47: DocuSign first armed recurring quarterly under tightened drift budgets.
-- Depends on phase46_docusign_archive_ops.sql.
-- Bootstraps Phase 46 arm/revision helpers if missing so this migration is re-runnable.
-- Runs first armed recurring quarterly path evidence; records drift performance.
-- Visibility/reporting for recurring quarterly execution + drift budgets.
-- Never create/void/resend envelopes. Evidence = digests/metadata only.
-- Never mutates snapshot retirement tables.
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

-- Bootstrap Phase 46 safe-metadata helper if Phase 46 DocuSign SQL was skipped.
create or replace function public.phase46_docusign_ops_safe_metadata(p_detail jsonb)
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

create or replace function public.phase47_docusign_ops_safe_metadata(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select public.phase46_docusign_ops_safe_metadata(p_detail);
$$;

-- ---------------------------------------------------------------------------
-- Bootstrap Phase 46 first-quarterly completion (arm FK target)
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
-- Bootstrap Phase 46 recurring quarterly arms
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
-- Bootstrap Phase 46 drift budget revisions (tightened budget evidence)
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

-- ---------------------------------------------------------------------------
-- Append-only recurring quarterly run evidence
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_recurring_quarterly_runs (
  run_id uuid primary key default gen_random_uuid(),
  run_key text not null unique
    check (run_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  arm_id uuid not null
    references public.os_docusign_archive_recurring_quarterly_arms(arm_id),
  campaign_id uuid,
  revision_id uuid,
  budget_id uuid,
  status text not null
    check (status in ('started','completed','blocked','drift_budget_breach')),
  content_drift_count integer not null default 0
    check (content_drift_count >= 0),
  storage_unavailable_count integer not null default 0
    check (storage_unavailable_count >= 0),
  max_content_drift_per_window integer not null default 0
    check (max_content_drift_per_window >= 0),
  max_storage_unavailable integer not null default 0
    check (max_storage_unavailable >= 0),
  within_budget boolean not null default false,
  block_reason text,
  metrics_sha256 text not null
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_recur_run_reason_check
    check (
      (
        status in ('started','completed')
        and block_reason is null
      )
      or (
        status in ('blocked','drift_budget_breach')
        and block_reason is not null
        and length(block_reason) between 8 and 500
      )
    ),
  constraint os_docusign_archive_recur_run_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase47_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_recur_run_created_idx
  on public.os_docusign_archive_recurring_quarterly_runs(created_at desc);
create index if not exists os_docusign_archive_recur_run_status_idx
  on public.os_docusign_archive_recurring_quarterly_runs(status, created_at desc);
create index if not exists os_docusign_archive_recur_run_arm_idx
  on public.os_docusign_archive_recurring_quarterly_runs(arm_id, created_at desc);

alter table public.os_docusign_archive_recurring_quarterly_runs
  enable row level security;
drop policy if exists "os_docusign_archive_recur_run_select"
  on public.os_docusign_archive_recurring_quarterly_runs;
create policy "os_docusign_archive_recur_run_select"
  on public.os_docusign_archive_recurring_quarterly_runs for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_recurring_quarterly_runs
  from public, anon, authenticated;
grant select on public.os_docusign_archive_recurring_quarterly_runs
  to authenticated;

-- ---------------------------------------------------------------------------
-- Append-only recurring quarterly summary reports (hub)
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_recurring_quarterly_reports (
  report_id uuid primary key default gen_random_uuid(),
  report_key text not null unique
    check (report_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  run_id uuid
    references public.os_docusign_archive_recurring_quarterly_runs(run_id),
  recurring_run_status text not null
    check (recurring_run_status in (
      'none','started','completed','blocked','drift_budget_breach'
    )),
  drift_performance text not null
    check (drift_performance in ('unknown','within_budget','breach')),
  content_drift_count integer not null default 0
    check (content_drift_count >= 0),
  storage_unavailable_count integer not null default 0
    check (storage_unavailable_count >= 0),
  max_content_drift_per_window integer not null default 0
    check (max_content_drift_per_window >= 0),
  max_storage_unavailable integer not null default 0
    check (max_storage_unavailable >= 0),
  within_budget boolean not null default false,
  metrics_sha256 text not null
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_recur_rpt_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase47_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_recur_rpt_created_idx
  on public.os_docusign_archive_recurring_quarterly_reports(created_at desc);
create index if not exists os_docusign_archive_recur_rpt_status_idx
  on public.os_docusign_archive_recurring_quarterly_reports(
    recurring_run_status, created_at desc
  );

alter table public.os_docusign_archive_recurring_quarterly_reports
  enable row level security;
drop policy if exists "os_docusign_archive_recur_rpt_select"
  on public.os_docusign_archive_recurring_quarterly_reports;
create policy "os_docusign_archive_recur_rpt_select"
  on public.os_docusign_archive_recurring_quarterly_reports for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_recurring_quarterly_reports
  from public, anon, authenticated;
grant select on public.os_docusign_archive_recurring_quarterly_reports
  to authenticated;

-- ---------------------------------------------------------------------------
-- Append-only Phase 47 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_phase47_ops_alerts (
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
  constraint os_docusign_archive_p47_alert_kind_check
    check (alert_kind in (
      'recurring_run_blocked',
      'drift_budget_breach_during_quarterly',
      'first_recurring_completed',
      'cadence_report_ready'
    )),
  constraint os_docusign_archive_p47_alert_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase47_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_p47_alert_created_idx
  on public.os_docusign_archive_phase47_ops_alerts(created_at desc);
create index if not exists os_docusign_archive_p47_alert_kind_idx
  on public.os_docusign_archive_phase47_ops_alerts(alert_kind, created_at desc);

alter table public.os_docusign_archive_phase47_ops_alerts
  enable row level security;
drop policy if exists "os_docusign_archive_p47_alert_select"
  on public.os_docusign_archive_phase47_ops_alerts;
create policy "os_docusign_archive_p47_alert_select"
  on public.os_docusign_archive_phase47_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_phase47_ops_alerts
  from public, anon, authenticated;
grant select on public.os_docusign_archive_phase47_ops_alerts
  to authenticated;

create or replace function public.reject_docusign_phase47_ops_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Phase 47 DocuSign archive ops evidence is append-only';
end;
$$;

drop trigger if exists os_docusign_archive_recur_run_immutable
  on public.os_docusign_archive_recurring_quarterly_runs;
create trigger os_docusign_archive_recur_run_immutable
  before update or delete on public.os_docusign_archive_recurring_quarterly_runs
  for each row execute function public.reject_docusign_phase47_ops_mutation();
drop trigger if exists os_docusign_archive_recur_run_no_truncate
  on public.os_docusign_archive_recurring_quarterly_runs;
create trigger os_docusign_archive_recur_run_no_truncate
  before truncate on public.os_docusign_archive_recurring_quarterly_runs
  for each statement execute function public.reject_docusign_phase47_ops_mutation();

drop trigger if exists os_docusign_archive_recur_rpt_immutable
  on public.os_docusign_archive_recurring_quarterly_reports;
create trigger os_docusign_archive_recur_rpt_immutable
  before update or delete on public.os_docusign_archive_recurring_quarterly_reports
  for each row execute function public.reject_docusign_phase47_ops_mutation();
drop trigger if exists os_docusign_archive_recur_rpt_no_truncate
  on public.os_docusign_archive_recurring_quarterly_reports;
create trigger os_docusign_archive_recur_rpt_no_truncate
  before truncate on public.os_docusign_archive_recurring_quarterly_reports
  for each statement execute function public.reject_docusign_phase47_ops_mutation();

drop trigger if exists os_docusign_archive_p47_alert_immutable
  on public.os_docusign_archive_phase47_ops_alerts;
create trigger os_docusign_archive_p47_alert_immutable
  before update or delete on public.os_docusign_archive_phase47_ops_alerts
  for each row execute function public.reject_docusign_phase47_ops_mutation();
drop trigger if exists os_docusign_archive_p47_alert_no_truncate
  on public.os_docusign_archive_phase47_ops_alerts;
create trigger os_docusign_archive_p47_alert_no_truncate
  before truncate on public.os_docusign_archive_phase47_ops_alerts
  for each statement execute function public.reject_docusign_phase47_ops_mutation();

-- ---------------------------------------------------------------------------
-- Run first armed recurring quarterly under tightened drift budgets
-- ---------------------------------------------------------------------------
create or replace function public.run_docusign_first_armed_recurring_quarterly_phase47(
  p_metadata jsonb default '{}'::jsonb,
  p_force boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_arm public.os_docusign_archive_recurring_quarterly_arms%rowtype;
  v_revision public.os_docusign_archive_drift_budget_revisions%rowtype;
  v_budget_id uuid;
  v_max_drift integer := 0;
  v_max_storage integer := 0;
  v_content_drift integer := 0;
  v_storage_unavail integer := 0;
  v_within boolean := false;
  v_breach boolean := false;
  v_existing public.os_docusign_archive_recurring_quarterly_runs%rowtype;
  v_key text := 'recurrun:firm:first_armed_quarterly';
  v_status text;
  v_reason text;
  v_hash text;
  v_id uuid;
  v_campaign_id uuid;
  v_campaign jsonb;
  v_open_ok boolean := false;
  v_campaign_disposition text;
  v_has_budget_table boolean := false;
  v_has_snap_table boolean := false;
  v_has_open_fn boolean := false;
begin
  if not public.phase47_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 47 recurring quarterly run metadata is invalid or unsafe';
  end if;

  select * into v_existing
  from public.os_docusign_archive_recurring_quarterly_runs r
  where r.run_key = v_key
    and r.status = 'completed'
  order by r.created_at desc
  limit 1;

  if v_existing.run_id is not null then
    return jsonb_build_object(
      'disposition','unchanged',
      'run_id',v_existing.run_id,
      'run_key',v_existing.run_key,
      'arm_id',v_existing.arm_id,
      'campaign_id',v_existing.campaign_id,
      'revision_id',v_existing.revision_id,
      'budget_id',v_existing.budget_id,
      'status',v_existing.status,
      'content_drift_count',v_existing.content_drift_count,
      'storage_unavailable_count',v_existing.storage_unavailable_count,
      'max_content_drift_per_window',v_existing.max_content_drift_per_window,
      'max_storage_unavailable',v_existing.max_storage_unavailable,
      'within_budget',v_existing.within_budget,
      'block_reason',v_existing.block_reason,
      'metrics_sha256',v_existing.metrics_sha256,
      'contract_version','phase47-v1'
    );
  end if;

  select * into v_arm
  from public.os_docusign_archive_recurring_quarterly_arms a
  where a.status = 'armed'
  order by a.created_at desc
  limit 1;

  if v_arm.arm_id is null then
    return jsonb_build_object(
      'disposition','blocked',
      'status','blocked',
      'block_reason','armed_recurring_arm_required',
      'contract_version','phase47-v1'
    );
  end if;

  select * into v_revision
  from public.os_docusign_archive_drift_budget_revisions r
  where r.status = 'activated'
  order by r.created_at desc
  limit 1;

  if v_revision.revision_id is null then
    return jsonb_build_object(
      'disposition','blocked',
      'status','blocked',
      'arm_id',v_arm.arm_id,
      'block_reason','active_tightened_budget_required',
      'contract_version','phase47-v1'
    );
  end if;

  select exists (
    select 1 from information_schema.tables t
    where t.table_schema='public'
      and t.table_name='os_docusign_archive_drift_budgets'
  ) into v_has_budget_table;

  if v_has_budget_table then
    execute
      'select b.budget_id, b.max_content_drift_per_window, b.max_storage_unavailable '
      || 'from public.os_docusign_archive_drift_budgets b '
      || 'where b.status = ''active'' and b.budget_key = $1 '
      || 'order by b.created_at desc limit 1'
    into v_budget_id, v_max_drift, v_max_storage
    using v_revision.budget_key;
  end if;

  if v_budget_id is null then
    v_max_drift := v_revision.proposed_max_content_drift;
    v_max_storage := v_revision.proposed_max_storage_unavailable;
  end if;

  select exists (
    select 1 from information_schema.tables t
    where t.table_schema='public'
      and t.table_name='os_docusign_archive_drift_snapshots'
  ) into v_has_snap_table;

  if v_has_snap_table then
    execute
      'select s.content_drift_count, s.storage_unavailable_count '
      || 'from public.os_docusign_archive_drift_snapshots s '
      || 'order by s.created_at desc limit 1'
    into v_content_drift, v_storage_unavail;
  end if;

  v_content_drift := coalesce(v_content_drift, 0);
  v_storage_unavail := coalesce(v_storage_unavail, 0);
  v_max_drift := coalesce(v_max_drift, v_revision.proposed_max_content_drift);
  v_max_storage := coalesce(v_max_storage, v_revision.proposed_max_storage_unavailable);

  if v_content_drift > v_max_drift then
    v_breach := true;
  end if;
  if v_storage_unavail > v_max_storage then
    v_breach := true;
  end if;

  if not v_breach then
    v_within := true;
  end if;

  if v_breach then
    v_status := 'drift_budget_breach';
    v_reason := 'tightened_drift_budget_breached';
    -- Dated key so a later within-budget pass can still complete first run.
    v_key := 'recurbreach:firm:'||to_char(now(),'YYYYMMDD');
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase47-v1',
      'kind','recurring_quarterly_run',
      'run_key',v_key,
      'arm_id',v_arm.arm_id,
      'revision_id',v_revision.revision_id,
      'budget_id',v_budget_id,
      'status',v_status,
      'content_drift_count',v_content_drift,
      'storage_unavailable_count',v_storage_unavail,
      'max_content_drift_per_window',v_max_drift,
      'max_storage_unavailable',v_max_storage,
      'within_budget',false,
      'block_reason',v_reason,
      'metadata',v_meta
    )::text);

    insert into public.os_docusign_archive_recurring_quarterly_runs(
      run_key,arm_id,campaign_id,revision_id,budget_id,status,
      content_drift_count,storage_unavailable_count,
      max_content_drift_per_window,max_storage_unavailable,
      within_budget,block_reason,metrics_sha256,metadata)
    values (
      v_key,v_arm.arm_id,null,v_revision.revision_id,v_budget_id,v_status,
      v_content_drift,v_storage_unavail,
      v_max_drift,v_max_storage,
      false,v_reason,v_hash,
      v_meta || jsonb_build_object('contract_version','phase47-v1'))
    on conflict (run_key) do nothing
    returning run_id into v_id;

    if v_id is null then
      select * into v_existing
      from public.os_docusign_archive_recurring_quarterly_runs
      where run_key = v_key;
      return jsonb_build_object(
        'disposition','unchanged',
        'run_id',v_existing.run_id,
        'run_key',v_existing.run_key,
        'arm_id',v_existing.arm_id,
        'campaign_id',v_existing.campaign_id,
        'revision_id',v_existing.revision_id,
        'budget_id',v_existing.budget_id,
        'status',v_existing.status,
        'content_drift_count',v_existing.content_drift_count,
        'storage_unavailable_count',v_existing.storage_unavailable_count,
        'max_content_drift_per_window',v_existing.max_content_drift_per_window,
        'max_storage_unavailable',v_existing.max_storage_unavailable,
        'within_budget',v_existing.within_budget,
        'block_reason',v_existing.block_reason,
        'metrics_sha256',v_existing.metrics_sha256,
        'contract_version','phase47-v1'
      );
    end if;

    return jsonb_build_object(
      'disposition','drift_budget_breach',
      'run_id',v_id,
      'run_key',v_key,
      'arm_id',v_arm.arm_id,
      'revision_id',v_revision.revision_id,
      'budget_id',v_budget_id,
      'status',v_status,
      'content_drift_count',v_content_drift,
      'storage_unavailable_count',v_storage_unavail,
      'max_content_drift_per_window',v_max_drift,
      'max_storage_unavailable',v_max_storage,
      'within_budget',false,
      'block_reason',v_reason,
      'metrics_sha256',v_hash,
      'contract_version','phase47-v1'
    );
  end if;

  -- Open/tick quarterly campaign path evidence (no envelope create/void/resend).
  select exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'open_docusign_archive_campaign'
  ) into v_has_open_fn;

  if v_has_open_fn then
    begin
      v_campaign := public.open_docusign_archive_campaign(
        'quarterly_full_integrity',
        'cron',
        null,
        null,
        coalesce(p_force, true)
      );
      v_campaign_disposition := coalesce(v_campaign->>'disposition', '');
      if v_campaign_disposition in ('opened','already_open','gated') then
        v_open_ok := true;
        v_campaign_id := nullif(v_campaign->>'campaign_id','')::uuid;
      elsif v_campaign_disposition = 'not_due' then
        v_campaign := public.open_docusign_archive_campaign(
          'quarterly_full_integrity',
          'cron',
          null,
          null,
          true
        );
        v_campaign_disposition := coalesce(v_campaign->>'disposition', '');
        if v_campaign_disposition in ('opened','already_open','gated') then
          v_open_ok := true;
          v_campaign_id := nullif(v_campaign->>'campaign_id','')::uuid;
        end if;
      end if;
    exception when others then
      v_open_ok := false;
      v_campaign_disposition := 'open_failed';
    end;
  end if;

  if not v_open_ok then
    v_status := 'blocked';
    v_reason := 'quarterly_campaign_path_unavailable';
    v_key := 'recurblocked:firm:'||v_reason||':'||to_char(now(),'YYYYMMDD');
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase47-v1',
      'kind','recurring_quarterly_run',
      'run_key',v_key,
      'arm_id',v_arm.arm_id,
      'revision_id',v_revision.revision_id,
      'budget_id',v_budget_id,
      'status',v_status,
      'content_drift_count',v_content_drift,
      'storage_unavailable_count',v_storage_unavail,
      'max_content_drift_per_window',v_max_drift,
      'max_storage_unavailable',v_max_storage,
      'within_budget',v_within,
      'block_reason',v_reason,
      'campaign_disposition',v_campaign_disposition,
      'metadata',v_meta
    )::text);

    insert into public.os_docusign_archive_recurring_quarterly_runs(
      run_key,arm_id,campaign_id,revision_id,budget_id,status,
      content_drift_count,storage_unavailable_count,
      max_content_drift_per_window,max_storage_unavailable,
      within_budget,block_reason,metrics_sha256,metadata)
    values (
      v_key,v_arm.arm_id,v_campaign_id,v_revision.revision_id,v_budget_id,v_status,
      v_content_drift,v_storage_unavail,
      v_max_drift,v_max_storage,
      v_within,v_reason,v_hash,
      v_meta || jsonb_build_object(
        'contract_version','phase47-v1',
        'campaign_disposition',v_campaign_disposition
      ))
    on conflict (run_key) do nothing
    returning run_id into v_id;

    if v_id is null then
      select * into v_existing
      from public.os_docusign_archive_recurring_quarterly_runs
      where run_key = v_key;
      return jsonb_build_object(
        'disposition','blocked',
        'run_id',v_existing.run_id,
        'run_key',v_existing.run_key,
        'arm_id',v_existing.arm_id,
        'campaign_id',v_existing.campaign_id,
        'status','blocked',
        'block_reason',v_existing.block_reason,
        'within_budget',v_existing.within_budget,
        'metrics_sha256',v_existing.metrics_sha256,
        'contract_version','phase47-v1'
      );
    end if;

    return jsonb_build_object(
      'disposition','blocked',
      'run_id',v_id,
      'run_key',v_key,
      'arm_id',v_arm.arm_id,
      'campaign_id',v_campaign_id,
      'revision_id',v_revision.revision_id,
      'budget_id',v_budget_id,
      'status','blocked',
      'content_drift_count',v_content_drift,
      'storage_unavailable_count',v_storage_unavail,
      'max_content_drift_per_window',v_max_drift,
      'max_storage_unavailable',v_max_storage,
      'within_budget',v_within,
      'block_reason',v_reason,
      'campaign_disposition',v_campaign_disposition,
      'metrics_sha256',v_hash,
      'contract_version','phase47-v1'
    );
  end if;

  if v_campaign_disposition = 'gated' then
    v_status := 'blocked';
    v_reason := coalesce(nullif(v_campaign->>'gate_reason',''), 'quarterly_campaign_gated');
    if length(v_reason) < 8 then
      v_reason := 'quarterly_campaign_gated';
    end if;
    v_key := 'recurblocked:firm:gated:'||to_char(now(),'YYYYMMDD');
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase47-v1',
      'kind','recurring_quarterly_run',
      'run_key',v_key,
      'arm_id',v_arm.arm_id,
      'campaign_id',v_campaign_id,
      'revision_id',v_revision.revision_id,
      'budget_id',v_budget_id,
      'status',v_status,
      'content_drift_count',v_content_drift,
      'storage_unavailable_count',v_storage_unavail,
      'max_content_drift_per_window',v_max_drift,
      'max_storage_unavailable',v_max_storage,
      'within_budget',v_within,
      'block_reason',v_reason,
      'metadata',v_meta
    )::text);

    insert into public.os_docusign_archive_recurring_quarterly_runs(
      run_key,arm_id,campaign_id,revision_id,budget_id,status,
      content_drift_count,storage_unavailable_count,
      max_content_drift_per_window,max_storage_unavailable,
      within_budget,block_reason,metrics_sha256,metadata)
    values (
      v_key,v_arm.arm_id,v_campaign_id,v_revision.revision_id,v_budget_id,v_status,
      v_content_drift,v_storage_unavail,
      v_max_drift,v_max_storage,
      v_within,v_reason,v_hash,
      v_meta || jsonb_build_object('contract_version','phase47-v1'))
    on conflict (run_key) do nothing
    returning run_id into v_id;

    if v_id is null then
      select * into v_existing
      from public.os_docusign_archive_recurring_quarterly_runs
      where run_key = v_key;
      return jsonb_build_object(
        'disposition','blocked',
        'run_id',v_existing.run_id,
        'status','blocked',
        'block_reason',v_existing.block_reason,
        'campaign_id',v_existing.campaign_id,
        'metrics_sha256',v_existing.metrics_sha256,
        'contract_version','phase47-v1'
      );
    end if;

    return jsonb_build_object(
      'disposition','blocked',
      'run_id',v_id,
      'run_key',v_key,
      'arm_id',v_arm.arm_id,
      'campaign_id',v_campaign_id,
      'revision_id',v_revision.revision_id,
      'budget_id',v_budget_id,
      'status','blocked',
      'content_drift_count',v_content_drift,
      'storage_unavailable_count',v_storage_unavail,
      'max_content_drift_per_window',v_max_drift,
      'max_storage_unavailable',v_max_storage,
      'within_budget',v_within,
      'block_reason',v_reason,
      'metrics_sha256',v_hash,
      'contract_version','phase47-v1'
    );
  end if;

  v_status := 'completed';
  v_reason := null;
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase47-v1',
    'kind','recurring_quarterly_run',
    'run_key',v_key,
    'arm_id',v_arm.arm_id,
    'campaign_id',v_campaign_id,
    'revision_id',v_revision.revision_id,
    'budget_id',v_budget_id,
    'status',v_status,
    'content_drift_count',v_content_drift,
    'storage_unavailable_count',v_storage_unavail,
    'max_content_drift_per_window',v_max_drift,
    'max_storage_unavailable',v_max_storage,
    'within_budget',v_within,
    'campaign_disposition',v_campaign_disposition,
    'metadata',v_meta
  )::text);

  insert into public.os_docusign_archive_recurring_quarterly_runs(
    run_key,arm_id,campaign_id,revision_id,budget_id,status,
    content_drift_count,storage_unavailable_count,
    max_content_drift_per_window,max_storage_unavailable,
    within_budget,block_reason,metrics_sha256,metadata)
  values (
    v_key,v_arm.arm_id,v_campaign_id,v_revision.revision_id,v_budget_id,v_status,
    v_content_drift,v_storage_unavail,
    v_max_drift,v_max_storage,
    v_within,v_reason,v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase47-v1',
      'campaign_disposition',v_campaign_disposition,
      'started_then_completed',true
    ))
  on conflict (run_key) do nothing
  returning run_id into v_id;

  if v_id is null then
    select * into v_existing
    from public.os_docusign_archive_recurring_quarterly_runs
    where run_key = v_key;
    return jsonb_build_object(
      'disposition','unchanged',
      'run_id',v_existing.run_id,
      'run_key',v_existing.run_key,
      'arm_id',v_existing.arm_id,
      'campaign_id',v_existing.campaign_id,
      'revision_id',v_existing.revision_id,
      'budget_id',v_existing.budget_id,
      'status',v_existing.status,
      'content_drift_count',v_existing.content_drift_count,
      'storage_unavailable_count',v_existing.storage_unavailable_count,
      'max_content_drift_per_window',v_existing.max_content_drift_per_window,
      'max_storage_unavailable',v_existing.max_storage_unavailable,
      'within_budget',v_existing.within_budget,
      'block_reason',v_existing.block_reason,
      'metrics_sha256',v_existing.metrics_sha256,
      'contract_version','phase47-v1'
    );
  end if;

  return jsonb_build_object(
    'disposition','completed',
    'run_id',v_id,
    'run_key',v_key,
    'arm_id',v_arm.arm_id,
    'campaign_id',v_campaign_id,
    'revision_id',v_revision.revision_id,
    'budget_id',v_budget_id,
    'status',v_status,
    'content_drift_count',v_content_drift,
    'storage_unavailable_count',v_storage_unavail,
    'max_content_drift_per_window',v_max_drift,
    'max_storage_unavailable',v_max_storage,
    'within_budget',v_within,
    'block_reason',null,
    'campaign_disposition',v_campaign_disposition,
    'metrics_sha256',v_hash,
    'contract_version','phase47-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record recurring quarterly cadence/drift performance report for hub
-- ---------------------------------------------------------------------------
create or replace function public.record_docusign_recurring_quarterly_report_phase47(
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_run public.os_docusign_archive_recurring_quarterly_runs%rowtype;
  v_revision public.os_docusign_archive_drift_budget_revisions%rowtype;
  v_arm public.os_docusign_archive_recurring_quarterly_arms%rowtype;
  v_run_status text := 'none';
  v_perf text := 'unknown';
  v_content integer := 0;
  v_storage integer := 0;
  v_max_drift integer := 0;
  v_max_storage integer := 0;
  v_within boolean := false;
  v_key text;
  v_hash text;
  v_row public.os_docusign_archive_recurring_quarterly_reports%rowtype;
  v_has_snap_table boolean := false;
  v_has_budget_table boolean := false;
  v_budget_id uuid;
begin
  if not public.phase47_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 47 recurring quarterly report metadata is invalid or unsafe';
  end if;

  select * into v_run
  from public.os_docusign_archive_recurring_quarterly_runs
  order by created_at desc
  limit 1;

  select * into v_arm
  from public.os_docusign_archive_recurring_quarterly_arms a
  where a.status = 'armed'
  order by a.created_at desc
  limit 1;

  select * into v_revision
  from public.os_docusign_archive_drift_budget_revisions r
  where r.status = 'activated'
  order by r.created_at desc
  limit 1;

  if v_run.run_id is not null then
    v_run_status := v_run.status;
    v_content := v_run.content_drift_count;
    v_storage := v_run.storage_unavailable_count;
    v_max_drift := v_run.max_content_drift_per_window;
    v_max_storage := v_run.max_storage_unavailable;
    v_within := v_run.within_budget;
    if v_run.status = 'drift_budget_breach' then
      v_perf := 'breach';
    elsif v_run.within_budget then
      v_perf := 'within_budget';
    else
      v_perf := 'unknown';
    end if;
  else
    select exists (
      select 1 from information_schema.tables t
      where t.table_schema='public'
        and t.table_name='os_docusign_archive_drift_snapshots'
    ) into v_has_snap_table;
    select exists (
      select 1 from information_schema.tables t
      where t.table_schema='public'
        and t.table_name='os_docusign_archive_drift_budgets'
    ) into v_has_budget_table;

    if v_has_snap_table then
      execute
        'select s.content_drift_count, s.storage_unavailable_count '
        || 'from public.os_docusign_archive_drift_snapshots s '
        || 'order by s.created_at desc limit 1'
      into v_content, v_storage;
    end if;
    v_content := coalesce(v_content, 0);
    v_storage := coalesce(v_storage, 0);

    if v_revision.revision_id is not null then
      v_max_drift := v_revision.proposed_max_content_drift;
      v_max_storage := v_revision.proposed_max_storage_unavailable;
      if v_has_budget_table then
        execute
          'select b.budget_id, b.max_content_drift_per_window, b.max_storage_unavailable '
          || 'from public.os_docusign_archive_drift_budgets b '
          || 'where b.status = ''active'' and b.budget_key = $1 '
          || 'order by b.created_at desc limit 1'
        into v_budget_id, v_max_drift, v_max_storage
        using v_revision.budget_key;
      end if;
      if v_content > coalesce(v_max_drift, 0)
         or v_storage > coalesce(v_max_storage, 0) then
        v_perf := 'breach';
        v_within := false;
      else
        v_perf := 'within_budget';
        v_within := true;
      end if;
    end if;
  end if;

  v_key := 'recurrpt:firm:'||v_run_status||':'||v_perf||':'||to_char(now(),'YYYYMMDD"T"HH24');
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase47-v1',
    'kind','recurring_quarterly_report',
    'report_key',v_key,
    'run_id',v_run.run_id,
    'recurring_run_status',v_run_status,
    'drift_performance',v_perf,
    'content_drift_count',v_content,
    'storage_unavailable_count',v_storage,
    'max_content_drift_per_window',v_max_drift,
    'max_storage_unavailable',v_max_storage,
    'within_budget',v_within,
    'arm_id',v_arm.arm_id,
    'revision_id',v_revision.revision_id,
    'metadata',v_meta
  )::text);

  insert into public.os_docusign_archive_recurring_quarterly_reports(
    report_key,run_id,recurring_run_status,drift_performance,
    content_drift_count,storage_unavailable_count,
    max_content_drift_per_window,max_storage_unavailable,
    within_budget,metrics_sha256,metadata)
  values (
    v_key,v_run.run_id,v_run_status,v_perf,
    v_content,v_storage,
    coalesce(v_max_drift,0),coalesce(v_max_storage,0),
    v_within,v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase47-v1',
      'arm_id',v_arm.arm_id,
      'revision_id',v_revision.revision_id
    ))
  on conflict (report_key) do nothing
  returning * into v_row;

  if v_row.report_id is null then
    select * into v_row
    from public.os_docusign_archive_recurring_quarterly_reports
    where report_key = v_key;
    return jsonb_build_object(
      'disposition','unchanged',
      'report_id',v_row.report_id,
      'report_key',v_row.report_key,
      'run_id',v_row.run_id,
      'recurring_run_status',v_row.recurring_run_status,
      'drift_performance',v_row.drift_performance,
      'content_drift_count',v_row.content_drift_count,
      'storage_unavailable_count',v_row.storage_unavailable_count,
      'max_content_drift_per_window',v_row.max_content_drift_per_window,
      'max_storage_unavailable',v_row.max_storage_unavailable,
      'within_budget',v_row.within_budget,
      'metrics_sha256',v_row.metrics_sha256,
      'contract_version','phase47-v1'
    );
  end if;

  return jsonb_build_object(
    'disposition','recorded',
    'report_id',v_row.report_id,
    'report_key',v_row.report_key,
    'run_id',v_row.run_id,
    'recurring_run_status',v_row.recurring_run_status,
    'drift_performance',v_row.drift_performance,
    'content_drift_count',v_row.content_drift_count,
    'storage_unavailable_count',v_row.storage_unavailable_count,
    'max_content_drift_per_window',v_row.max_content_drift_per_window,
    'max_storage_unavailable',v_row.max_storage_unavailable,
    'within_budget',v_row.within_budget,
    'metrics_sha256',v_row.metrics_sha256,
    'contract_version','phase47-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- List critical windows that still need an idempotent ops alert insert
-- ---------------------------------------------------------------------------
create or replace function public.list_docusign_archive_phase47_critical_windows(
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
  v_run public.os_docusign_archive_recurring_quarterly_runs%rowtype;
  v_report public.os_docusign_archive_recurring_quarterly_reports%rowtype;
  v_key text;
begin
  v_bucket := to_char(
    to_timestamp(
      (floor(extract(epoch from now()) / (v_hours * 3600.0))
        * (v_hours * 3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  select * into v_run
  from public.os_docusign_archive_recurring_quarterly_runs
  order by created_at desc
  limit 1;

  select * into v_report
  from public.os_docusign_archive_recurring_quarterly_reports
  order by created_at desc
  limit 1;

  if v_run.run_id is not null and v_run.status = 'blocked' then
    v_key := 'recurblk47:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase47_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','recurring_run_blocked',
        'window_key',v_key,
        'severity','critical',
        'run_id',v_run.run_id,
        'arm_id',v_run.arm_id,
        'block_reason',v_run.block_reason,
        'metrics_sha256',v_run.metrics_sha256
      ));
    end if;
  end if;

  if v_run.run_id is not null and v_run.status = 'drift_budget_breach' then
    v_key := 'driftbreach47:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase47_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','drift_budget_breach_during_quarterly',
        'window_key',v_key,
        'severity','critical',
        'run_id',v_run.run_id,
        'arm_id',v_run.arm_id,
        'content_drift_count',v_run.content_drift_count,
        'storage_unavailable_count',v_run.storage_unavailable_count,
        'max_content_drift_per_window',v_run.max_content_drift_per_window,
        'max_storage_unavailable',v_run.max_storage_unavailable,
        'metrics_sha256',v_run.metrics_sha256
      ));
    end if;
  end if;

  if v_run.run_id is not null and v_run.status = 'completed' then
    v_key := 'recurdone47:firm:first';
    if not exists (
      select 1 from public.os_docusign_archive_phase47_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','first_recurring_completed',
        'window_key',v_key,
        'severity','critical',
        'run_id',v_run.run_id,
        'arm_id',v_run.arm_id,
        'campaign_id',v_run.campaign_id,
        'within_budget',v_run.within_budget,
        'metrics_sha256',v_run.metrics_sha256
      ));
    end if;
  end if;

  if v_report.report_id is not null then
    v_key := 'cadencerpt47:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase47_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','cadence_report_ready',
        'window_key',v_key,
        'severity','critical',
        'report_id',v_report.report_id,
        'run_id',v_report.run_id,
        'recurring_run_status',v_report.recurring_run_status,
        'drift_performance',v_report.drift_performance,
        'metrics_sha256',v_report.metrics_sha256
      ));
    end if;
  end if;

  return jsonb_build_object(
    'version','phase47-v1',
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',v_pending
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record one critical ops alert after delivery attempt (idempotent window_key)
-- ---------------------------------------------------------------------------
create or replace function public.record_docusign_archive_phase47_ops_alert(
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
    raise exception 'Phase 47 ops alert payload must be a JSON object';
  end if;

  v_kind := coalesce(p_alert->>'alert_kind','');
  v_window := coalesce(p_alert->>'window_key','');
  v_dest := coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery := coalesce(p_alert->>'delivery_status','recorded');
  v_code := nullif(p_alert->>'response_code','')::integer;
  v_meta := coalesce(p_alert->'metadata','{}'::jsonb);

  if v_kind not in (
       'recurring_run_blocked',
       'drift_budget_breach_during_quarterly',
       'first_recurring_completed',
       'cadence_report_ready'
     )
     or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
     or v_dest ~* '://|^https?'
     or v_delivery not in
       ('delivered','skipped_no_webhook','failed','recorded')
     or not public.phase47_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 47 ops alert contract is invalid or unsafe';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase47-v1',
    'alert_kind',v_kind,
    'window_key',v_window,
    'severity','critical',
    'destination_key',v_dest,
    'delivery_status',v_delivery,
    'response_code',v_code
  )::text);

  insert into public.os_docusign_archive_phase47_ops_alerts(
    alert_kind,window_key,severity,destination_key,
    delivery_status,response_code,metrics_sha256,metadata)
  values (
    v_kind,v_window,'critical',v_dest,
    v_delivery,v_code,v_hash,
    v_meta || jsonb_build_object('contract_version','phase47-v1'))
  on conflict (window_key) do nothing
  returning alert_id, delivery_status into v_id, v_status;

  if v_id is null then
    select alert_id, delivery_status into v_id, v_status
    from public.os_docusign_archive_phase47_ops_alerts
    where window_key = v_window;
    return jsonb_build_object(
      'version','phase47-v1',
      'alert_id',v_id,
      'window_key',v_window,
      'delivery_status',v_status,
      'inserted',false);
  end if;

  return jsonb_build_object(
    'version','phase47-v1',
    'alert_id',v_id,
    'window_key',v_window,
    'delivery_status',v_status,
    'inserted',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Hub report: recurring run status + drift performance
-- ---------------------------------------------------------------------------
create or replace function public.get_docusign_archive_phase47_ops_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_run public.os_docusign_archive_recurring_quarterly_runs%rowtype;
  v_report public.os_docusign_archive_recurring_quarterly_reports%rowtype;
  v_arm public.os_docusign_archive_recurring_quarterly_arms%rowtype;
  v_revision public.os_docusign_archive_drift_budget_revisions%rowtype;
  v_alerts jsonb;
  v_run_status text := 'none';
  v_drift_perf text := 'unknown';
  v_alert_delivery text := 'none';
  v_critical_open integer := 0;
  v_first_completed boolean := false;
begin
  select * into v_run
  from public.os_docusign_archive_recurring_quarterly_runs
  order by created_at desc
  limit 1;

  select * into v_report
  from public.os_docusign_archive_recurring_quarterly_reports
  order by created_at desc
  limit 1;

  select * into v_arm
  from public.os_docusign_archive_recurring_quarterly_arms a
  where a.status = 'armed'
  order by a.created_at desc
  limit 1;

  select * into v_revision
  from public.os_docusign_archive_drift_budget_revisions r
  where r.status = 'activated'
  order by r.created_at desc
  limit 1;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
  into v_alerts
  from (
    select alert_id, alert_kind, window_key, severity, destination_key,
      delivery_status, response_code, metrics_sha256, created_at
    from public.os_docusign_archive_phase47_ops_alerts
    order by created_at desc
    limit 20
  ) a;

  if v_run.run_id is not null then
    v_run_status := v_run.status;
    if v_run.status = 'completed' then
      v_first_completed := true;
    end if;
  end if;

  if v_report.report_id is not null then
    v_drift_perf := v_report.drift_performance;
  elsif v_run.run_id is not null then
    if v_run.status = 'drift_budget_breach' then
      v_drift_perf := 'breach';
    elsif v_run.within_budget then
      v_drift_perf := 'within_budget';
    else
      v_drift_perf := 'unknown';
    end if;
  end if;

  select count(*)::integer into v_critical_open
  from public.os_docusign_archive_phase47_ops_alerts a
  where a.created_at >= now() - interval '7 days';

  select coalesce((
    select case
      when bool_or(x.delivery_status = 'failed') then 'failed'
      when bool_or(x.delivery_status = 'skipped_no_webhook') then 'skipped_no_webhook'
      when bool_or(x.delivery_status = 'delivered') then 'delivered'
      when bool_or(x.delivery_status = 'recorded') then 'recorded'
      else 'none'
    end
    from public.os_docusign_archive_phase47_ops_alerts x
    where x.created_at >= now() - interval '7 days'
  ), 'none') into v_alert_delivery;

  return jsonb_build_object(
    'version','phase47-v1',
    'recurring_run_status',v_run_status,
    'drift_performance',v_drift_perf,
    'alert_delivery',v_alert_delivery,
    'critical_alert_count',v_critical_open,
    'first_recurring_completed',v_first_completed,
    'recurring_quarterly_armed',v_arm.arm_id is not null,
    'tightened_budget_active',v_revision.revision_id is not null,
    'latest_run', case
      when v_run.run_id is null then null
      else jsonb_build_object(
        'run_id',v_run.run_id,
        'run_key',v_run.run_key,
        'arm_id',v_run.arm_id,
        'campaign_id',v_run.campaign_id,
        'revision_id',v_run.revision_id,
        'budget_id',v_run.budget_id,
        'status',v_run.status,
        'content_drift_count',v_run.content_drift_count,
        'storage_unavailable_count',v_run.storage_unavailable_count,
        'max_content_drift_per_window',v_run.max_content_drift_per_window,
        'max_storage_unavailable',v_run.max_storage_unavailable,
        'within_budget',v_run.within_budget,
        'block_reason',v_run.block_reason,
        'metrics_sha256',v_run.metrics_sha256,
        'created_at',v_run.created_at
      )
    end,
    'latest_report', case
      when v_report.report_id is null then null
      else jsonb_build_object(
        'report_id',v_report.report_id,
        'report_key',v_report.report_key,
        'run_id',v_report.run_id,
        'recurring_run_status',v_report.recurring_run_status,
        'drift_performance',v_report.drift_performance,
        'content_drift_count',v_report.content_drift_count,
        'storage_unavailable_count',v_report.storage_unavailable_count,
        'max_content_drift_per_window',v_report.max_content_drift_per_window,
        'max_storage_unavailable',v_report.max_storage_unavailable,
        'within_budget',v_report.within_budget,
        'metrics_sha256',v_report.metrics_sha256,
        'created_at',v_report.created_at
      )
    end,
    'latest_arm', case
      when v_arm.arm_id is null then null
      else jsonb_build_object(
        'arm_id',v_arm.arm_id,
        'arm_key',v_arm.arm_key,
        'next_due',v_arm.next_due,
        'cadence_months',v_arm.cadence_months,
        'status',v_arm.status,
        'created_at',v_arm.created_at
      )
    end,
    'latest_revision', case
      when v_revision.revision_id is null then null
      else jsonb_build_object(
        'revision_id',v_revision.revision_id,
        'budget_key',v_revision.budget_key,
        'proposed_max_content_drift',v_revision.proposed_max_content_drift,
        'proposed_max_storage_unavailable',v_revision.proposed_max_storage_unavailable,
        'status',v_revision.status,
        'created_at',v_revision.created_at
      )
    end,
    'alerts',coalesce(v_alerts,'[]'::jsonb),
    'destination_key','ops_alerts'
  );
end;
$$;

revoke all on function public.reject_docusign_phase47_ops_mutation()
  from public, anon, authenticated;
revoke all on function public.run_docusign_first_armed_recurring_quarterly_phase47(
  jsonb,boolean)
  from public, anon, authenticated;
revoke all on function public.record_docusign_recurring_quarterly_report_phase47(jsonb)
  from public, anon, authenticated;
revoke all on function public.list_docusign_archive_phase47_critical_windows(integer)
  from public, anon;
revoke all on function public.record_docusign_archive_phase47_ops_alert(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_docusign_archive_phase47_ops_report()
  from public, anon;

grant execute on function public.phase46_docusign_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.phase47_docusign_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.list_docusign_archive_phase47_critical_windows(integer)
  to authenticated, service_role;
grant execute on function public.get_docusign_archive_phase47_ops_report()
  to authenticated, service_role;
grant execute on function public.run_docusign_first_armed_recurring_quarterly_phase47(
  jsonb,boolean)
  to service_role;
grant execute on function public.record_docusign_recurring_quarterly_report_phase47(jsonb)
  to service_role;
grant execute on function public.record_docusign_archive_phase47_ops_alert(jsonb)
  to service_role;
grant execute on function public.os_sha256_hex(text)
  to authenticated, service_role;
