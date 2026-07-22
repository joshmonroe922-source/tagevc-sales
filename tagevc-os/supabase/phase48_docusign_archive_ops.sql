-- Phase 48: DocuSign subsequent recurring quarterly schedules, breach tighten, reporting.
-- Depends on phase47_docusign_archive_ops.sql.
-- Bootstraps Phase 47 tables/helpers if missing so this migration is re-runnable.
-- Schedules and runs subsequent recurring quarterlies; tightens budgets on breaches;
-- improves recurring quarterly execution/performance reporting + alerting.
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

-- Bootstrap Phase 46/47 safe-metadata helpers if prior DocuSign SQL was skipped.
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

create or replace function public.phase48_docusign_ops_safe_metadata(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select public.phase47_docusign_ops_safe_metadata(p_detail);
$$;

-- ---------------------------------------------------------------------------
-- Bootstrap Phase 46/47 arm + first-quarterly + revision targets
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

create or replace function public.reject_docusign_phase46_ops_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Phase 46 DocuSign archive ops evidence is append-only';
end;
$$;

create or replace function public.reject_docusign_phase47_ops_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Phase 47 DocuSign archive ops evidence is append-only';
end;
$$;

drop trigger if exists os_docusign_archive_fq_complete_immutable
  on public.os_docusign_archive_first_quarterly_completion;
create trigger os_docusign_archive_fq_complete_immutable
  before update or delete on public.os_docusign_archive_first_quarterly_completion
  for each row execute function public.reject_docusign_phase46_ops_mutation();
drop trigger if exists os_docusign_archive_recur_arm_immutable
  on public.os_docusign_archive_recurring_quarterly_arms;
create trigger os_docusign_archive_recur_arm_immutable
  before update or delete on public.os_docusign_archive_recurring_quarterly_arms
  for each row execute function public.reject_docusign_phase46_ops_mutation();
drop trigger if exists os_docusign_archive_drift_rev_immutable
  on public.os_docusign_archive_drift_budget_revisions;
create trigger os_docusign_archive_drift_rev_immutable
  before update or delete on public.os_docusign_archive_drift_budget_revisions
  for each row execute function public.reject_docusign_phase46_ops_mutation();
drop trigger if exists os_docusign_archive_recur_run_immutable
  on public.os_docusign_archive_recurring_quarterly_runs;
create trigger os_docusign_archive_recur_run_immutable
  before update or delete on public.os_docusign_archive_recurring_quarterly_runs
  for each row execute function public.reject_docusign_phase47_ops_mutation();
drop trigger if exists os_docusign_archive_recur_rpt_immutable
  on public.os_docusign_archive_recurring_quarterly_reports;
create trigger os_docusign_archive_recur_rpt_immutable
  before update or delete on public.os_docusign_archive_recurring_quarterly_reports
  for each row execute function public.reject_docusign_phase47_ops_mutation();
drop trigger if exists os_docusign_archive_p47_alert_immutable
  on public.os_docusign_archive_phase47_ops_alerts;
create trigger os_docusign_archive_p47_alert_immutable
  before update or delete on public.os_docusign_archive_phase47_ops_alerts
  for each row execute function public.reject_docusign_phase47_ops_mutation();

-- ---------------------------------------------------------------------------
-- Phase 48: subsequent recurring quarterly schedules (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_recurring_quarterly_schedules (
  schedule_id uuid primary key default gen_random_uuid(),
  schedule_key text not null unique
    check (schedule_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  arm_id uuid not null
    references public.os_docusign_archive_recurring_quarterly_arms(arm_id),
  prior_run_id uuid
    references public.os_docusign_archive_recurring_quarterly_runs(run_id),
  due_at timestamptz not null,
  cadence_months integer not null default 3
    check (cadence_months between 1 and 12),
  status text not null
    check (status in ('scheduled','due','completed','blocked')),
  block_reason text,
  metrics_sha256 text not null
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_recur_sched_reason_check
    check (
      (
        status in ('scheduled','due','completed')
        and block_reason is null
      )
      or (
        status = 'blocked'
        and block_reason is not null
        and length(block_reason) between 8 and 500
      )
    ),
  constraint os_docusign_archive_recur_sched_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase48_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_recur_sched_created_idx
  on public.os_docusign_archive_recurring_quarterly_schedules(created_at desc);
create index if not exists os_docusign_archive_recur_sched_status_idx
  on public.os_docusign_archive_recurring_quarterly_schedules(status, due_at);
create index if not exists os_docusign_archive_recur_sched_arm_idx
  on public.os_docusign_archive_recurring_quarterly_schedules(arm_id, created_at desc);

alter table public.os_docusign_archive_recurring_quarterly_schedules
  enable row level security;
drop policy if exists "os_docusign_archive_recur_sched_select"
  on public.os_docusign_archive_recurring_quarterly_schedules;
create policy "os_docusign_archive_recur_sched_select"
  on public.os_docusign_archive_recurring_quarterly_schedules for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_recurring_quarterly_schedules
  from public, anon, authenticated;
grant select on public.os_docusign_archive_recurring_quarterly_schedules
  to authenticated;

-- ---------------------------------------------------------------------------
-- Phase 48: subsequent recurring quarterly run evidence (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_subsequent_quarterly_runs (
  run_id uuid primary key default gen_random_uuid(),
  run_key text not null unique
    check (run_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  schedule_id uuid not null
    references public.os_docusign_archive_recurring_quarterly_schedules(schedule_id),
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
  constraint os_docusign_archive_subseq_run_reason_check
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
  constraint os_docusign_archive_subseq_run_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase48_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_subseq_run_created_idx
  on public.os_docusign_archive_subsequent_quarterly_runs(created_at desc);
create index if not exists os_docusign_archive_subseq_run_status_idx
  on public.os_docusign_archive_subsequent_quarterly_runs(status, created_at desc);
create index if not exists os_docusign_archive_subseq_run_sched_idx
  on public.os_docusign_archive_subsequent_quarterly_runs(schedule_id, created_at desc);

alter table public.os_docusign_archive_subsequent_quarterly_runs
  enable row level security;
drop policy if exists "os_docusign_archive_subseq_run_select"
  on public.os_docusign_archive_subsequent_quarterly_runs;
create policy "os_docusign_archive_subseq_run_select"
  on public.os_docusign_archive_subsequent_quarterly_runs for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_subsequent_quarterly_runs
  from public, anon, authenticated;
grant select on public.os_docusign_archive_subsequent_quarterly_runs
  to authenticated;

-- ---------------------------------------------------------------------------
-- Phase 48: drift breach tighten evidence (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_drift_breach_tighten_events (
  event_id uuid primary key default gen_random_uuid(),
  event_key text not null unique
    check (event_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  breach_run_id uuid,
  subsequent_run_id uuid
    references public.os_docusign_archive_subsequent_quarterly_runs(run_id),
  revision_id uuid,
  budget_key text not null
    check (budget_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  prior_max_content_drift integer not null
    check (prior_max_content_drift >= 0),
  prior_max_storage_unavailable integer not null
    check (prior_max_storage_unavailable >= 0),
  proposed_max_content_drift integer not null
    check (proposed_max_content_drift >= 0),
  proposed_max_storage_unavailable integer not null
    check (proposed_max_storage_unavailable >= 0),
  status text not null
    check (status in ('proposed','activated','blocked','unchanged')),
  block_reason text,
  metrics_sha256 text not null
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_breach_tighten_reason_check
    check (
      (
        status in ('proposed','activated','unchanged')
        and block_reason is null
      )
      or (
        status = 'blocked'
        and block_reason is not null
        and length(block_reason) between 8 and 500
      )
    ),
  constraint os_docusign_archive_breach_tighten_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase48_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_breach_tighten_created_idx
  on public.os_docusign_archive_drift_breach_tighten_events(created_at desc);
create index if not exists os_docusign_archive_breach_tighten_status_idx
  on public.os_docusign_archive_drift_breach_tighten_events(status, created_at desc);

alter table public.os_docusign_archive_drift_breach_tighten_events
  enable row level security;
drop policy if exists "os_docusign_archive_breach_tighten_select"
  on public.os_docusign_archive_drift_breach_tighten_events;
create policy "os_docusign_archive_breach_tighten_select"
  on public.os_docusign_archive_drift_breach_tighten_events for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_drift_breach_tighten_events
  from public, anon, authenticated;
grant select on public.os_docusign_archive_drift_breach_tighten_events
  to authenticated;

-- ---------------------------------------------------------------------------
-- Phase 48: recurring quarterly performance reports (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_recurring_performance_reports (
  report_id uuid primary key default gen_random_uuid(),
  report_key text not null unique
    check (report_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  schedule_id uuid
    references public.os_docusign_archive_recurring_quarterly_schedules(schedule_id),
  subsequent_run_id uuid
    references public.os_docusign_archive_subsequent_quarterly_runs(run_id),
  schedule_status text not null
    check (schedule_status in (
      'none','scheduled','due','completed','blocked'
    )),
  subsequent_run_status text not null
    check (subsequent_run_status in (
      'none','started','completed','blocked','drift_budget_breach'
    )),
  drift_performance text not null
    check (drift_performance in ('unknown','within_budget','breach')),
  breach_tighten_status text not null
    check (breach_tighten_status in (
      'none','proposed','activated','blocked','unchanged'
    )),
  completed_subsequent_count integer not null default 0
    check (completed_subsequent_count >= 0),
  breach_count_30d integer not null default 0
    check (breach_count_30d >= 0),
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
  constraint os_docusign_archive_perf_rpt_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase48_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_perf_rpt_created_idx
  on public.os_docusign_archive_recurring_performance_reports(created_at desc);
create index if not exists os_docusign_archive_perf_rpt_status_idx
  on public.os_docusign_archive_recurring_performance_reports(
    subsequent_run_status, created_at desc
  );

alter table public.os_docusign_archive_recurring_performance_reports
  enable row level security;
drop policy if exists "os_docusign_archive_perf_rpt_select"
  on public.os_docusign_archive_recurring_performance_reports;
create policy "os_docusign_archive_perf_rpt_select"
  on public.os_docusign_archive_recurring_performance_reports for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_recurring_performance_reports
  from public, anon, authenticated;
grant select on public.os_docusign_archive_recurring_performance_reports
  to authenticated;

-- ---------------------------------------------------------------------------
-- Phase 48 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_phase48_ops_alerts (
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
  constraint os_docusign_archive_p48_alert_kind_check
    check (alert_kind in (
      'subsequent_run_blocked',
      'drift_budget_breach',
      'drift_budget_tightened_on_breach',
      'subsequent_run_completed',
      'schedule_due',
      'performance_report_ready'
    )),
  constraint os_docusign_archive_p48_alert_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase48_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_p48_alert_created_idx
  on public.os_docusign_archive_phase48_ops_alerts(created_at desc);
create index if not exists os_docusign_archive_p48_alert_kind_idx
  on public.os_docusign_archive_phase48_ops_alerts(alert_kind, created_at desc);

alter table public.os_docusign_archive_phase48_ops_alerts
  enable row level security;
drop policy if exists "os_docusign_archive_p48_alert_select"
  on public.os_docusign_archive_phase48_ops_alerts;
create policy "os_docusign_archive_p48_alert_select"
  on public.os_docusign_archive_phase48_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_phase48_ops_alerts
  from public, anon, authenticated;
grant select on public.os_docusign_archive_phase48_ops_alerts
  to authenticated;

create or replace function public.reject_docusign_phase48_ops_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Phase 48 DocuSign archive ops evidence is append-only';
end;
$$;

drop trigger if exists os_docusign_archive_recur_sched_immutable
  on public.os_docusign_archive_recurring_quarterly_schedules;
create trigger os_docusign_archive_recur_sched_immutable
  before update or delete on public.os_docusign_archive_recurring_quarterly_schedules
  for each row execute function public.reject_docusign_phase48_ops_mutation();
drop trigger if exists os_docusign_archive_recur_sched_no_truncate
  on public.os_docusign_archive_recurring_quarterly_schedules;
create trigger os_docusign_archive_recur_sched_no_truncate
  before truncate on public.os_docusign_archive_recurring_quarterly_schedules
  for each statement execute function public.reject_docusign_phase48_ops_mutation();

drop trigger if exists os_docusign_archive_subseq_run_immutable
  on public.os_docusign_archive_subsequent_quarterly_runs;
create trigger os_docusign_archive_subseq_run_immutable
  before update or delete on public.os_docusign_archive_subsequent_quarterly_runs
  for each row execute function public.reject_docusign_phase48_ops_mutation();
drop trigger if exists os_docusign_archive_subseq_run_no_truncate
  on public.os_docusign_archive_subsequent_quarterly_runs;
create trigger os_docusign_archive_subseq_run_no_truncate
  before truncate on public.os_docusign_archive_subsequent_quarterly_runs
  for each statement execute function public.reject_docusign_phase48_ops_mutation();

drop trigger if exists os_docusign_archive_breach_tighten_immutable
  on public.os_docusign_archive_drift_breach_tighten_events;
create trigger os_docusign_archive_breach_tighten_immutable
  before update or delete on public.os_docusign_archive_drift_breach_tighten_events
  for each row execute function public.reject_docusign_phase48_ops_mutation();
drop trigger if exists os_docusign_archive_breach_tighten_no_truncate
  on public.os_docusign_archive_drift_breach_tighten_events;
create trigger os_docusign_archive_breach_tighten_no_truncate
  before truncate on public.os_docusign_archive_drift_breach_tighten_events
  for each statement execute function public.reject_docusign_phase48_ops_mutation();

drop trigger if exists os_docusign_archive_perf_rpt_immutable
  on public.os_docusign_archive_recurring_performance_reports;
create trigger os_docusign_archive_perf_rpt_immutable
  before update or delete on public.os_docusign_archive_recurring_performance_reports
  for each row execute function public.reject_docusign_phase48_ops_mutation();
drop trigger if exists os_docusign_archive_perf_rpt_no_truncate
  on public.os_docusign_archive_recurring_performance_reports;
create trigger os_docusign_archive_perf_rpt_no_truncate
  before truncate on public.os_docusign_archive_recurring_performance_reports
  for each statement execute function public.reject_docusign_phase48_ops_mutation();

drop trigger if exists os_docusign_archive_p48_alert_immutable
  on public.os_docusign_archive_phase48_ops_alerts;
create trigger os_docusign_archive_p48_alert_immutable
  before update or delete on public.os_docusign_archive_phase48_ops_alerts
  for each row execute function public.reject_docusign_phase48_ops_mutation();
drop trigger if exists os_docusign_archive_p48_alert_no_truncate
  on public.os_docusign_archive_phase48_ops_alerts;
create trigger os_docusign_archive_p48_alert_no_truncate
  before truncate on public.os_docusign_archive_phase48_ops_alerts
  for each statement execute function public.reject_docusign_phase48_ops_mutation();

-- ---------------------------------------------------------------------------
-- Schedule subsequent recurring quarterly from Phase 47 first-run evidence
-- ---------------------------------------------------------------------------
create or replace function public.schedule_docusign_subsequent_recurring_quarterly_phase48(
  p_metadata jsonb default '{}'::jsonb,
  p_force_due boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_arm public.os_docusign_archive_recurring_quarterly_arms%rowtype;
  v_first public.os_docusign_archive_recurring_quarterly_runs%rowtype;
  v_last_sub public.os_docusign_archive_subsequent_quarterly_runs%rowtype;
  v_open public.os_docusign_archive_recurring_quarterly_schedules%rowtype;
  v_existing public.os_docusign_archive_recurring_quarterly_schedules%rowtype;
  v_prior_run_id uuid;
  v_prior_at timestamptz;
  v_due timestamptz;
  v_months integer := 3;
  v_status text := 'scheduled';
  v_key text;
  v_hash text;
  v_id uuid;
  v_force boolean := coalesce(p_force_due, false);
begin
  if not public.phase48_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 48 schedule metadata is invalid or unsafe';
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
      'contract_version','phase48-v1'
    );
  end if;

  v_months := v_arm.cadence_months;

  select * into v_first
  from public.os_docusign_archive_recurring_quarterly_runs r
  where r.status = 'completed'
    and r.arm_id = v_arm.arm_id
  order by r.created_at desc
  limit 1;

  if v_first.run_id is null then
    return jsonb_build_object(
      'disposition','blocked',
      'status','blocked',
      'arm_id',v_arm.arm_id,
      'block_reason','first_recurring_completed_required',
      'contract_version','phase48-v1'
    );
  end if;

  select * into v_last_sub
  from public.os_docusign_archive_subsequent_quarterly_runs s
  where s.status = 'completed'
    and s.arm_id = v_arm.arm_id
  order by s.created_at desc
  limit 1;

  if v_last_sub.run_id is not null then
    v_prior_run_id := null;
    v_prior_at := v_last_sub.created_at;
  else
    v_prior_run_id := v_first.run_id;
    v_prior_at := v_first.created_at;
  end if;

  -- Append-only: only the latest schedule row for the arm is "open".
  select * into v_open
  from public.os_docusign_archive_recurring_quarterly_schedules s
  where s.arm_id = v_arm.arm_id
  order by s.created_at desc
  limit 1;

  if v_open.schedule_id is not null
     and v_open.status in ('scheduled','due') then
    if v_force or v_open.due_at <= now() then
      if v_open.status = 'due' then
        return jsonb_build_object(
          'disposition','unchanged',
          'schedule_id',v_open.schedule_id,
          'schedule_key',v_open.schedule_key,
          'arm_id',v_open.arm_id,
          'prior_run_id',v_open.prior_run_id,
          'due_at',v_open.due_at,
          'cadence_months',v_open.cadence_months,
          'status','due',
          'metrics_sha256',v_open.metrics_sha256,
          'contract_version','phase48-v1'
        );
      end if;
      -- Append-only: record a due marker row keyed by open schedule.
      v_key := 'recursched:firm:due:'||v_open.schedule_id::text;
      v_hash := public.os_sha256_hex(jsonb_build_object(
        'version','phase48-v1',
        'kind','recurring_quarterly_schedule',
        'schedule_key',v_key,
        'arm_id',v_arm.arm_id,
        'prior_run_id',v_open.prior_run_id,
        'source_schedule_id',v_open.schedule_id,
        'due_at',v_open.due_at,
        'cadence_months',v_months,
        'status','due',
        'metadata',v_meta
      )::text);
      insert into public.os_docusign_archive_recurring_quarterly_schedules(
        schedule_key,arm_id,prior_run_id,due_at,cadence_months,
        status,block_reason,metrics_sha256,metadata)
      values (
        v_key,v_arm.arm_id,v_open.prior_run_id,v_open.due_at,v_months,
        'due',null,v_hash,
        v_meta || jsonb_build_object(
          'contract_version','phase48-v1',
          'source_schedule_id',v_open.schedule_id
        ))
      on conflict (schedule_key) do nothing
      returning schedule_id into v_id;
      if v_id is null then
        select * into v_existing
        from public.os_docusign_archive_recurring_quarterly_schedules
        where schedule_key = v_key;
        return jsonb_build_object(
          'disposition','unchanged',
          'schedule_id',v_existing.schedule_id,
          'schedule_key',v_existing.schedule_key,
          'arm_id',v_existing.arm_id,
          'prior_run_id',v_existing.prior_run_id,
          'due_at',v_existing.due_at,
          'cadence_months',v_existing.cadence_months,
          'status',v_existing.status,
          'metrics_sha256',v_existing.metrics_sha256,
          'contract_version','phase48-v1'
        );
      end if;
      return jsonb_build_object(
        'disposition','due',
        'schedule_id',v_id,
        'schedule_key',v_key,
        'arm_id',v_arm.arm_id,
        'prior_run_id',v_open.prior_run_id,
        'due_at',v_open.due_at,
        'cadence_months',v_months,
        'status','due',
        'source_schedule_id',v_open.schedule_id,
        'metrics_sha256',v_hash,
        'contract_version','phase48-v1'
      );
    end if;
    return jsonb_build_object(
      'disposition','unchanged',
      'schedule_id',v_open.schedule_id,
      'schedule_key',v_open.schedule_key,
      'arm_id',v_open.arm_id,
      'prior_run_id',v_open.prior_run_id,
      'due_at',v_open.due_at,
      'cadence_months',v_open.cadence_months,
      'status',v_open.status,
      'metrics_sha256',v_open.metrics_sha256,
      'contract_version','phase48-v1'
    );
  end if;

  v_due := coalesce(v_prior_at, now()) + make_interval(months => v_months);
  if v_force then
    v_due := now();
  end if;
  if v_due <= now() then
    v_status := 'due';
  else
    v_status := 'scheduled';
  end if;

  v_key := 'recursched:firm:'||to_char(v_due,'YYYY"Q"Q')||':'||v_arm.arm_id::text;
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase48-v1',
    'kind','recurring_quarterly_schedule',
    'schedule_key',v_key,
    'arm_id',v_arm.arm_id,
    'prior_run_id',v_prior_run_id,
    'due_at',v_due,
    'cadence_months',v_months,
    'status',v_status,
    'metadata',v_meta
  )::text);

  insert into public.os_docusign_archive_recurring_quarterly_schedules(
    schedule_key,arm_id,prior_run_id,due_at,cadence_months,
    status,block_reason,metrics_sha256,metadata)
  values (
    v_key,v_arm.arm_id,v_prior_run_id,v_due,v_months,
    v_status,null,v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase48-v1',
      'prior_subsequent_run_id',v_last_sub.run_id,
      'first_completed_run_id',v_first.run_id
    ))
  on conflict (schedule_key) do nothing
  returning schedule_id into v_id;

  if v_id is null then
    select * into v_existing
    from public.os_docusign_archive_recurring_quarterly_schedules
    where schedule_key = v_key;
    return jsonb_build_object(
      'disposition','unchanged',
      'schedule_id',v_existing.schedule_id,
      'schedule_key',v_existing.schedule_key,
      'arm_id',v_existing.arm_id,
      'prior_run_id',v_existing.prior_run_id,
      'due_at',v_existing.due_at,
      'cadence_months',v_existing.cadence_months,
      'status',v_existing.status,
      'metrics_sha256',v_existing.metrics_sha256,
      'contract_version','phase48-v1'
    );
  end if;

  return jsonb_build_object(
    'disposition',v_status,
    'schedule_id',v_id,
    'schedule_key',v_key,
    'arm_id',v_arm.arm_id,
    'prior_run_id',v_prior_run_id,
    'due_at',v_due,
    'cadence_months',v_months,
    'status',v_status,
    'metrics_sha256',v_hash,
    'contract_version','phase48-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Run subsequent recurring quarterly under current tightened drift budgets
-- ---------------------------------------------------------------------------
create or replace function public.run_docusign_subsequent_recurring_quarterly_phase48(
  p_metadata jsonb default '{}'::jsonb,
  p_force boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_force boolean := coalesce(p_force, false);
  v_sched public.os_docusign_archive_recurring_quarterly_schedules%rowtype;
  v_arm public.os_docusign_archive_recurring_quarterly_arms%rowtype;
  v_revision public.os_docusign_archive_drift_budget_revisions%rowtype;
  v_existing public.os_docusign_archive_subsequent_quarterly_runs%rowtype;
  v_budget_id uuid;
  v_max_drift integer := 0;
  v_max_storage integer := 0;
  v_content_drift integer := 0;
  v_storage_unavail integer := 0;
  v_within boolean := false;
  v_breach boolean := false;
  v_key text;
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
  if not public.phase48_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 48 subsequent run metadata is invalid or unsafe';
  end if;

  -- Append-only: act only on the latest schedule row for the firm arm cadence.
  select * into v_sched
  from public.os_docusign_archive_recurring_quarterly_schedules s
  order by s.created_at desc
  limit 1;

  if v_sched.schedule_id is null then
    return jsonb_build_object(
      'disposition','blocked',
      'status','blocked',
      'block_reason','due_subsequent_schedule_required',
      'contract_version','phase48-v1'
    );
  end if;

  if v_sched.status = 'due' then
    null;
  elsif v_force and v_sched.status = 'scheduled' then
    null;
  else
    return jsonb_build_object(
      'disposition','blocked',
      'status','blocked',
      'schedule_id',v_sched.schedule_id,
      'block_reason','due_subsequent_schedule_required',
      'contract_version','phase48-v1'
    );
  end if;

  select * into v_existing
  from public.os_docusign_archive_subsequent_quarterly_runs r
  where r.schedule_id = v_sched.schedule_id
    and r.status = 'completed'
  order by r.created_at desc
  limit 1;

  if v_existing.run_id is not null then
    return jsonb_build_object(
      'disposition','unchanged',
      'run_id',v_existing.run_id,
      'run_key',v_existing.run_key,
      'schedule_id',v_existing.schedule_id,
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
      'contract_version','phase48-v1'
    );
  end if;

  select * into v_arm
  from public.os_docusign_archive_recurring_quarterly_arms a
  where a.arm_id = v_sched.arm_id;

  select * into v_revision
  from public.os_docusign_archive_drift_budget_revisions r
  where r.status = 'activated'
  order by r.created_at desc
  limit 1;

  if v_revision.revision_id is null then
    return jsonb_build_object(
      'disposition','blocked',
      'status','blocked',
      'schedule_id',v_sched.schedule_id,
      'arm_id',v_sched.arm_id,
      'block_reason','active_tightened_budget_required',
      'contract_version','phase48-v1'
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

  v_key := 'subseqrun:firm:'||v_sched.schedule_id::text;

  if v_breach then
    v_status := 'drift_budget_breach';
    v_reason := 'tightened_drift_budget_breached';
    v_key := 'subseqbreach:firm:'||v_sched.schedule_id::text||':'||to_char(now(),'YYYYMMDD');
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase48-v1',
      'kind','subsequent_quarterly_run',
      'run_key',v_key,
      'schedule_id',v_sched.schedule_id,
      'arm_id',v_sched.arm_id,
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

    insert into public.os_docusign_archive_subsequent_quarterly_runs(
      run_key,schedule_id,arm_id,campaign_id,revision_id,budget_id,status,
      content_drift_count,storage_unavailable_count,
      max_content_drift_per_window,max_storage_unavailable,
      within_budget,block_reason,metrics_sha256,metadata)
    values (
      v_key,v_sched.schedule_id,v_sched.arm_id,null,v_revision.revision_id,v_budget_id,v_status,
      v_content_drift,v_storage_unavail,
      v_max_drift,v_max_storage,
      false,v_reason,v_hash,
      v_meta || jsonb_build_object('contract_version','phase48-v1'))
    on conflict (run_key) do nothing
    returning run_id into v_id;

    if v_id is null then
      select * into v_existing
      from public.os_docusign_archive_subsequent_quarterly_runs
      where run_key = v_key;
      return jsonb_build_object(
        'disposition','unchanged',
        'run_id',v_existing.run_id,
        'run_key',v_existing.run_key,
        'schedule_id',v_existing.schedule_id,
        'status',v_existing.status,
        'block_reason',v_existing.block_reason,
        'within_budget',v_existing.within_budget,
        'metrics_sha256',v_existing.metrics_sha256,
        'contract_version','phase48-v1'
      );
    end if;

    return jsonb_build_object(
      'disposition','drift_budget_breach',
      'run_id',v_id,
      'run_key',v_key,
      'schedule_id',v_sched.schedule_id,
      'arm_id',v_sched.arm_id,
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
      'contract_version','phase48-v1'
    );
  end if;

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
        coalesce(v_force, true)
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
    v_key := 'subseqblocked:firm:'||v_sched.schedule_id::text||':'||to_char(now(),'YYYYMMDD');
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase48-v1',
      'kind','subsequent_quarterly_run',
      'run_key',v_key,
      'schedule_id',v_sched.schedule_id,
      'arm_id',v_sched.arm_id,
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

    insert into public.os_docusign_archive_subsequent_quarterly_runs(
      run_key,schedule_id,arm_id,campaign_id,revision_id,budget_id,status,
      content_drift_count,storage_unavailable_count,
      max_content_drift_per_window,max_storage_unavailable,
      within_budget,block_reason,metrics_sha256,metadata)
    values (
      v_key,v_sched.schedule_id,v_sched.arm_id,v_campaign_id,v_revision.revision_id,v_budget_id,v_status,
      v_content_drift,v_storage_unavail,
      v_max_drift,v_max_storage,
      v_within,v_reason,v_hash,
      v_meta || jsonb_build_object(
        'contract_version','phase48-v1',
        'campaign_disposition',v_campaign_disposition
      ))
    on conflict (run_key) do nothing
    returning run_id into v_id;

    if v_id is null then
      select * into v_existing
      from public.os_docusign_archive_subsequent_quarterly_runs
      where run_key = v_key;
      return jsonb_build_object(
        'disposition','blocked',
        'run_id',v_existing.run_id,
        'schedule_id',v_existing.schedule_id,
        'status','blocked',
        'block_reason',v_existing.block_reason,
        'metrics_sha256',v_existing.metrics_sha256,
        'contract_version','phase48-v1'
      );
    end if;

    return jsonb_build_object(
      'disposition','blocked',
      'run_id',v_id,
      'run_key',v_key,
      'schedule_id',v_sched.schedule_id,
      'arm_id',v_sched.arm_id,
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
      'contract_version','phase48-v1'
    );
  end if;

  if v_campaign_disposition = 'gated' then
    v_status := 'blocked';
    v_reason := coalesce(nullif(v_campaign->>'gate_reason',''), 'quarterly_campaign_gated');
    if length(v_reason) < 8 then
      v_reason := 'quarterly_campaign_gated';
    end if;
    v_key := 'subseqblocked:firm:gated:'||v_sched.schedule_id::text||':'||to_char(now(),'YYYYMMDD');
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase48-v1',
      'kind','subsequent_quarterly_run',
      'run_key',v_key,
      'schedule_id',v_sched.schedule_id,
      'arm_id',v_sched.arm_id,
      'campaign_id',v_campaign_id,
      'revision_id',v_revision.revision_id,
      'budget_id',v_budget_id,
      'status',v_status,
      'block_reason',v_reason,
      'metadata',v_meta
    )::text);

    insert into public.os_docusign_archive_subsequent_quarterly_runs(
      run_key,schedule_id,arm_id,campaign_id,revision_id,budget_id,status,
      content_drift_count,storage_unavailable_count,
      max_content_drift_per_window,max_storage_unavailable,
      within_budget,block_reason,metrics_sha256,metadata)
    values (
      v_key,v_sched.schedule_id,v_sched.arm_id,v_campaign_id,v_revision.revision_id,v_budget_id,v_status,
      v_content_drift,v_storage_unavail,
      v_max_drift,v_max_storage,
      v_within,v_reason,v_hash,
      v_meta || jsonb_build_object('contract_version','phase48-v1'))
    on conflict (run_key) do nothing
    returning run_id into v_id;

    if v_id is null then
      select * into v_existing
      from public.os_docusign_archive_subsequent_quarterly_runs
      where run_key = v_key;
      return jsonb_build_object(
        'disposition','blocked',
        'run_id',v_existing.run_id,
        'status','blocked',
        'block_reason',v_existing.block_reason,
        'metrics_sha256',v_existing.metrics_sha256,
        'contract_version','phase48-v1'
      );
    end if;

    return jsonb_build_object(
      'disposition','blocked',
      'run_id',v_id,
      'run_key',v_key,
      'schedule_id',v_sched.schedule_id,
      'arm_id',v_sched.arm_id,
      'campaign_id',v_campaign_id,
      'status','blocked',
      'block_reason',v_reason,
      'within_budget',v_within,
      'metrics_sha256',v_hash,
      'contract_version','phase48-v1'
    );
  end if;

  v_status := 'completed';
  v_reason := null;
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase48-v1',
    'kind','subsequent_quarterly_run',
    'run_key',v_key,
    'schedule_id',v_sched.schedule_id,
    'arm_id',v_sched.arm_id,
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

  insert into public.os_docusign_archive_subsequent_quarterly_runs(
    run_key,schedule_id,arm_id,campaign_id,revision_id,budget_id,status,
    content_drift_count,storage_unavailable_count,
    max_content_drift_per_window,max_storage_unavailable,
    within_budget,block_reason,metrics_sha256,metadata)
  values (
    v_key,v_sched.schedule_id,v_sched.arm_id,v_campaign_id,v_revision.revision_id,v_budget_id,v_status,
    v_content_drift,v_storage_unavail,
    v_max_drift,v_max_storage,
    v_within,v_reason,v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase48-v1',
      'campaign_disposition',v_campaign_disposition
    ))
  on conflict (run_key) do nothing
  returning run_id into v_id;

  if v_id is null then
    select * into v_existing
    from public.os_docusign_archive_subsequent_quarterly_runs
    where run_key = v_key;
    return jsonb_build_object(
      'disposition','unchanged',
      'run_id',v_existing.run_id,
      'run_key',v_existing.run_key,
      'schedule_id',v_existing.schedule_id,
      'status',v_existing.status,
      'within_budget',v_existing.within_budget,
      'metrics_sha256',v_existing.metrics_sha256,
      'contract_version','phase48-v1'
    );
  end if;

  -- Append-only completed schedule marker (does not mutate prior schedule rows).
  insert into public.os_docusign_archive_recurring_quarterly_schedules(
    schedule_key,arm_id,prior_run_id,due_at,cadence_months,
    status,block_reason,metrics_sha256,metadata)
  values (
    'recursched:firm:done:'||v_sched.schedule_id::text,
    v_sched.arm_id,v_sched.prior_run_id,v_sched.due_at,v_sched.cadence_months,
    'completed',null,
    public.os_sha256_hex(jsonb_build_object(
      'version','phase48-v1',
      'kind','recurring_quarterly_schedule',
      'source_schedule_id',v_sched.schedule_id,
      'subsequent_run_id',v_id,
      'status','completed'
    )::text),
    v_meta || jsonb_build_object(
      'contract_version','phase48-v1',
      'source_schedule_id',v_sched.schedule_id,
      'subsequent_run_id',v_id
    ))
  on conflict (schedule_key) do nothing;

  return jsonb_build_object(
    'disposition','completed',
    'run_id',v_id,
    'run_key',v_key,
    'schedule_id',v_sched.schedule_id,
    'arm_id',v_sched.arm_id,
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
    'contract_version','phase48-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Tighten drift budgets when breach rates stay elevated
-- ---------------------------------------------------------------------------
create or replace function public.tighten_docusign_drift_budget_on_breach_phase48(
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
  v_revision public.os_docusign_archive_drift_budget_revisions%rowtype;
  v_breach_sub public.os_docusign_archive_subsequent_quarterly_runs%rowtype;
  v_breach_first public.os_docusign_archive_recurring_quarterly_runs%rowtype;
  v_existing public.os_docusign_archive_drift_breach_tighten_events%rowtype;
  v_breach_count integer := 0;
  v_prior_drift integer;
  v_prior_storage integer;
  v_prop_drift integer;
  v_prop_storage integer;
  v_window_days integer := 30;
  v_budget_key text := 'firm_signed_archives';
  v_key text;
  v_hash text;
  v_id uuid;
  v_status text;
  v_reason text;
  v_revision_id uuid;
  v_has_upsert boolean := false;
  v_budget jsonb;
  v_sub_id uuid;
  v_first_id uuid;
begin
  if not public.phase48_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 48 breach tighten metadata is invalid or unsafe';
  end if;

  select count(*)::integer into v_breach_count
  from (
    select r.run_id
    from public.os_docusign_archive_subsequent_quarterly_runs r
    where r.status = 'drift_budget_breach'
      and r.created_at >= now() - make_interval(days => v_days)
    union all
    select r.run_id
    from public.os_docusign_archive_recurring_quarterly_runs r
    where r.status = 'drift_budget_breach'
      and r.created_at >= now() - make_interval(days => v_days)
  ) b;

  select * into v_breach_sub
  from public.os_docusign_archive_subsequent_quarterly_runs r
  where r.status = 'drift_budget_breach'
  order by r.created_at desc
  limit 1;

  select * into v_breach_first
  from public.os_docusign_archive_recurring_quarterly_runs r
  where r.status = 'drift_budget_breach'
  order by r.created_at desc
  limit 1;

  if v_breach_sub.run_id is not null then
    v_sub_id := v_breach_sub.run_id;
  end if;
  if v_breach_first.run_id is not null then
    v_first_id := v_breach_first.run_id;
  end if;

  if v_breach_count < 1 then
    return jsonb_build_object(
      'disposition','unchanged',
      'status','unchanged',
      'breach_count',0,
      'lookback_days',v_days,
      'block_reason',null,
      'contract_version','phase48-v1'
    );
  end if;

  select * into v_revision
  from public.os_docusign_archive_drift_budget_revisions r
  where r.status = 'activated'
  order by r.created_at desc
  limit 1;

  if v_revision.revision_id is null then
    v_key := 'breachtighten:firm:blocked:no_revision:'||to_char(now(),'YYYYMMDD');
    v_reason := 'active_tightened_budget_required';
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase48-v1',
      'kind','drift_breach_tighten',
      'event_key',v_key,
      'status','blocked',
      'block_reason',v_reason,
      'breach_count',v_breach_count,
      'metadata',v_meta
    )::text);
    insert into public.os_docusign_archive_drift_breach_tighten_events(
      event_key,breach_run_id,subsequent_run_id,revision_id,budget_key,
      prior_max_content_drift,prior_max_storage_unavailable,
      proposed_max_content_drift,proposed_max_storage_unavailable,
      status,block_reason,metrics_sha256,metadata)
    values (
      v_key,v_first_id,v_sub_id,null,v_budget_key,
      0,0,0,0,
      'blocked',v_reason,v_hash,
      v_meta || jsonb_build_object(
        'contract_version','phase48-v1',
        'breach_count',v_breach_count
      ))
    on conflict (event_key) do nothing
    returning event_id into v_id;
    return jsonb_build_object(
      'disposition','blocked',
      'status','blocked',
      'block_reason',v_reason,
      'breach_count',v_breach_count,
      'event_id',v_id,
      'contract_version','phase48-v1'
    );
  end if;

  v_budget_key := v_revision.budget_key;
  v_prior_drift := v_revision.proposed_max_content_drift;
  v_prior_storage := v_revision.proposed_max_storage_unavailable;
  v_window_days := v_revision.window_days;

  -- Tighten at least one dimension by 1 (floor at 0).
  v_prop_drift := greatest(v_prior_drift - 1, 0);
  v_prop_storage := v_prior_storage;
  if v_prop_drift = v_prior_drift then
    v_prop_storage := greatest(v_prior_storage - 1, 0);
  end if;

  if v_prop_drift >= v_prior_drift
     and v_prop_storage >= v_prior_storage then
    v_key := 'breachtighten:firm:blocked:floor:'||v_budget_key||':'||to_char(now(),'YYYYMMDD');
    v_reason := 'budget_already_at_zero_floor';
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase48-v1',
      'kind','drift_breach_tighten',
      'event_key',v_key,
      'budget_key',v_budget_key,
      'status','blocked',
      'block_reason',v_reason,
      'prior_max_content_drift',v_prior_drift,
      'prior_max_storage_unavailable',v_prior_storage,
      'breach_count',v_breach_count,
      'metadata',v_meta
    )::text);
    insert into public.os_docusign_archive_drift_breach_tighten_events(
      event_key,breach_run_id,subsequent_run_id,revision_id,budget_key,
      prior_max_content_drift,prior_max_storage_unavailable,
      proposed_max_content_drift,proposed_max_storage_unavailable,
      status,block_reason,metrics_sha256,metadata)
    values (
      v_key,v_first_id,v_sub_id,v_revision.revision_id,v_budget_key,
      v_prior_drift,v_prior_storage,v_prop_drift,v_prop_storage,
      'blocked',v_reason,v_hash,
      v_meta || jsonb_build_object(
        'contract_version','phase48-v1',
        'breach_count',v_breach_count
      ))
    on conflict (event_key) do nothing
    returning event_id into v_id;
    return jsonb_build_object(
      'disposition','blocked',
      'status','blocked',
      'block_reason',v_reason,
      'breach_count',v_breach_count,
      'prior_max_content_drift',v_prior_drift,
      'prior_max_storage_unavailable',v_prior_storage,
      'event_id',v_id,
      'contract_version','phase48-v1'
    );
  end if;

  v_key := 'breachtighten:firm:'||v_budget_key||':'||v_prop_drift::text||':'||v_prop_storage::text;
  select * into v_existing
  from public.os_docusign_archive_drift_breach_tighten_events e
  where e.event_key = v_key
    and e.status in ('proposed','activated')
  order by e.created_at desc
  limit 1;

  if v_existing.event_id is not null then
    return jsonb_build_object(
      'disposition','unchanged',
      'event_id',v_existing.event_id,
      'event_key',v_existing.event_key,
      'revision_id',v_existing.revision_id,
      'budget_key',v_existing.budget_key,
      'status',v_existing.status,
      'prior_max_content_drift',v_existing.prior_max_content_drift,
      'prior_max_storage_unavailable',v_existing.prior_max_storage_unavailable,
      'proposed_max_content_drift',v_existing.proposed_max_content_drift,
      'proposed_max_storage_unavailable',v_existing.proposed_max_storage_unavailable,
      'breach_count',v_breach_count,
      'metrics_sha256',v_existing.metrics_sha256,
      'contract_version','phase48-v1'
    );
  end if;

  -- Append proposed revision evidence (append-only revisions table).
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase48-v1',
    'kind','drift_budget_revision',
    'budget_key',v_budget_key,
    'prior_max_content_drift',v_prior_drift,
    'prior_max_storage_unavailable',v_prior_storage,
    'proposed_max_content_drift',v_prop_drift,
    'proposed_max_storage_unavailable',v_prop_storage,
    'window_days',v_window_days,
    'status','proposed',
    'source','breach_tighten_phase48',
    'metadata',v_meta
  )::text);

  insert into public.os_docusign_archive_drift_budget_revisions(
    budget_key,baseline_snapshot_id,
    prior_max_content_drift,prior_max_storage_unavailable,
    proposed_max_content_drift,proposed_max_storage_unavailable,
    window_days,status,metrics_sha256,metadata)
  values (
    v_budget_key,v_revision.baseline_snapshot_id,
    v_prior_drift,v_prior_storage,
    v_prop_drift,v_prop_storage,
    v_window_days,'proposed',v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase48-v1',
      'source','breach_tighten_phase48',
      'source_revision_id',v_revision.revision_id,
      'breach_count',v_breach_count
    ))
  returning revision_id into v_revision_id;

  v_status := 'proposed';

  select exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'upsert_docusign_archive_drift_budget_phase45'
  ) into v_has_upsert;

  if v_has_upsert then
    begin
      v_budget := public.upsert_docusign_archive_drift_budget_phase45(
        v_budget_key,
        v_prop_drift,
        v_prop_storage,
        v_window_days,
        'active',
        v_meta || jsonb_build_object(
          'contract_version','phase48-v1',
          'breach_tighten',true,
          'proposed_revision_id',v_revision_id
        )
      );
      v_hash := public.os_sha256_hex(jsonb_build_object(
        'version','phase48-v1',
        'kind','drift_budget_revision',
        'budget_key',v_budget_key,
        'prior_max_content_drift',v_prior_drift,
        'prior_max_storage_unavailable',v_prior_storage,
        'proposed_max_content_drift',v_prop_drift,
        'proposed_max_storage_unavailable',v_prop_storage,
        'window_days',v_window_days,
        'status','activated',
        'source_revision_id',v_revision_id,
        'activated_budget_id',v_budget->>'budget_id',
        'metadata',v_meta
      )::text);
      insert into public.os_docusign_archive_drift_budget_revisions(
        budget_key,baseline_snapshot_id,
        prior_max_content_drift,prior_max_storage_unavailable,
        proposed_max_content_drift,proposed_max_storage_unavailable,
        window_days,status,metrics_sha256,metadata)
      values (
        v_budget_key,v_revision.baseline_snapshot_id,
        v_prior_drift,v_prior_storage,
        v_prop_drift,v_prop_storage,
        v_window_days,'activated',v_hash,
        v_meta || jsonb_build_object(
          'contract_version','phase48-v1',
          'source','breach_tighten_phase48',
          'source_revision_id',v_revision_id,
          'activated_budget_id',v_budget->>'budget_id'
        ))
      returning revision_id into v_revision_id;
      v_status := 'activated';
    exception when others then
      v_status := 'proposed';
    end;
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase48-v1',
    'kind','drift_breach_tighten',
    'event_key',v_key,
    'budget_key',v_budget_key,
    'revision_id',v_revision_id,
    'prior_max_content_drift',v_prior_drift,
    'prior_max_storage_unavailable',v_prior_storage,
    'proposed_max_content_drift',v_prop_drift,
    'proposed_max_storage_unavailable',v_prop_storage,
    'status',v_status,
    'breach_count',v_breach_count,
    'metadata',v_meta
  )::text);

  insert into public.os_docusign_archive_drift_breach_tighten_events(
    event_key,breach_run_id,subsequent_run_id,revision_id,budget_key,
    prior_max_content_drift,prior_max_storage_unavailable,
    proposed_max_content_drift,proposed_max_storage_unavailable,
    status,block_reason,metrics_sha256,metadata)
  values (
    v_key,v_first_id,v_sub_id,v_revision_id,v_budget_key,
    v_prior_drift,v_prior_storage,v_prop_drift,v_prop_storage,
    v_status,null,v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase48-v1',
      'breach_count',v_breach_count,
      'lookback_days',v_days
    ))
  on conflict (event_key) do nothing
  returning event_id into v_id;

  if v_id is null then
    select * into v_existing
    from public.os_docusign_archive_drift_breach_tighten_events
    where event_key = v_key;
    return jsonb_build_object(
      'disposition','unchanged',
      'event_id',v_existing.event_id,
      'event_key',v_existing.event_key,
      'status',v_existing.status,
      'revision_id',v_existing.revision_id,
      'metrics_sha256',v_existing.metrics_sha256,
      'contract_version','phase48-v1'
    );
  end if;

  return jsonb_build_object(
    'disposition',v_status,
    'event_id',v_id,
    'event_key',v_key,
    'revision_id',v_revision_id,
    'budget_key',v_budget_key,
    'status',v_status,
    'prior_max_content_drift',v_prior_drift,
    'prior_max_storage_unavailable',v_prior_storage,
    'proposed_max_content_drift',v_prop_drift,
    'proposed_max_storage_unavailable',v_prop_storage,
    'breach_count',v_breach_count,
    'lookback_days',v_days,
    'metrics_sha256',v_hash,
    'contract_version','phase48-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record recurring quarterly execution/performance report for hub
-- ---------------------------------------------------------------------------
create or replace function public.record_docusign_recurring_performance_report_phase48(
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_sched public.os_docusign_archive_recurring_quarterly_schedules%rowtype;
  v_run public.os_docusign_archive_subsequent_quarterly_runs%rowtype;
  v_tighten public.os_docusign_archive_drift_breach_tighten_events%rowtype;
  v_sched_status text := 'none';
  v_run_status text := 'none';
  v_perf text := 'unknown';
  v_tighten_status text := 'none';
  v_completed integer := 0;
  v_breaches integer := 0;
  v_content integer := 0;
  v_storage integer := 0;
  v_max_drift integer := 0;
  v_max_storage integer := 0;
  v_within boolean := false;
  v_key text;
  v_hash text;
  v_row public.os_docusign_archive_recurring_performance_reports%rowtype;
begin
  if not public.phase48_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 48 performance report metadata is invalid or unsafe';
  end if;

  select * into v_sched
  from public.os_docusign_archive_recurring_quarterly_schedules
  order by created_at desc
  limit 1;

  select * into v_run
  from public.os_docusign_archive_subsequent_quarterly_runs
  order by created_at desc
  limit 1;

  select * into v_tighten
  from public.os_docusign_archive_drift_breach_tighten_events
  order by created_at desc
  limit 1;

  if v_sched.schedule_id is not null then
    v_sched_status := v_sched.status;
  end if;

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
  end if;

  if v_tighten.event_id is not null then
    v_tighten_status := v_tighten.status;
  end if;

  select count(*)::integer into v_completed
  from public.os_docusign_archive_subsequent_quarterly_runs r
  where r.status = 'completed';

  select count(*)::integer into v_breaches
  from (
    select r.run_id
    from public.os_docusign_archive_subsequent_quarterly_runs r
    where r.status = 'drift_budget_breach'
      and r.created_at >= now() - interval '30 days'
    union all
    select r.run_id
    from public.os_docusign_archive_recurring_quarterly_runs r
    where r.status = 'drift_budget_breach'
      and r.created_at >= now() - interval '30 days'
  ) x;

  v_key := 'perfrpt:firm:'||v_sched_status||':'||v_run_status||':'||v_perf||':'||to_char(now(),'YYYYMMDD"T"HH24');
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase48-v1',
    'kind','recurring_performance_report',
    'report_key',v_key,
    'schedule_id',v_sched.schedule_id,
    'subsequent_run_id',v_run.run_id,
    'schedule_status',v_sched_status,
    'subsequent_run_status',v_run_status,
    'drift_performance',v_perf,
    'breach_tighten_status',v_tighten_status,
    'completed_subsequent_count',v_completed,
    'breach_count_30d',v_breaches,
    'content_drift_count',v_content,
    'storage_unavailable_count',v_storage,
    'max_content_drift_per_window',v_max_drift,
    'max_storage_unavailable',v_max_storage,
    'within_budget',v_within,
    'metadata',v_meta
  )::text);

  insert into public.os_docusign_archive_recurring_performance_reports(
    report_key,schedule_id,subsequent_run_id,
    schedule_status,subsequent_run_status,drift_performance,breach_tighten_status,
    completed_subsequent_count,breach_count_30d,
    content_drift_count,storage_unavailable_count,
    max_content_drift_per_window,max_storage_unavailable,
    within_budget,metrics_sha256,metadata)
  values (
    v_key,v_sched.schedule_id,v_run.run_id,
    v_sched_status,v_run_status,v_perf,v_tighten_status,
    v_completed,v_breaches,
    v_content,v_storage,
    coalesce(v_max_drift,0),coalesce(v_max_storage,0),
    v_within,v_hash,
    v_meta || jsonb_build_object('contract_version','phase48-v1'))
  on conflict (report_key) do nothing
  returning * into v_row;

  if v_row.report_id is null then
    select * into v_row
    from public.os_docusign_archive_recurring_performance_reports
    where report_key = v_key;
    return jsonb_build_object(
      'disposition','unchanged',
      'report_id',v_row.report_id,
      'report_key',v_row.report_key,
      'schedule_id',v_row.schedule_id,
      'subsequent_run_id',v_row.subsequent_run_id,
      'schedule_status',v_row.schedule_status,
      'subsequent_run_status',v_row.subsequent_run_status,
      'drift_performance',v_row.drift_performance,
      'breach_tighten_status',v_row.breach_tighten_status,
      'completed_subsequent_count',v_row.completed_subsequent_count,
      'breach_count_30d',v_row.breach_count_30d,
      'within_budget',v_row.within_budget,
      'metrics_sha256',v_row.metrics_sha256,
      'contract_version','phase48-v1'
    );
  end if;

  return jsonb_build_object(
    'disposition','recorded',
    'report_id',v_row.report_id,
    'report_key',v_row.report_key,
    'schedule_id',v_row.schedule_id,
    'subsequent_run_id',v_row.subsequent_run_id,
    'schedule_status',v_row.schedule_status,
    'subsequent_run_status',v_row.subsequent_run_status,
    'drift_performance',v_row.drift_performance,
    'breach_tighten_status',v_row.breach_tighten_status,
    'completed_subsequent_count',v_row.completed_subsequent_count,
    'breach_count_30d',v_row.breach_count_30d,
    'content_drift_count',v_row.content_drift_count,
    'storage_unavailable_count',v_row.storage_unavailable_count,
    'max_content_drift_per_window',v_row.max_content_drift_per_window,
    'max_storage_unavailable',v_row.max_storage_unavailable,
    'within_budget',v_row.within_budget,
    'metrics_sha256',v_row.metrics_sha256,
    'contract_version','phase48-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- List critical windows that still need an idempotent ops alert insert
-- ---------------------------------------------------------------------------
create or replace function public.list_docusign_archive_phase48_critical_windows(
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
  v_sched public.os_docusign_archive_recurring_quarterly_schedules%rowtype;
  v_run public.os_docusign_archive_subsequent_quarterly_runs%rowtype;
  v_tighten public.os_docusign_archive_drift_breach_tighten_events%rowtype;
  v_report public.os_docusign_archive_recurring_performance_reports%rowtype;
  v_key text;
begin
  v_bucket := to_char(
    to_timestamp(
      (floor(extract(epoch from now()) / (v_hours * 3600.0))
        * (v_hours * 3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  select * into v_sched
  from public.os_docusign_archive_recurring_quarterly_schedules
  order by created_at desc
  limit 1;

  select * into v_run
  from public.os_docusign_archive_subsequent_quarterly_runs
  order by created_at desc
  limit 1;

  select * into v_tighten
  from public.os_docusign_archive_drift_breach_tighten_events
  order by created_at desc
  limit 1;

  select * into v_report
  from public.os_docusign_archive_recurring_performance_reports
  order by created_at desc
  limit 1;

  if v_sched.schedule_id is not null and v_sched.status = 'due' then
    v_key := 'scheddue48:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase48_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','schedule_due',
        'window_key',v_key,
        'severity','critical',
        'schedule_id',v_sched.schedule_id,
        'arm_id',v_sched.arm_id,
        'due_at',v_sched.due_at,
        'metrics_sha256',v_sched.metrics_sha256
      ));
    end if;
  end if;

  if v_run.run_id is not null and v_run.status = 'blocked' then
    v_key := 'subseqblk48:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase48_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','subsequent_run_blocked',
        'window_key',v_key,
        'severity','critical',
        'run_id',v_run.run_id,
        'schedule_id',v_run.schedule_id,
        'arm_id',v_run.arm_id,
        'block_reason',v_run.block_reason,
        'metrics_sha256',v_run.metrics_sha256
      ));
    end if;
  end if;

  if v_run.run_id is not null and v_run.status = 'drift_budget_breach' then
    v_key := 'driftbreach48:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase48_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','drift_budget_breach',
        'window_key',v_key,
        'severity','critical',
        'run_id',v_run.run_id,
        'schedule_id',v_run.schedule_id,
        'arm_id',v_run.arm_id,
        'content_drift_count',v_run.content_drift_count,
        'storage_unavailable_count',v_run.storage_unavailable_count,
        'max_content_drift_per_window',v_run.max_content_drift_per_window,
        'max_storage_unavailable',v_run.max_storage_unavailable,
        'metrics_sha256',v_run.metrics_sha256
      ));
    end if;
  end if;

  if v_tighten.event_id is not null
     and v_tighten.status in ('proposed','activated') then
    v_key := 'breachtighten48:firm:'||v_tighten.event_key;
    if length(v_key) > 200 then
      v_key := 'breachtighten48:firm:'||v_bucket||'h'||v_hours::text;
    end if;
    if not exists (
      select 1 from public.os_docusign_archive_phase48_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','drift_budget_tightened_on_breach',
        'window_key',v_key,
        'severity','critical',
        'event_id',v_tighten.event_id,
        'revision_id',v_tighten.revision_id,
        'budget_key',v_tighten.budget_key,
        'status',v_tighten.status,
        'metrics_sha256',v_tighten.metrics_sha256
      ));
    end if;
  end if;

  if v_run.run_id is not null and v_run.status = 'completed' then
    v_key := 'subseqdone48:firm:'||v_run.run_id::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase48_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','subsequent_run_completed',
        'window_key',v_key,
        'severity','critical',
        'run_id',v_run.run_id,
        'schedule_id',v_run.schedule_id,
        'arm_id',v_run.arm_id,
        'within_budget',v_run.within_budget,
        'metrics_sha256',v_run.metrics_sha256
      ));
    end if;
  end if;

  if v_report.report_id is not null then
    v_key := 'perfrpt48:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase48_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','performance_report_ready',
        'window_key',v_key,
        'severity','critical',
        'report_id',v_report.report_id,
        'schedule_id',v_report.schedule_id,
        'subsequent_run_id',v_report.subsequent_run_id,
        'schedule_status',v_report.schedule_status,
        'subsequent_run_status',v_report.subsequent_run_status,
        'drift_performance',v_report.drift_performance,
        'metrics_sha256',v_report.metrics_sha256
      ));
    end if;
  end if;

  return jsonb_build_object(
    'version','phase48-v1',
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',v_pending
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record one critical ops alert after delivery attempt (idempotent window_key)
-- ---------------------------------------------------------------------------
create or replace function public.record_docusign_archive_phase48_ops_alert(
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
    raise exception 'Phase 48 ops alert payload must be a JSON object';
  end if;

  v_kind := coalesce(p_alert->>'alert_kind','');
  v_window := coalesce(p_alert->>'window_key','');
  v_dest := coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery := coalesce(p_alert->>'delivery_status','recorded');
  v_code := nullif(p_alert->>'response_code','')::integer;
  v_meta := coalesce(p_alert->'metadata','{}'::jsonb);

  if v_kind not in (
       'subsequent_run_blocked',
       'drift_budget_breach',
       'drift_budget_tightened_on_breach',
       'subsequent_run_completed',
       'schedule_due',
       'performance_report_ready'
     )
     or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
     or v_dest ~* '://|^https?'
     or v_delivery not in
       ('delivered','skipped_no_webhook','failed','recorded')
     or not public.phase48_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 48 ops alert contract is invalid or unsafe';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase48-v1',
    'alert_kind',v_kind,
    'window_key',v_window,
    'severity','critical',
    'destination_key',v_dest,
    'delivery_status',v_delivery,
    'response_code',v_code
  )::text);

  insert into public.os_docusign_archive_phase48_ops_alerts(
    alert_kind,window_key,severity,destination_key,
    delivery_status,response_code,metrics_sha256,metadata)
  values (
    v_kind,v_window,'critical',v_dest,
    v_delivery,v_code,v_hash,
    v_meta || jsonb_build_object('contract_version','phase48-v1'))
  on conflict (window_key) do nothing
  returning alert_id, delivery_status into v_id, v_status;

  if v_id is null then
    select alert_id, delivery_status into v_id, v_status
    from public.os_docusign_archive_phase48_ops_alerts
    where window_key = v_window;
    return jsonb_build_object(
      'version','phase48-v1',
      'alert_id',v_id,
      'window_key',v_window,
      'delivery_status',v_status,
      'inserted',false);
  end if;

  return jsonb_build_object(
    'version','phase48-v1',
    'alert_id',v_id,
    'window_key',v_window,
    'delivery_status',v_status,
    'inserted',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Hub report: subsequent schedule/run + drift performance + breach tighten
-- ---------------------------------------------------------------------------
create or replace function public.get_docusign_archive_phase48_ops_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sched public.os_docusign_archive_recurring_quarterly_schedules%rowtype;
  v_run public.os_docusign_archive_subsequent_quarterly_runs%rowtype;
  v_report public.os_docusign_archive_recurring_performance_reports%rowtype;
  v_tighten public.os_docusign_archive_drift_breach_tighten_events%rowtype;
  v_arm public.os_docusign_archive_recurring_quarterly_arms%rowtype;
  v_alerts jsonb;
  v_sched_status text := 'none';
  v_run_status text := 'none';
  v_drift_perf text := 'unknown';
  v_tighten_status text := 'none';
  v_alert_delivery text := 'none';
  v_critical_open integer := 0;
  v_completed integer := 0;
  v_breaches integer := 0;
  v_failed boolean := false;
  v_skipped boolean := false;
  v_delivered boolean := false;
  v_recorded boolean := false;
begin
  select * into v_sched
  from public.os_docusign_archive_recurring_quarterly_schedules
  order by created_at desc
  limit 1;

  select * into v_run
  from public.os_docusign_archive_subsequent_quarterly_runs
  order by created_at desc
  limit 1;

  select * into v_report
  from public.os_docusign_archive_recurring_performance_reports
  order by created_at desc
  limit 1;

  select * into v_tighten
  from public.os_docusign_archive_drift_breach_tighten_events
  order by created_at desc
  limit 1;

  select * into v_arm
  from public.os_docusign_archive_recurring_quarterly_arms a
  where a.status = 'armed'
  order by a.created_at desc
  limit 1;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
  into v_alerts
  from (
    select alert_id, alert_kind, window_key, severity, destination_key,
      delivery_status, response_code, metrics_sha256, created_at
    from public.os_docusign_archive_phase48_ops_alerts
    order by created_at desc
    limit 20
  ) a;

  if v_sched.schedule_id is not null then
    v_sched_status := v_sched.status;
  end if;

  if v_run.run_id is not null then
    v_run_status := v_run.status;
  end if;

  if v_report.report_id is not null then
    v_drift_perf := v_report.drift_performance;
    v_completed := v_report.completed_subsequent_count;
    v_breaches := v_report.breach_count_30d;
  elsif v_run.run_id is not null then
    if v_run.status = 'drift_budget_breach' then
      v_drift_perf := 'breach';
    elsif v_run.within_budget then
      v_drift_perf := 'within_budget';
    else
      v_drift_perf := 'unknown';
    end if;
  end if;

  if v_tighten.event_id is not null then
    v_tighten_status := v_tighten.status;
  end if;

  select count(*)::integer into v_critical_open
  from public.os_docusign_archive_phase48_ops_alerts a
  where a.created_at >= now() - interval '7 days';

  select
    bool_or(x.delivery_status = 'failed'),
    bool_or(x.delivery_status = 'skipped_no_webhook'),
    bool_or(x.delivery_status = 'delivered'),
    bool_or(x.delivery_status = 'recorded')
  into v_failed, v_skipped, v_delivered, v_recorded
  from public.os_docusign_archive_phase48_ops_alerts x
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
    'version','phase48-v1',
    'schedule_status',v_sched_status,
    'subsequent_run_status',v_run_status,
    'drift_performance',v_drift_perf,
    'breach_tighten_status',v_tighten_status,
    'alert_delivery',v_alert_delivery,
    'critical_alert_count',v_critical_open,
    'completed_subsequent_count',v_completed,
    'breach_count_30d',v_breaches,
    'recurring_quarterly_armed',v_arm.arm_id is not null,
    'latest_schedule', case
      when v_sched.schedule_id is null then null
      else jsonb_build_object(
        'schedule_id',v_sched.schedule_id,
        'schedule_key',v_sched.schedule_key,
        'arm_id',v_sched.arm_id,
        'prior_run_id',v_sched.prior_run_id,
        'due_at',v_sched.due_at,
        'cadence_months',v_sched.cadence_months,
        'status',v_sched.status,
        'block_reason',v_sched.block_reason,
        'metrics_sha256',v_sched.metrics_sha256,
        'created_at',v_sched.created_at
      )
    end,
    'latest_subsequent_run', case
      when v_run.run_id is null then null
      else jsonb_build_object(
        'run_id',v_run.run_id,
        'run_key',v_run.run_key,
        'schedule_id',v_run.schedule_id,
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
    'latest_performance_report', case
      when v_report.report_id is null then null
      else jsonb_build_object(
        'report_id',v_report.report_id,
        'report_key',v_report.report_key,
        'schedule_id',v_report.schedule_id,
        'subsequent_run_id',v_report.subsequent_run_id,
        'schedule_status',v_report.schedule_status,
        'subsequent_run_status',v_report.subsequent_run_status,
        'drift_performance',v_report.drift_performance,
        'breach_tighten_status',v_report.breach_tighten_status,
        'completed_subsequent_count',v_report.completed_subsequent_count,
        'breach_count_30d',v_report.breach_count_30d,
        'within_budget',v_report.within_budget,
        'metrics_sha256',v_report.metrics_sha256,
        'created_at',v_report.created_at
      )
    end,
    'latest_breach_tighten', case
      when v_tighten.event_id is null then null
      else jsonb_build_object(
        'event_id',v_tighten.event_id,
        'event_key',v_tighten.event_key,
        'revision_id',v_tighten.revision_id,
        'budget_key',v_tighten.budget_key,
        'prior_max_content_drift',v_tighten.prior_max_content_drift,
        'prior_max_storage_unavailable',v_tighten.prior_max_storage_unavailable,
        'proposed_max_content_drift',v_tighten.proposed_max_content_drift,
        'proposed_max_storage_unavailable',v_tighten.proposed_max_storage_unavailable,
        'status',v_tighten.status,
        'block_reason',v_tighten.block_reason,
        'metrics_sha256',v_tighten.metrics_sha256,
        'created_at',v_tighten.created_at
      )
    end,
    'alerts',coalesce(v_alerts,'[]'::jsonb),
    'destination_key','ops_alerts'
  );
end;
$$;

revoke all on function public.reject_docusign_phase48_ops_mutation()
  from public, anon, authenticated;
revoke all on function public.schedule_docusign_subsequent_recurring_quarterly_phase48(
  jsonb,boolean)
  from public, anon, authenticated;
revoke all on function public.run_docusign_subsequent_recurring_quarterly_phase48(
  jsonb,boolean)
  from public, anon, authenticated;
revoke all on function public.tighten_docusign_drift_budget_on_breach_phase48(
  jsonb,integer)
  from public, anon, authenticated;
revoke all on function public.record_docusign_recurring_performance_report_phase48(jsonb)
  from public, anon, authenticated;
revoke all on function public.list_docusign_archive_phase48_critical_windows(integer)
  from public, anon;
revoke all on function public.record_docusign_archive_phase48_ops_alert(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_docusign_archive_phase48_ops_report()
  from public, anon;

grant execute on function public.phase46_docusign_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.phase47_docusign_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.phase48_docusign_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.list_docusign_archive_phase48_critical_windows(integer)
  to authenticated, service_role;
grant execute on function public.get_docusign_archive_phase48_ops_report()
  to authenticated, service_role;
grant execute on function public.schedule_docusign_subsequent_recurring_quarterly_phase48(
  jsonb,boolean)
  to service_role;
grant execute on function public.run_docusign_subsequent_recurring_quarterly_phase48(
  jsonb,boolean)
  to service_role;
grant execute on function public.tighten_docusign_drift_budget_on_breach_phase48(
  jsonb,integer)
  to service_role;
grant execute on function public.record_docusign_recurring_performance_report_phase48(jsonb)
  to service_role;
grant execute on function public.record_docusign_archive_phase48_ops_alert(jsonb)
  to service_role;
grant execute on function public.os_sha256_hex(text)
  to authenticated, service_role;
