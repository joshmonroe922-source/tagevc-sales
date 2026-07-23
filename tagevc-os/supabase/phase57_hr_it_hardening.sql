-- Phase 57: HR + IT Production Hardening.
-- Onboarding/offboarding run completeness, asset/license assignment visibility,
-- access revocation evidence, Intune dual-approve inbox usability, exception
-- aging + escalations. High-risk actions remain dual-approved.
-- Reuses multi-sub identity lifecycle (P5) and Intune dual-approve inbox.
-- Apply after Phase 56. Safe to re-run.
-- Append-only evidence only. Never auto-close breakers without dual-approve.
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

create or replace function public.phase57_hr_it_safe_detail(p_detail jsonb)
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

create or replace function public.reject_hr_it_phase57_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'HR + IT Phase 57 evidence is append-only';
end;
$$;

-- ---------------------------------------------------------------------------
-- Run completeness snapshots (onboarding / offboarding).
-- ---------------------------------------------------------------------------
create table if not exists public.os_hr_it_run_completeness_phase57_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  onboarding_open integer not null default 0 check (onboarding_open >= 0),
  onboarding_completed integer not null default 0 check (onboarding_completed >= 0),
  offboarding_open integer not null default 0 check (offboarding_open >= 0),
  offboarding_completed integer not null default 0 check (offboarding_completed >= 0),
  identity_lifecycle_open integer not null default 0
    check (identity_lifecycle_open >= 0),
  completeness_pct numeric(5,2)
    check (completeness_pct is null or (completeness_pct >= 0 and completeness_pct <= 100)),
  board_status text not null default 'unknown'
    check (board_status in ('ok','partial','missing','unknown')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_hr_it_run_p57_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=8192
      and public.phase57_hr_it_safe_detail(detail)
    ),
  constraint os_hr_it_run_p57_no_auto_close_check
    check (coalesce((detail->>'breaker_auto_closed')::boolean,false)=false)
);

create index if not exists os_hr_it_run_p57_entity_created_idx
  on public.os_hr_it_run_completeness_phase57_snapshots(entity_id, created_at desc);
create index if not exists os_hr_it_run_p57_created_idx
  on public.os_hr_it_run_completeness_phase57_snapshots(created_at desc);

alter table public.os_hr_it_run_completeness_phase57_snapshots
  enable row level security;
drop policy if exists "os_hr_it_run_p57_select"
  on public.os_hr_it_run_completeness_phase57_snapshots;
create policy "os_hr_it_run_p57_select"
  on public.os_hr_it_run_completeness_phase57_snapshots for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_hr_it_run_completeness_phase57_snapshots
  from public, anon, authenticated;
grant select on public.os_hr_it_run_completeness_phase57_snapshots
  to authenticated;

drop trigger if exists os_hr_it_run_p57_immutable
  on public.os_hr_it_run_completeness_phase57_snapshots;
create trigger os_hr_it_run_p57_immutable
  before update or delete on public.os_hr_it_run_completeness_phase57_snapshots
  for each row execute function public.reject_hr_it_phase57_mutation();
drop trigger if exists os_hr_it_run_p57_no_truncate
  on public.os_hr_it_run_completeness_phase57_snapshots;
create trigger os_hr_it_run_p57_no_truncate
  before truncate on public.os_hr_it_run_completeness_phase57_snapshots
  for each statement execute function public.reject_hr_it_phase57_mutation();

-- ---------------------------------------------------------------------------
-- Asset / license assignment visibility events.
-- ---------------------------------------------------------------------------
create table if not exists public.os_hr_it_assignment_visibility_phase57_events (
  event_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  hardware_assigned integer not null default 0 check (hardware_assigned >= 0),
  hardware_in_stock integer not null default 0 check (hardware_in_stock >= 0),
  license_seats_used integer not null default 0 check (license_seats_used >= 0),
  license_seats_total integer not null default 0 check (license_seats_total >= 0),
  visibility_status text not null default 'missing'
    check (visibility_status in ('ok','partial','missing','unknown')),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_hr_it_asg_p57_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase57_hr_it_safe_detail(detail)
    )
);

create index if not exists os_hr_it_asg_p57_entity_created_idx
  on public.os_hr_it_assignment_visibility_phase57_events(entity_id, created_at desc);

alter table public.os_hr_it_assignment_visibility_phase57_events
  enable row level security;
drop policy if exists "os_hr_it_asg_p57_select"
  on public.os_hr_it_assignment_visibility_phase57_events;
create policy "os_hr_it_asg_p57_select"
  on public.os_hr_it_assignment_visibility_phase57_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_hr_it_assignment_visibility_phase57_events
  from public, anon, authenticated;
grant select on public.os_hr_it_assignment_visibility_phase57_events
  to authenticated;

drop trigger if exists os_hr_it_asg_p57_immutable
  on public.os_hr_it_assignment_visibility_phase57_events;
create trigger os_hr_it_asg_p57_immutable
  before update or delete on public.os_hr_it_assignment_visibility_phase57_events
  for each row execute function public.reject_hr_it_phase57_mutation();
drop trigger if exists os_hr_it_asg_p57_no_truncate
  on public.os_hr_it_assignment_visibility_phase57_events;
create trigger os_hr_it_asg_p57_no_truncate
  before truncate on public.os_hr_it_assignment_visibility_phase57_events
  for each statement execute function public.reject_hr_it_phase57_mutation();

-- ---------------------------------------------------------------------------
-- Access revocation evidence (observe / append-only — never silent revoke).
-- ---------------------------------------------------------------------------
create table if not exists public.os_hr_it_access_revocation_phase57_evidence (
  evidence_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  run_id text,
  user_ref text,
  revocation_kind text not null
    check (revocation_kind in (
      'license_seat','graph_group','mdm_wipe','account_disable',
      'hardware_return','other_observe'
    )),
  evidence_status text not null default 'observed'
    check (evidence_status in (
      'observed','pending_dual_approve','dual_approved','blocked','missing'
    )),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_hr_it_rev_p57_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase57_hr_it_safe_detail(detail)
    ),
  constraint os_hr_it_rev_p57_no_silent_revoke_check
    check (coalesce((detail->>'access_revoke_executed')::boolean,false)=false),
  constraint os_hr_it_rev_p57_dual_required_check
    check (coalesce((detail->>'dual_approve_required')::boolean,true)=true)
);

create index if not exists os_hr_it_rev_p57_entity_created_idx
  on public.os_hr_it_access_revocation_phase57_evidence(entity_id, created_at desc);
create index if not exists os_hr_it_rev_p57_created_idx
  on public.os_hr_it_access_revocation_phase57_evidence(created_at desc);

alter table public.os_hr_it_access_revocation_phase57_evidence
  enable row level security;
drop policy if exists "os_hr_it_rev_p57_select"
  on public.os_hr_it_access_revocation_phase57_evidence;
create policy "os_hr_it_rev_p57_select"
  on public.os_hr_it_access_revocation_phase57_evidence for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_hr_it_access_revocation_phase57_evidence
  from public, anon, authenticated;
grant select on public.os_hr_it_access_revocation_phase57_evidence
  to authenticated;

drop trigger if exists os_hr_it_rev_p57_immutable
  on public.os_hr_it_access_revocation_phase57_evidence;
create trigger os_hr_it_rev_p57_immutable
  before update or delete on public.os_hr_it_access_revocation_phase57_evidence
  for each row execute function public.reject_hr_it_phase57_mutation();
drop trigger if exists os_hr_it_rev_p57_no_truncate
  on public.os_hr_it_access_revocation_phase57_evidence;
create trigger os_hr_it_rev_p57_no_truncate
  before truncate on public.os_hr_it_access_revocation_phase57_evidence
  for each statement execute function public.reject_hr_it_phase57_mutation();

-- ---------------------------------------------------------------------------
-- Exception aging alerts + escalation events.
-- ---------------------------------------------------------------------------
create table if not exists public.os_hr_it_exception_aging_phase57_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  alert_kind text not null
    check (alert_kind in (
      'onboarding_aging','offboarding_aging','inbox_stale',
      'revocation_pending','assignment_gap','breaker_aging','manual_flag'
    )),
  severity text not null default 'warning'
    check (severity in ('info','warning','critical')),
  title text not null check (char_length(title) between 2 and 240),
  age_hours numeric(10,2) not null default 0 check (age_hours >= 0),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_hr_it_age_p57_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase57_hr_it_safe_detail(detail)
    ),
  constraint os_hr_it_age_p57_no_auto_close_check
    check (coalesce((detail->>'breaker_auto_closed')::boolean,false)=false)
);

create index if not exists os_hr_it_age_p57_created_idx
  on public.os_hr_it_exception_aging_phase57_alerts(created_at desc);
create index if not exists os_hr_it_age_p57_entity_idx
  on public.os_hr_it_exception_aging_phase57_alerts(entity_id, created_at desc);

alter table public.os_hr_it_exception_aging_phase57_alerts
  enable row level security;
drop policy if exists "os_hr_it_age_p57_select"
  on public.os_hr_it_exception_aging_phase57_alerts;
create policy "os_hr_it_age_p57_select"
  on public.os_hr_it_exception_aging_phase57_alerts for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_hr_it_exception_aging_phase57_alerts
  from public, anon, authenticated;
grant select on public.os_hr_it_exception_aging_phase57_alerts
  to authenticated;

drop trigger if exists os_hr_it_age_p57_immutable
  on public.os_hr_it_exception_aging_phase57_alerts;
create trigger os_hr_it_age_p57_immutable
  before update or delete on public.os_hr_it_exception_aging_phase57_alerts
  for each row execute function public.reject_hr_it_phase57_mutation();
drop trigger if exists os_hr_it_age_p57_no_truncate
  on public.os_hr_it_exception_aging_phase57_alerts;
create trigger os_hr_it_age_p57_no_truncate
  before truncate on public.os_hr_it_exception_aging_phase57_alerts
  for each statement execute function public.reject_hr_it_phase57_mutation();

create table if not exists public.os_hr_it_escalation_phase57_events (
  event_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  escalation_kind text not null
    check (escalation_kind in (
      'inbox_stale','run_aging','revocation_pending','breaker_aging','manual'
    )),
  reference_id text,
  title text not null check (char_length(title) between 2 and 240),
  status text not null default 'open'
    check (status in ('open','acknowledged','escalated','resolved_observe')),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_hr_it_esc_p57_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase57_hr_it_safe_detail(detail)
    ),
  constraint os_hr_it_esc_p57_no_auto_close_check
    check (coalesce((detail->>'breaker_auto_closed')::boolean,false)=false)
);

create index if not exists os_hr_it_esc_p57_entity_created_idx
  on public.os_hr_it_escalation_phase57_events(entity_id, created_at desc);
create index if not exists os_hr_it_esc_p57_created_idx
  on public.os_hr_it_escalation_phase57_events(created_at desc);

alter table public.os_hr_it_escalation_phase57_events
  enable row level security;
drop policy if exists "os_hr_it_esc_p57_select"
  on public.os_hr_it_escalation_phase57_events;
create policy "os_hr_it_esc_p57_select"
  on public.os_hr_it_escalation_phase57_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_hr_it_escalation_phase57_events
  from public, anon, authenticated;
grant select on public.os_hr_it_escalation_phase57_events
  to authenticated;

drop trigger if exists os_hr_it_esc_p57_immutable
  on public.os_hr_it_escalation_phase57_events;
create trigger os_hr_it_esc_p57_immutable
  before update or delete on public.os_hr_it_escalation_phase57_events
  for each row execute function public.reject_hr_it_phase57_mutation();
drop trigger if exists os_hr_it_esc_p57_no_truncate
  on public.os_hr_it_escalation_phase57_events;
create trigger os_hr_it_esc_p57_no_truncate
  before truncate on public.os_hr_it_escalation_phase57_events
  for each statement execute function public.reject_hr_it_phase57_mutation();

-- ---------------------------------------------------------------------------
-- High-risk dual-approve proposals (breaker close / access revoke execute).
-- NEVER auto-closes breakers. NEVER silently revokes access.
-- ---------------------------------------------------------------------------
create table if not exists public.os_hr_it_high_risk_phase57_proposals (
  proposal_id uuid primary key default gen_random_uuid(),
  proposal_key text not null unique
    check (proposal_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  action_kind text not null
    check (action_kind in (
      'breaker_close','access_revoke_execute','offboarding_force_complete',
      'onboarding_force_complete','other_high_risk'
    )),
  summary text not null check (char_length(summary) between 2 and 500),
  proposed_by uuid not null,
  status text not null default 'pending'
    check (status in (
      'pending','rejected','dual_approved','blocked','superseded'
    )),
  source_proposal_id uuid,
  block_reason text,
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_hr_it_hrisk_p57_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=8192
      and public.phase57_hr_it_safe_detail(detail)
    ),
  constraint os_hr_it_hrisk_p57_no_auto_close_check
    check (coalesce((detail->>'breaker_auto_closed')::boolean,false)=false),
  constraint os_hr_it_hrisk_p57_no_silent_revoke_check
    check (coalesce((detail->>'access_revoke_executed')::boolean,false)=false),
  constraint os_hr_it_hrisk_p57_dual_required_check
    check (coalesce((detail->>'dual_approve_required')::boolean,true)=true)
);

create unique index if not exists os_hr_it_hrisk_p57_one_pending_per_key
  on public.os_hr_it_high_risk_phase57_proposals(proposal_key)
  where status = 'pending';

create index if not exists os_hr_it_hrisk_p57_status_created_idx
  on public.os_hr_it_high_risk_phase57_proposals(status, created_at desc);
create index if not exists os_hr_it_hrisk_p57_entity_idx
  on public.os_hr_it_high_risk_phase57_proposals(entity_id, created_at desc);

alter table public.os_hr_it_high_risk_phase57_proposals
  enable row level security;
drop policy if exists "os_hr_it_hrisk_p57_select"
  on public.os_hr_it_high_risk_phase57_proposals;
create policy "os_hr_it_hrisk_p57_select"
  on public.os_hr_it_high_risk_phase57_proposals for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_hr_it_high_risk_phase57_proposals
  from public, anon, authenticated;
grant select on public.os_hr_it_high_risk_phase57_proposals
  to authenticated;

drop trigger if exists os_hr_it_hrisk_p57_immutable
  on public.os_hr_it_high_risk_phase57_proposals;
create trigger os_hr_it_hrisk_p57_immutable
  before update or delete on public.os_hr_it_high_risk_phase57_proposals
  for each row execute function public.reject_hr_it_phase57_mutation();
drop trigger if exists os_hr_it_hrisk_p57_no_truncate
  on public.os_hr_it_high_risk_phase57_proposals;
create trigger os_hr_it_hrisk_p57_no_truncate
  before truncate on public.os_hr_it_high_risk_phase57_proposals
  for each statement execute function public.reject_hr_it_phase57_mutation();

create table if not exists public.os_hr_it_high_risk_phase57_approvals (
  approval_id uuid primary key default gen_random_uuid(),
  approval_key text not null unique
    check (approval_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  proposal_id uuid not null
    references public.os_hr_it_high_risk_phase57_proposals(proposal_id),
  actor_id uuid not null,
  decision text not null check (decision in ('approve','reject')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_hr_it_hrisk_appr_p57_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase57_hr_it_safe_detail(detail)
    )
);

create index if not exists os_hr_it_hrisk_appr_p57_proposal_idx
  on public.os_hr_it_high_risk_phase57_approvals(proposal_id, created_at desc);

alter table public.os_hr_it_high_risk_phase57_approvals
  enable row level security;
drop policy if exists "os_hr_it_hrisk_appr_p57_select"
  on public.os_hr_it_high_risk_phase57_approvals;
create policy "os_hr_it_hrisk_appr_p57_select"
  on public.os_hr_it_high_risk_phase57_approvals for select to authenticated
  using (true);
revoke all on public.os_hr_it_high_risk_phase57_approvals
  from public, anon, authenticated;
grant select on public.os_hr_it_high_risk_phase57_approvals
  to authenticated;

drop trigger if exists os_hr_it_hrisk_appr_p57_immutable
  on public.os_hr_it_high_risk_phase57_approvals;
create trigger os_hr_it_hrisk_appr_p57_immutable
  before update or delete on public.os_hr_it_high_risk_phase57_approvals
  for each row execute function public.reject_hr_it_phase57_mutation();
drop trigger if exists os_hr_it_hrisk_appr_p57_no_truncate
  on public.os_hr_it_high_risk_phase57_approvals;
create trigger os_hr_it_hrisk_appr_p57_no_truncate
  before truncate on public.os_hr_it_high_risk_phase57_approvals
  for each statement execute function public.reject_hr_it_phase57_mutation();

-- ---------------------------------------------------------------------------
-- Subsidiary HR/IT visibility (ENT-R619 / ENT-INDA).
-- ---------------------------------------------------------------------------
create table if not exists public.os_hr_it_subsidiary_phase57_events (
  event_id uuid primary key default gen_random_uuid(),
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  open_runs integer not null default 0 check (open_runs >= 0),
  aging_alerts integer not null default 0 check (aging_alerts >= 0),
  visibility_status text not null default 'missing'
    check (visibility_status in ('ok','partial','missing','unknown')),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_hr_it_sub_p57_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase57_hr_it_safe_detail(detail)
    )
);

create index if not exists os_hr_it_sub_p57_entity_created_idx
  on public.os_hr_it_subsidiary_phase57_events(entity_id, created_at desc);

alter table public.os_hr_it_subsidiary_phase57_events
  enable row level security;
drop policy if exists "os_hr_it_sub_p57_select"
  on public.os_hr_it_subsidiary_phase57_events;
create policy "os_hr_it_sub_p57_select"
  on public.os_hr_it_subsidiary_phase57_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_hr_it_subsidiary_phase57_events
  from public, anon, authenticated;
grant select on public.os_hr_it_subsidiary_phase57_events
  to authenticated;

drop trigger if exists os_hr_it_sub_p57_immutable
  on public.os_hr_it_subsidiary_phase57_events;
create trigger os_hr_it_sub_p57_immutable
  before update or delete on public.os_hr_it_subsidiary_phase57_events
  for each row execute function public.reject_hr_it_phase57_mutation();
drop trigger if exists os_hr_it_sub_p57_no_truncate
  on public.os_hr_it_subsidiary_phase57_events;
create trigger os_hr_it_sub_p57_no_truncate
  before truncate on public.os_hr_it_subsidiary_phase57_events
  for each statement execute function public.reject_hr_it_phase57_mutation();

-- ---------------------------------------------------------------------------
-- Dual-approve inbox usability snapshots (enhances Phase 51 inbox).
-- ---------------------------------------------------------------------------
create table if not exists public.os_hr_it_dual_approve_inbox_phase57_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  pending_count integer not null default 0 check (pending_count >= 0),
  stale_count integer not null default 0 check (stale_count >= 0),
  critical_count integer not null default 0 check (critical_count >= 0),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_hr_it_inbox_p57_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=8192
      and public.phase57_hr_it_safe_detail(detail)
    ),
  constraint os_hr_it_inbox_p57_no_auto_close_check
    check (coalesce((detail->>'breaker_auto_closed')::boolean,false)=false)
);

create index if not exists os_hr_it_inbox_p57_created_idx
  on public.os_hr_it_dual_approve_inbox_phase57_snapshots(created_at desc);

alter table public.os_hr_it_dual_approve_inbox_phase57_snapshots
  enable row level security;
drop policy if exists "os_hr_it_inbox_p57_select"
  on public.os_hr_it_dual_approve_inbox_phase57_snapshots;
create policy "os_hr_it_inbox_p57_select"
  on public.os_hr_it_dual_approve_inbox_phase57_snapshots for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_hr_it_dual_approve_inbox_phase57_snapshots
  from public, anon, authenticated;
grant select on public.os_hr_it_dual_approve_inbox_phase57_snapshots
  to authenticated;

drop trigger if exists os_hr_it_inbox_p57_immutable
  on public.os_hr_it_dual_approve_inbox_phase57_snapshots;
create trigger os_hr_it_inbox_p57_immutable
  before update or delete on public.os_hr_it_dual_approve_inbox_phase57_snapshots
  for each row execute function public.reject_hr_it_phase57_mutation();
drop trigger if exists os_hr_it_inbox_p57_no_truncate
  on public.os_hr_it_dual_approve_inbox_phase57_snapshots;
create trigger os_hr_it_inbox_p57_no_truncate
  before truncate on public.os_hr_it_dual_approve_inbox_phase57_snapshots
  for each statement execute function public.reject_hr_it_phase57_mutation();

-- ---------------------------------------------------------------------------
-- Ops alerts.
-- ---------------------------------------------------------------------------
create table if not exists public.os_hr_it_phase57_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  alert_kind text not null
    check (alert_kind in (
      'run_completeness_gap','assignment_visibility_gap','revocation_pending',
      'dual_approve_required','inbox_stale','exception_aging',
      'escalation_raised','refresh_failed','subsidiary_gap'
    )),
  reference_id uuid,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null default 'warning'
    check (severity in ('info','warning','critical')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_hr_it_ops_p57_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase57_hr_it_safe_detail(detail)
    ),
  constraint os_hr_it_ops_p57_no_auto_close_check
    check (coalesce((detail->>'breaker_auto_closed')::boolean,false)=false)
);

create index if not exists os_hr_it_ops_p57_created_idx
  on public.os_hr_it_phase57_ops_alerts(created_at desc);

alter table public.os_hr_it_phase57_ops_alerts enable row level security;
drop policy if exists "os_hr_it_ops_p57_select"
  on public.os_hr_it_phase57_ops_alerts;
create policy "os_hr_it_ops_p57_select"
  on public.os_hr_it_phase57_ops_alerts for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_hr_it_phase57_ops_alerts
  from public, anon, authenticated;
grant select on public.os_hr_it_phase57_ops_alerts
  to authenticated;

drop trigger if exists os_hr_it_ops_p57_immutable
  on public.os_hr_it_phase57_ops_alerts;
create trigger os_hr_it_ops_p57_immutable
  before update or delete on public.os_hr_it_phase57_ops_alerts
  for each row execute function public.reject_hr_it_phase57_mutation();
drop trigger if exists os_hr_it_ops_p57_no_truncate
  on public.os_hr_it_phase57_ops_alerts;
create trigger os_hr_it_ops_p57_no_truncate
  before truncate on public.os_hr_it_phase57_ops_alerts
  for each statement execute function public.reject_hr_it_phase57_mutation();

-- ---------------------------------------------------------------------------
-- Record escalation (observe-only — never closes breakers).
-- ---------------------------------------------------------------------------
create or replace function public.record_hr_it_escalation_phase57(
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := nullif(trim(coalesce(p_payload->>'entity_id','')),'');
  v_kind text := nullif(trim(coalesce(p_payload->>'escalation_kind','')),'');
  v_ref text := nullif(trim(coalesce(p_payload->>'reference_id','')),'');
  v_title text := nullif(trim(coalesce(p_payload->>'title','')),'');
  v_status text := nullif(trim(coalesce(p_payload->>'status','')),'');
  v_actor uuid := nullif(p_payload->>'actor_id','')::uuid;
  v_meta jsonb := coalesce(p_payload->'detail', '{}'::jsonb);
  v_window text;
  v_hash text;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Phase 57 escalation payload must be a JSON object';
  end if;
  if v_kind is null
    or v_kind not in (
      'inbox_stale','run_aging','revocation_pending','breaker_aging','manual'
    )
    or v_title is null or char_length(v_title) < 2
    or v_status is null
    or v_status not in ('open','acknowledged','escalated','resolved_observe')
    or not public.phase57_hr_it_safe_detail(v_meta) then
    raise exception 'Phase 57 escalation contract is invalid or unsafe';
  end if;
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 57 escalation';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 57 escalation';
  end if;

  v_window := left(
    'phase57:esc:' || coalesce(v_entity,'firm') || ':' || v_kind || ':'
      || coalesce(v_ref,'none') || ':' || v_status || ':'
      || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24MI'),
    200
  );
  v_hash := public.os_sha256_hex(
    coalesce(v_entity,'firm') || '|' || v_kind || '|' || v_status || '|' || v_window
  );

  insert into public.os_hr_it_escalation_phase57_events (
    entity_id, escalation_kind, reference_id, title, status,
    window_key, metrics_sha256, detail, actor_id
  ) values (
    v_entity, v_kind, v_ref, left(v_title,240), v_status,
    v_window, v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase57-v1',
      'breaker_auto_closed',false,
      'access_revoke_executed',false,
      'dual_approve_required',true
    ),
    v_actor
  )
  on conflict (window_key) do nothing
  returning event_id into v_id;

  if v_id is null then
    select event_id into v_id
    from public.os_hr_it_escalation_phase57_events
    where window_key = v_window;
  end if;

  insert into public.os_hr_it_phase57_ops_alerts (
    entity_id, alert_kind, reference_id, window_key, severity,
    metrics_sha256, detail
  ) values (
    v_entity, 'escalation_raised', v_id,
    left('phase57:alert:esc:' || coalesce(v_id::text, v_window), 200),
    'warning', v_hash,
    jsonb_build_object(
      'contract_version','phase57-v1',
      'escalation_kind', v_kind,
      'breaker_auto_closed', false
    )
  ) on conflict (window_key) do nothing;

  return jsonb_build_object(
    'event_id', v_id,
    'window_key', v_window,
    'status', v_status,
    'breaker_auto_closed', false,
    'access_revoke_executed', false,
    'contract_version', 'phase57-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Propose high-risk action (NEVER executes — dual-approve gate only).
-- ---------------------------------------------------------------------------
create or replace function public.propose_hr_it_high_risk_phase57(
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := nullif(trim(coalesce(p_payload->>'entity_id','')),'');
  v_kind text := nullif(trim(coalesce(p_payload->>'action_kind','')),'');
  v_summary text := nullif(trim(coalesce(p_payload->>'summary','')),'');
  v_actor uuid := nullif(p_payload->>'proposed_by','')::uuid;
  v_meta jsonb := coalesce(p_payload->'detail', '{}'::jsonb);
  v_key text;
  v_hash text;
  v_row public.os_hr_it_high_risk_phase57_proposals%rowtype;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Phase 57 high-risk proposal payload must be a JSON object';
  end if;
  if v_actor is null
    or v_summary is null or char_length(v_summary) < 2
    or v_kind is null
    or v_kind not in (
      'breaker_close','access_revoke_execute','offboarding_force_complete',
      'onboarding_force_complete','other_high_risk'
    )
    or not public.phase57_hr_it_safe_detail(v_meta) then
    raise exception 'Phase 57 high-risk proposal requires proposed_by, summary, action_kind, and safe detail';
  end if;
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 57 high-risk proposal';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 57 high-risk proposal';
  end if;

  -- Never auto-close breakers / never silent revoke from this gate.
  v_key := left(
    'hrisk57:' || coalesce(v_entity,'firm') || ':' || v_kind || ':'
      || public.os_sha256_hex(v_summary || '|' || v_actor::text),
    200
  );

  select * into v_row
  from public.os_hr_it_high_risk_phase57_proposals
  where proposal_key = v_key and status = 'pending'
  order by created_at desc
  limit 1;
  if v_row.proposal_id is not null then
    return jsonb_build_object(
      'version','phase57-v1',
      'disposition','unchanged',
      'status','pending',
      'proposal_id',v_row.proposal_id,
      'proposal_key',v_row.proposal_key,
      'breaker_auto_closed',false,
      'access_revoke_executed',false,
      'dual_approve_required',true
    );
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase57-v1',
    'kind','high_risk_proposal',
    'proposal_key',v_key,
    'entity_id',v_entity,
    'action_kind',v_kind,
    'proposed_by',v_actor
  )::text);

  insert into public.os_hr_it_high_risk_phase57_proposals (
    proposal_key, entity_id, action_kind, summary, proposed_by,
    status, metrics_sha256, detail
  ) values (
    v_key, v_entity, v_kind, left(v_summary,500), v_actor,
    'pending', v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase57-v1',
      'breaker_auto_closed',false,
      'access_revoke_executed',false,
      'dual_approve_required',true,
      'operator_must_execute_after_dual_approve',true
    )
  )
  on conflict (proposal_key) do nothing
  returning * into v_row;

  if v_row.proposal_id is null then
    select * into v_row
    from public.os_hr_it_high_risk_phase57_proposals
    where proposal_key = v_key
    order by created_at desc
    limit 1;
    return jsonb_build_object(
      'version','phase57-v1',
      'disposition','unchanged',
      'status',v_row.status,
      'proposal_id',v_row.proposal_id,
      'proposal_key',v_row.proposal_key,
      'breaker_auto_closed',false,
      'access_revoke_executed',false,
      'dual_approve_required',true
    );
  end if;

  insert into public.os_hr_it_phase57_ops_alerts (
    entity_id, alert_kind, reference_id, window_key, severity,
    metrics_sha256, detail
  ) values (
    v_entity, 'dual_approve_required', v_row.proposal_id,
    left('phase57:alert:dual_approve:' || v_row.proposal_id::text, 200),
    'warning', v_hash,
    jsonb_build_object(
      'contract_version','phase57-v1',
      'breaker_auto_closed',false,
      'access_revoke_executed',false,
      'proposal_id',v_row.proposal_id,
      'action_kind',v_kind
    )
  ) on conflict (window_key) do nothing;

  return jsonb_build_object(
    'version','phase57-v1',
    'disposition','proposed',
    'status','pending',
    'proposal_id',v_row.proposal_id,
    'proposal_key',v_row.proposal_key,
    'breaker_auto_closed',false,
    'access_revoke_executed',false,
    'dual_approve_required',true
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Dual-human approval for high-risk proposals.
-- After 2 DISTINCT approvers (neither is the proposer), status becomes
-- dual_approved. Tage NEVER closes breakers or revokes access from this gate.
-- ---------------------------------------------------------------------------
create or replace function public.approve_hr_it_high_risk_phase57(
  p_proposal_id uuid,
  p_actor_id uuid,
  p_decision text default 'approve',
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_detail, '{}'::jsonb);
  v_decision text := coalesce(nullif(trim(lower(p_decision)), ''), 'approve');
  v_proposal public.os_hr_it_high_risk_phase57_proposals%rowtype;
  v_approval_key text;
  v_hash text;
  v_id uuid;
  v_distinct_approvers integer := 0;
  v_result_key text;
  v_result_row public.os_hr_it_high_risk_phase57_proposals%rowtype;
begin
  if p_proposal_id is null or p_actor_id is null
    or v_decision not in ('approve','reject')
    or not public.phase57_hr_it_safe_detail(v_meta) then
    raise exception 'Phase 57 dual-approve high-risk contract is invalid or unsafe';
  end if;

  select * into v_proposal
  from public.os_hr_it_high_risk_phase57_proposals
  where proposal_id = p_proposal_id;
  if v_proposal.proposal_id is null then
    raise exception 'Phase 57 high-risk proposal is unknown';
  end if;
  if v_proposal.proposed_by = p_actor_id then
    raise exception 'Proposer may not also approve their own Phase 57 high-risk proposal';
  end if;
  if v_proposal.status <> 'pending' then
    return jsonb_build_object(
      'version','phase57-v1',
      'disposition','unchanged',
      'status',v_proposal.status,
      'proposal_id',v_proposal.proposal_id,
      'breaker_auto_closed',false,
      'access_revoke_executed',false
    );
  end if;

  v_approval_key := left(p_proposal_id::text || ':' || p_actor_id::text, 200);
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase57-v1',
    'kind','high_risk_approval',
    'proposal_id',p_proposal_id,
    'actor_id',p_actor_id,
    'decision',v_decision
  )::text);

  insert into public.os_hr_it_high_risk_phase57_approvals (
    approval_key, proposal_id, actor_id, decision, metrics_sha256, detail
  ) values (
    v_approval_key, p_proposal_id, p_actor_id, v_decision, v_hash,
    v_meta || jsonb_build_object('contract_version','phase57-v1')
  )
  on conflict (approval_key) do nothing
  returning approval_id into v_id;

  if v_id is null then
    return jsonb_build_object(
      'version','phase57-v1',
      'disposition','unchanged',
      'status','duplicate_actor_decision',
      'proposal_id',p_proposal_id,
      'breaker_auto_closed',false,
      'access_revoke_executed',false
    );
  end if;

  if v_decision = 'reject' then
    v_result_key := left('hrisk57:rejected:' || p_proposal_id::text, 200);
    insert into public.os_hr_it_high_risk_phase57_proposals (
      proposal_key, source_proposal_id, entity_id, action_kind,
      summary, proposed_by, status, block_reason, metrics_sha256, detail
    ) values (
      v_result_key, p_proposal_id, v_proposal.entity_id, v_proposal.action_kind,
      v_proposal.summary, v_proposal.proposed_by, 'rejected',
      'rejected_by_approver',
      public.os_sha256_hex('reject:' || p_proposal_id::text),
      v_meta || jsonb_build_object(
        'contract_version','phase57-v1',
        'breaker_auto_closed',false,
        'access_revoke_executed',false,
        'dual_approve_required',true
      )
    )
    on conflict (proposal_key) do nothing;
    return jsonb_build_object(
      'version','phase57-v1',
      'disposition','rejected',
      'status','rejected',
      'proposal_id',p_proposal_id,
      'breaker_auto_closed',false,
      'access_revoke_executed',false
    );
  end if;

  select count(distinct actor_id)::integer into v_distinct_approvers
  from public.os_hr_it_high_risk_phase57_approvals
  where proposal_id = p_proposal_id
    and decision = 'approve'
    and actor_id <> v_proposal.proposed_by;

  if v_distinct_approvers < 2 then
    return jsonb_build_object(
      'version','phase57-v1',
      'disposition','awaiting_second_approval',
      'status','pending',
      'proposal_id',p_proposal_id,
      'distinct_approvers',v_distinct_approvers,
      'breaker_auto_closed',false,
      'access_revoke_executed',false
    );
  end if;

  -- Dual-human gate satisfied. NEVER close breakers / revoke access from Tage.
  v_result_key := left('hrisk57:dual_approved:' || p_proposal_id::text, 200);
  insert into public.os_hr_it_high_risk_phase57_proposals (
    proposal_key, source_proposal_id, entity_id, action_kind,
    summary, proposed_by, status, metrics_sha256, detail
  ) values (
    v_result_key, p_proposal_id, v_proposal.entity_id, v_proposal.action_kind,
    v_proposal.summary, v_proposal.proposed_by, 'dual_approved',
    public.os_sha256_hex('dual_approved:' || p_proposal_id::text),
    v_meta || jsonb_build_object(
      'contract_version','phase57-v1',
      'breaker_auto_closed',false,
      'access_revoke_executed',false,
      'dual_approve_required',true,
      'dual_approved',true,
      'operator_must_execute_after_dual_approve',true
    )
  )
  on conflict (proposal_key) do nothing
  returning * into v_result_row;

  return jsonb_build_object(
    'version','phase57-v1',
    'disposition','dual_approved',
    'status','dual_approved',
    'proposal_id',coalesce(v_result_row.proposal_id,p_proposal_id),
    'source_proposal_id',p_proposal_id,
    'distinct_approvers',v_distinct_approvers,
    'breaker_auto_closed',false,
    'access_revoke_executed',false,
    'todo','Operator executes high-risk action after dual-approve (never auto-close breakers)'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- List dual-approve inbox with aging (reuse Phase 51 when present).
-- ---------------------------------------------------------------------------
create or replace function public.list_hr_it_dual_approve_inbox_phase57(
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_has_p51 boolean := false;
  v_inbox jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_pending integer := 0;
  v_stale integer := 0;
  v_critical integer := 0;
begin
  select exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'list_it_intune_dual_approve_inbox_phase51'
  ) into v_has_p51;

  if v_has_p51 then
    begin
      execute
        'select public.list_it_intune_dual_approve_inbox_phase51($1)'
      into v_inbox
      using v_limit;
    exception when others then
      v_inbox := '[]'::jsonb;
    end;
  end if;

  if jsonb_typeof(v_inbox) = 'object' and v_inbox ? 'items' then
    v_items := coalesce(v_inbox->'items', '[]'::jsonb);
  elsif jsonb_typeof(v_inbox) = 'array' then
    v_items := v_inbox;
  else
    v_items := '[]'::jsonb;
  end if;

  select count(*)::integer into v_pending
  from jsonb_array_elements(v_items) t;

  select count(*)::integer into v_stale
  from jsonb_array_elements(v_items) t
  where coalesce((t.value->>'awaiting_since')::timestamptz, now())
        < now() - interval '24 hours';

  select count(*)::integer into v_critical
  from jsonb_array_elements(v_items) t
  where coalesce((t.value->>'awaiting_since')::timestamptz, now())
        < now() - interval '72 hours';

  return jsonb_build_object(
    'items', v_items,
    'pending_count', v_pending,
    'stale_count', v_stale,
    'critical_count', v_critical,
    'stale_threshold_hours', 24,
    'critical_threshold_hours', 72,
    'reuses_phase51_inbox', v_has_p51,
    'breaker_auto_closed', false,
    'dual_approve_required', true,
    'contract_version', 'phase57-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Refresh HR + IT hardening board (observe + evidence only).
-- Never auto-closes breakers. Never silently revokes access.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_hr_it_hardening_phase57(
  p_actor_id uuid default null,
  p_entity_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := nullif(trim(coalesce(p_entity_id,'')),'');
  v_onb_open integer := 0;
  v_onb_done integer := 0;
  v_off_open integer := 0;
  v_off_done integer := 0;
  v_id_open integer := 0;
  v_hw_assigned integer := 0;
  v_hw_stock integer := 0;
  v_lic_used integer := 0;
  v_lic_total integer := 0;
  v_rev_pending integer := 0;
  v_completeness numeric(5,2);
  v_board text := 'missing';
  v_asg_status text := 'missing';
  v_inbox jsonb;
  v_pending_inbox integer := 0;
  v_stale_inbox integer := 0;
  v_critical_inbox integer := 0;
  v_pending_hrisk integer := 0;
  v_window text;
  v_hash text;
  v_id uuid;
  v_has_onb boolean := false;
  v_has_off boolean := false;
  v_has_hw boolean := false;
  v_has_lic boolean := false;
  v_has_idlife boolean := false;
  v_r619_runs boolean := false;
  v_inda_runs boolean := false;
  v_den integer := 0;
  v_num integer := 0;
begin
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 57 HR/IT refresh';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 57 HR/IT refresh';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is null then
    raise exception 'Firm-wide access or entity filter required for Phase 57 HR/IT refresh';
  end if;

  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_it_onboarding_runs'
  ) into v_has_onb;
  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_it_offboarding_runs'
  ) into v_has_off;
  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_it_hardware_assets'
  ) into v_has_hw;
  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_it_software_licenses'
  ) into v_has_lic;
  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_identity_lifecycle_runs'
  ) into v_has_idlife;

  if v_has_onb then
    begin
      execute
        'select count(*) filter (where status in (''open'',''in_progress''))::integer,
                count(*) filter (where status = ''completed'')::integer
         from public.os_it_onboarding_runs
         where ($1::text is null or entity_id = $1 or entity_id is null)'
      into v_onb_open, v_onb_done
      using v_entity;
    exception when others then
      v_onb_open := 0;
      v_onb_done := 0;
    end;
  end if;

  if v_has_off then
    begin
      execute
        'select count(*) filter (where status in (''open'',''in_progress''))::integer,
                count(*) filter (where status = ''completed'')::integer
         from public.os_it_offboarding_runs
         where ($1::text is null or entity_id = $1 or entity_id is null)'
      into v_off_open, v_off_done
      using v_entity;
    exception when others then
      v_off_open := 0;
      v_off_done := 0;
    end;
  end if;

  if v_has_idlife then
    begin
      execute
        'select count(*) filter (
           where status in (''open'',''in_progress'',''pending'')
         )::integer
         from public.os_identity_lifecycle_runs
         where ($1::text is null or home_entity_id = $1)'
      into v_id_open
      using v_entity;
    exception when others then
      v_id_open := 0;
    end;
  end if;

  if v_has_hw then
    begin
      execute
        'select count(*) filter (where status = ''assigned'')::integer,
                count(*) filter (where status = ''in_stock'')::integer
         from public.os_it_hardware_assets
         where ($1::text is null or entity_id = $1 or entity_id is null)'
      into v_hw_assigned, v_hw_stock
      using v_entity;
    exception when others then
      v_hw_assigned := 0;
      v_hw_stock := 0;
    end;
  end if;

  if v_has_lic then
    begin
      execute
        'select coalesce(sum(coalesce(seats_used,0)),0)::integer,
                coalesce(sum(coalesce(seat_count,0)),0)::integer
         from public.os_it_software_licenses
         where ($1::text is null or entity_id = $1 or entity_id is null)'
      into v_lic_used, v_lic_total
      using v_entity;
    exception when others then
      v_lic_used := 0;
      v_lic_total := 0;
    end;
  end if;

  v_den := coalesce(v_onb_open,0) + coalesce(v_onb_done,0)
         + coalesce(v_off_open,0) + coalesce(v_off_done,0);
  v_num := coalesce(v_onb_done,0) + coalesce(v_off_done,0);

  if v_den > 0 then
    v_completeness := round((v_num::numeric / v_den::numeric) * 100, 2);
    if v_completeness >= 90 and coalesce(v_onb_open,0) + coalesce(v_off_open,0) = 0 then
      v_board := 'ok';
    elsif v_num > 0 or coalesce(v_onb_open,0) + coalesce(v_off_open,0) > 0 then
      v_board := 'partial';
    else
      v_board := 'missing';
    end if;
  else
    -- TODO: seed onboarding/offboarding runs when HR tickets arrive.
    v_board := 'missing';
    v_completeness := null;
  end if;

  if coalesce(v_hw_assigned,0) + coalesce(v_lic_used,0) > 0 then
    if coalesce(v_hw_stock,0) = 0 and coalesce(v_lic_total,0) > 0 then
      v_asg_status := 'ok';
    else
      v_asg_status := 'partial';
    end if;
  elsif v_has_hw or v_has_lic then
    v_asg_status := 'partial';
  else
    v_asg_status := 'missing';
  end if;

  v_inbox := public.list_hr_it_dual_approve_inbox_phase57(100);
  v_pending_inbox := coalesce((v_inbox->>'pending_count')::integer, 0);
  v_stale_inbox := coalesce((v_inbox->>'stale_count')::integer, 0);
  v_critical_inbox := coalesce((v_inbox->>'critical_count')::integer, 0);

  select count(*)::integer into v_pending_hrisk
  from public.os_hr_it_high_risk_phase57_proposals p
  where p.status = 'pending'
    and p.source_proposal_id is null
    and (v_entity is null or p.entity_id = v_entity)
    and not exists (
      select 1
      from public.os_hr_it_high_risk_phase57_proposals c
      where c.source_proposal_id = p.proposal_id
        and c.status in ('dual_approved','rejected','blocked','superseded')
    );

  select count(*)::integer into v_rev_pending
  from public.os_hr_it_access_revocation_phase57_evidence e
  where e.evidence_status in ('pending_dual_approve','observed')
    and (v_entity is null or e.entity_id = v_entity);

  -- Assignment visibility evidence
  insert into public.os_hr_it_assignment_visibility_phase57_events (
    entity_id, hardware_assigned, hardware_in_stock,
    license_seats_used, license_seats_total, visibility_status,
    window_key, metrics_sha256, detail
  ) values (
    v_entity,
    coalesce(v_hw_assigned,0), coalesce(v_hw_stock,0),
    coalesce(v_lic_used,0), coalesce(v_lic_total,0), v_asg_status,
    left(
      'phase57:asg:' || coalesce(v_entity,'firm') || ':'
        || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24'),
      200
    ),
    public.os_sha256_hex(
      'asg|' || coalesce(v_entity,'firm') || '|' || v_asg_status || '|'
      || coalesce(v_hw_assigned,0)::text
    ),
    jsonb_build_object(
      'contract_version','phase57-v1',
      'breaker_auto_closed',false,
      'source','refresh_hr_it_hardening_phase57'
    )
  ) on conflict (window_key) do nothing;

  -- Inbox usability snapshot
  insert into public.os_hr_it_dual_approve_inbox_phase57_snapshots (
    entity_id, window_key, pending_count, stale_count, critical_count,
    metrics_sha256, detail, actor_id
  ) values (
    v_entity,
    left(
      'phase57:inbox:' || coalesce(v_entity,'firm') || ':'
        || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24'),
      200
    ),
    v_pending_inbox, v_stale_inbox, v_critical_inbox,
    public.os_sha256_hex(
      'inbox|' || coalesce(v_entity,'firm') || '|' || v_pending_inbox::text
      || '|' || v_stale_inbox::text
    ),
    jsonb_build_object(
      'contract_version','phase57-v1',
      'reuses_phase51_inbox', coalesce((v_inbox->>'reuses_phase51_inbox')::boolean,false),
      'breaker_auto_closed', false,
      'dual_approve_required', true,
      'stale_threshold_hours', 24,
      'critical_threshold_hours', 72
    ),
    p_actor_id
  ) on conflict (window_key) do nothing;

  -- Exception aging alerts
  if coalesce(v_onb_open,0) > 0 then
    insert into public.os_hr_it_exception_aging_phase57_alerts (
      entity_id, alert_kind, severity, title, age_hours,
      window_key, metrics_sha256, detail
    ) values (
      v_entity, 'onboarding_aging', 'warning',
      'Open onboarding runs require completeness review',
      0,
      left(
        'phase57:age:onb:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      public.os_sha256_hex('age|onb|' || coalesce(v_onb_open,0)::text),
      jsonb_build_object(
        'contract_version','phase57-v1',
        'open_count', v_onb_open,
        'breaker_auto_closed', false
      )
    ) on conflict (window_key) do nothing;
  end if;

  if coalesce(v_off_open,0) > 0 then
    insert into public.os_hr_it_exception_aging_phase57_alerts (
      entity_id, alert_kind, severity, title, age_hours,
      window_key, metrics_sha256, detail
    ) values (
      v_entity, 'offboarding_aging', 'warning',
      'Open offboarding runs require completeness / revocation review',
      0,
      left(
        'phase57:age:off:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      public.os_sha256_hex('age|off|' || coalesce(v_off_open,0)::text),
      jsonb_build_object(
        'contract_version','phase57-v1',
        'open_count', v_off_open,
        'breaker_auto_closed', false
      )
    ) on conflict (window_key) do nothing;
  end if;

  if v_stale_inbox > 0 then
    insert into public.os_hr_it_exception_aging_phase57_alerts (
      entity_id, alert_kind, severity, title, age_hours,
      window_key, metrics_sha256, detail
    ) values (
      v_entity, 'inbox_stale',
      case when v_critical_inbox > 0 then 'critical' else 'warning' end,
      'Intune dual-approve inbox items are aging past SLA',
      24,
      left(
        'phase57:age:inbox:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      public.os_sha256_hex('age|inbox|' || v_stale_inbox::text),
      jsonb_build_object(
        'contract_version','phase57-v1',
        'stale_count', v_stale_inbox,
        'critical_count', v_critical_inbox,
        'breaker_auto_closed', false,
        'dual_approve_required', true
      )
    ) on conflict (window_key) do nothing;

    perform public.record_hr_it_escalation_phase57(
      jsonb_build_object(
        'entity_id', v_entity,
        'escalation_kind', 'inbox_stale',
        'title', 'Escalate stale Intune dual-approve inbox items',
        'status', 'escalated',
        'actor_id', p_actor_id,
        'detail', jsonb_build_object(
          'stale_count', v_stale_inbox,
          'critical_count', v_critical_inbox,
          'source', 'refresh_hr_it_hardening_phase57'
        )
      )
    );
  end if;

  -- Access revocation observe stub when offboarding open
  if coalesce(v_off_open,0) > 0 then
    insert into public.os_hr_it_access_revocation_phase57_evidence (
      entity_id, run_id, user_ref, revocation_kind, evidence_status,
      window_key, metrics_sha256, detail, actor_id
    ) values (
      v_entity, null, null, 'other_observe', 'observed',
      left(
        'phase57:rev:observe:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      public.os_sha256_hex('rev|observe|' || coalesce(v_off_open,0)::text),
      jsonb_build_object(
        'contract_version','phase57-v1',
        'offboarding_open', v_off_open,
        'access_revoke_executed', false,
        'dual_approve_required', true,
        'todo', 'TODO: attach per-run revocation checklist evidence'
      ),
      p_actor_id
    ) on conflict (window_key) do nothing;
  end if;

  -- Subsidiary probes (fail-soft)
  begin
    if v_has_onb then
      execute
        'select exists (
           select 1 from public.os_it_onboarding_runs where entity_id = ''ENT-R619''
         ),
         exists (
           select 1 from public.os_it_onboarding_runs where entity_id = ''ENT-INDA''
         )'
      into v_r619_runs, v_inda_runs;
    end if;
  exception when others then
    v_r619_runs := false;
    v_inda_runs := false;
  end;

  if not v_r619_runs and v_has_off then
    begin
      execute
        'select exists (
           select 1 from public.os_it_offboarding_runs where entity_id = ''ENT-R619''
         )'
      into v_r619_runs;
    exception when others then
      v_r619_runs := false;
    end;
  end if;

  insert into public.os_hr_it_subsidiary_phase57_events (
    entity_id, open_runs, aging_alerts, visibility_status,
    window_key, metrics_sha256, detail
  ) values (
    'ENT-R619',
    case when v_r619_runs then 1 else 0 end,
    0,
    case when v_r619_runs then 'partial' else 'missing' end,
    left(
      'phase57:sub:ENT-R619:' || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24'),
      200
    ),
    public.os_sha256_hex('sub|ENT-R619|' || v_r619_runs::text),
    jsonb_build_object(
      'contract_version','phase57-v1',
      'name','Recruit 619',
      'priority',1,
      'todo', case when v_r619_runs then null
                   else 'TODO: wire Recruit HR/IT run feed'
              end,
      'breaker_auto_closed', false
    )
  ) on conflict (window_key) do nothing;

  insert into public.os_hr_it_subsidiary_phase57_events (
    entity_id, open_runs, aging_alerts, visibility_status,
    window_key, metrics_sha256, detail
  ) values (
    'ENT-INDA',
    case when v_inda_runs then 1 else 0 end,
    0,
    case when v_inda_runs then 'partial' else 'missing' end,
    left(
      'phase57:sub:ENT-INDA:' || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24'),
      200
    ),
    public.os_sha256_hex('sub|ENT-INDA|' || v_inda_runs::text),
    jsonb_build_object(
      'contract_version','phase57-v1',
      'name','Instant NDA',
      'priority',2,
      'todo', case when v_inda_runs then null
                   else 'TODO: show ENT-INDA HR/IT runs when evidence exists'
              end,
      'breaker_auto_closed', false
    )
  ) on conflict (window_key) do nothing;

  if v_board in ('missing','partial') then
    insert into public.os_hr_it_phase57_ops_alerts (
      entity_id, alert_kind, window_key, severity, metrics_sha256, detail
    ) values (
      v_entity, 'run_completeness_gap',
      left(
        'phase57:alert:run_gap:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      'warning',
      public.os_sha256_hex('run_gap|' || coalesce(v_entity,'firm') || '|' || v_board),
      jsonb_build_object(
        'contract_version','phase57-v1',
        'board_status', v_board,
        'breaker_auto_closed', false
      )
    ) on conflict (window_key) do nothing;
  end if;

  if coalesce(v_pending_hrisk,0) > 0 then
    insert into public.os_hr_it_phase57_ops_alerts (
      entity_id, alert_kind, window_key, severity, metrics_sha256, detail
    ) values (
      v_entity, 'dual_approve_required',
      left(
        'phase57:alert:hrisk_pending:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      'warning',
      public.os_sha256_hex('hrisk|' || coalesce(v_pending_hrisk,0)::text),
      jsonb_build_object(
        'contract_version','phase57-v1',
        'pending_count', v_pending_hrisk,
        'breaker_auto_closed', false,
        'access_revoke_executed', false
      )
    ) on conflict (window_key) do nothing;
  end if;

  v_window := left(
    'phase57:run:' || coalesce(v_entity,'firm') || ':'
      || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24'),
    200
  );
  v_hash := public.os_sha256_hex(
    coalesce(v_entity,'firm') || '|' || coalesce(v_onb_open,0)::text || '|'
    || coalesce(v_off_open,0)::text || '|' || v_board || '|' || v_window
  );

  insert into public.os_hr_it_run_completeness_phase57_snapshots (
    entity_id, window_key, onboarding_open, onboarding_completed,
    offboarding_open, offboarding_completed, identity_lifecycle_open,
    completeness_pct, board_status, metrics_sha256, detail, actor_id
  ) values (
    v_entity, v_window,
    coalesce(v_onb_open,0), coalesce(v_onb_done,0),
    coalesce(v_off_open,0), coalesce(v_off_done,0),
    coalesce(v_id_open,0),
    v_completeness, v_board, v_hash,
    jsonb_build_object(
      'contract_version','phase57-v1',
      'source','refresh_hr_it_hardening_phase57',
      'assignment_visibility_status', v_asg_status,
      'hardware_assigned', coalesce(v_hw_assigned,0),
      'hardware_in_stock', coalesce(v_hw_stock,0),
      'license_seats_used', coalesce(v_lic_used,0),
      'license_seats_total', coalesce(v_lic_total,0),
      'pending_high_risk_count', coalesce(v_pending_hrisk,0),
      'inbox_pending_count', v_pending_inbox,
      'inbox_stale_count', v_stale_inbox,
      'inbox_critical_count', v_critical_inbox,
      'revocation_pending_count', coalesce(v_rev_pending,0),
      'breaker_auto_closed', false,
      'access_revoke_executed', false,
      'dual_approve_required', true,
      'reuses_identity_lifecycle_p5', v_has_idlife,
      'reuses_phase51_inbox', coalesce((v_inbox->>'reuses_phase51_inbox')::boolean,false),
      'subsidiary_hint','ENT-R619'
    ),
    p_actor_id
  )
  on conflict (window_key) do nothing
  returning snapshot_id into v_id;

  if v_id is null then
    select snapshot_id into v_id
    from public.os_hr_it_run_completeness_phase57_snapshots
    where window_key = v_window;
  end if;

  return jsonb_build_object(
    'snapshot_id', v_id,
    'entity_id', v_entity,
    'onboarding_open', coalesce(v_onb_open,0),
    'onboarding_completed', coalesce(v_onb_done,0),
    'offboarding_open', coalesce(v_off_open,0),
    'offboarding_completed', coalesce(v_off_done,0),
    'identity_lifecycle_open', coalesce(v_id_open,0),
    'completeness_pct', v_completeness,
    'board_status', v_board,
    'assignment_visibility_status', v_asg_status,
    'hardware_assigned', coalesce(v_hw_assigned,0),
    'hardware_in_stock', coalesce(v_hw_stock,0),
    'license_seats_used', coalesce(v_lic_used,0),
    'license_seats_total', coalesce(v_lic_total,0),
    'pending_high_risk_count', coalesce(v_pending_hrisk,0),
    'inbox_pending_count', v_pending_inbox,
    'inbox_stale_count', v_stale_inbox,
    'inbox_critical_count', v_critical_inbox,
    'breaker_auto_closed', false,
    'access_revoke_executed', false,
    'dual_approve_required', true,
    'never_auto_close_breakers', true,
    'contract_version', 'phase57-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Report: HR + IT hardening board.
-- ---------------------------------------------------------------------------
create or replace function public.get_hr_it_hardening_phase57_report(
  p_entity_id text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_entity text := nullif(trim(coalesce(p_entity_id,'')),'');
  v_latest public.os_hr_it_run_completeness_phase57_snapshots%rowtype;
  v_aging jsonb := '[]'::jsonb;
  v_escalations jsonb := '[]'::jsonb;
  v_proposals jsonb := '[]'::jsonb;
  v_revocations jsonb := '[]'::jsonb;
  v_ops_alerts jsonb := '[]'::jsonb;
  v_subsidiaries jsonb := '[]'::jsonb;
  v_inbox jsonb;
  v_asg public.os_hr_it_assignment_visibility_phase57_events%rowtype;
  v_r619 public.os_hr_it_subsidiary_phase57_events%rowtype;
  v_inda public.os_hr_it_subsidiary_phase57_events%rowtype;
begin
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 57 HR/IT report';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 57 HR/IT report';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is null then
    raise exception 'Firm-wide access or entity filter required for Phase 57 HR/IT report';
  end if;

  select * into v_latest
  from public.os_hr_it_run_completeness_phase57_snapshots s
  where (v_entity is null and s.entity_id is null)
     or (v_entity is not null and s.entity_id = v_entity)
  order by s.created_at desc
  limit 1;

  select * into v_asg
  from public.os_hr_it_assignment_visibility_phase57_events e
  where (v_entity is null and e.entity_id is null)
     or (v_entity is not null and e.entity_id = v_entity)
  order by e.created_at desc
  limit 1;

  v_inbox := public.list_hr_it_dual_approve_inbox_phase57(50);

  select coalesce(jsonb_agg(row_to_json(a)::jsonb order by a.created_at desc), '[]'::jsonb)
  into v_aging
  from (
    select al.alert_id, al.entity_id, al.alert_kind, al.severity,
           al.title, al.age_hours, al.created_at
    from public.os_hr_it_exception_aging_phase57_alerts al
    where (v_entity is null or al.entity_id = v_entity)
    order by al.created_at desc
    limit 40
  ) a;

  select coalesce(jsonb_agg(row_to_json(e)::jsonb order by e.created_at desc), '[]'::jsonb)
  into v_escalations
  from (
    select esc.event_id, esc.entity_id, esc.escalation_kind, esc.reference_id,
           esc.title, esc.status, esc.created_at
    from public.os_hr_it_escalation_phase57_events esc
    where (v_entity is null or esc.entity_id = v_entity)
    order by esc.created_at desc
    limit 40
  ) e;

  select coalesce(jsonb_agg(row_to_json(p)::jsonb order by p.created_at desc), '[]'::jsonb)
  into v_proposals
  from (
    select pr.proposal_id, pr.entity_id, pr.action_kind, pr.summary,
           pr.proposed_by, pr.status, pr.created_at
    from public.os_hr_it_high_risk_phase57_proposals pr
    where (v_entity is null or pr.entity_id = v_entity)
      and (
        (
          pr.status = 'pending'
          and pr.source_proposal_id is null
          and not exists (
            select 1
            from public.os_hr_it_high_risk_phase57_proposals c
            where c.source_proposal_id = pr.proposal_id
              and c.status in ('dual_approved','rejected','blocked','superseded')
          )
        )
        or (
          pr.status in ('dual_approved','rejected','blocked')
          and pr.source_proposal_id is not null
        )
      )
    order by pr.created_at desc
    limit 40
  ) p;

  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.created_at desc), '[]'::jsonb)
  into v_revocations
  from (
    select ev.evidence_id, ev.entity_id, ev.run_id, ev.user_ref,
           ev.revocation_kind, ev.evidence_status, ev.created_at
    from public.os_hr_it_access_revocation_phase57_evidence ev
    where (v_entity is null or ev.entity_id = v_entity)
    order by ev.created_at desc
    limit 40
  ) r;

  select coalesce(jsonb_agg(row_to_json(o)::jsonb order by o.created_at desc), '[]'::jsonb)
  into v_ops_alerts
  from (
    select oa.alert_id, oa.alert_kind, oa.severity, oa.entity_id, oa.created_at
    from public.os_hr_it_phase57_ops_alerts oa
    where (v_entity is null or oa.entity_id = v_entity)
    order by oa.created_at desc
    limit 12
  ) o;

  select * into v_r619
  from public.os_hr_it_subsidiary_phase57_events e
  where e.entity_id = 'ENT-R619'
  order by e.created_at desc
  limit 1;

  select * into v_inda
  from public.os_hr_it_subsidiary_phase57_events e
  where e.entity_id = 'ENT-INDA'
  order by e.created_at desc
  limit 1;

  v_subsidiaries := jsonb_build_array(
    jsonb_build_object(
      'entity_id', 'ENT-R619',
      'name', 'Recruit 619',
      'priority', 1,
      'visibility_status', coalesce(v_r619.visibility_status, 'missing'),
      'open_runs', coalesce(v_r619.open_runs, 0),
      'aging_alerts', coalesce(v_r619.aging_alerts, 0),
      'has_data', coalesce(v_r619.visibility_status,'missing') in ('ok','partial'),
      'todo', coalesce(v_r619.detail->>'todo',
        'TODO: wire Recruit HR/IT run feed')
    ),
    jsonb_build_object(
      'entity_id', 'ENT-INDA',
      'name', 'Instant NDA',
      'priority', 2,
      'visibility_status', coalesce(v_inda.visibility_status, 'missing'),
      'open_runs', coalesce(v_inda.open_runs, 0),
      'aging_alerts', coalesce(v_inda.aging_alerts, 0),
      'has_data', coalesce(v_inda.visibility_status,'missing') in ('ok','partial'),
      'todo', coalesce(v_inda.detail->>'todo',
        'TODO: show ENT-INDA HR/IT runs when evidence exists')
    )
  );

  if v_latest.snapshot_id is null then
    return jsonb_build_object(
      'entity_id', v_entity,
      'onboarding_open', 0,
      'onboarding_completed', 0,
      'offboarding_open', 0,
      'offboarding_completed', 0,
      'identity_lifecycle_open', 0,
      'completeness_pct', null,
      'board_status', 'missing',
      'assignment_visibility_status', coalesce(v_asg.visibility_status, 'missing'),
      'hardware_assigned', coalesce(v_asg.hardware_assigned, 0),
      'hardware_in_stock', coalesce(v_asg.hardware_in_stock, 0),
      'license_seats_used', coalesce(v_asg.license_seats_used, 0),
      'license_seats_total', coalesce(v_asg.license_seats_total, 0),
      'pending_high_risk_count', 0,
      'inbox_pending_count', coalesce((v_inbox->>'pending_count')::integer, 0),
      'inbox_stale_count', coalesce((v_inbox->>'stale_count')::integer, 0),
      'inbox_critical_count', coalesce((v_inbox->>'critical_count')::integer, 0),
      'snapshot_id', null,
      'captured_at', null,
      'aging_alerts', v_aging,
      'escalations', v_escalations,
      'high_risk_proposals', v_proposals,
      'revocation_evidence', v_revocations,
      'inbox_items', coalesce(v_inbox->'items', '[]'::jsonb),
      'recent_alerts', v_ops_alerts,
      'subsidiaries', v_subsidiaries,
      'entity_filter_hint', 'ENT-R619',
      'todo', 'Refresh HR + IT hardening board; complete open onboarding/offboarding runs',
      'breaker_auto_closed', false,
      'access_revoke_executed', false,
      'dual_approve_required', true,
      'never_auto_close_breakers', true,
      'contract_version', 'phase57-v1'
    );
  end if;

  return jsonb_build_object(
    'entity_id', v_entity,
    'onboarding_open', v_latest.onboarding_open,
    'onboarding_completed', v_latest.onboarding_completed,
    'offboarding_open', v_latest.offboarding_open,
    'offboarding_completed', v_latest.offboarding_completed,
    'identity_lifecycle_open', v_latest.identity_lifecycle_open,
    'completeness_pct', v_latest.completeness_pct,
    'board_status', v_latest.board_status,
    'assignment_visibility_status',
      coalesce(v_latest.detail->>'assignment_visibility_status',
               v_asg.visibility_status, 'missing'),
    'hardware_assigned',
      coalesce((v_latest.detail->>'hardware_assigned')::integer,
               v_asg.hardware_assigned, 0),
    'hardware_in_stock',
      coalesce((v_latest.detail->>'hardware_in_stock')::integer,
               v_asg.hardware_in_stock, 0),
    'license_seats_used',
      coalesce((v_latest.detail->>'license_seats_used')::integer,
               v_asg.license_seats_used, 0),
    'license_seats_total',
      coalesce((v_latest.detail->>'license_seats_total')::integer,
               v_asg.license_seats_total, 0),
    'pending_high_risk_count',
      coalesce((v_latest.detail->>'pending_high_risk_count')::integer, 0),
    'inbox_pending_count',
      coalesce((v_latest.detail->>'inbox_pending_count')::integer,
               (v_inbox->>'pending_count')::integer, 0),
    'inbox_stale_count',
      coalesce((v_latest.detail->>'inbox_stale_count')::integer,
               (v_inbox->>'stale_count')::integer, 0),
    'inbox_critical_count',
      coalesce((v_latest.detail->>'inbox_critical_count')::integer,
               (v_inbox->>'critical_count')::integer, 0),
    'snapshot_id', v_latest.snapshot_id,
    'captured_at', v_latest.created_at,
    'aging_alerts', v_aging,
    'escalations', v_escalations,
    'high_risk_proposals', v_proposals,
    'revocation_evidence', v_revocations,
    'inbox_items', coalesce(v_inbox->'items', '[]'::jsonb),
    'recent_alerts', v_ops_alerts,
    'subsidiaries', v_subsidiaries,
    'entity_filter_hint', 'ENT-R619',
    'todo', 'High-risk actions require dual-approve; never auto-close breakers',
    'breaker_auto_closed', false,
    'access_revoke_executed', false,
    'dual_approve_required', true,
    'never_auto_close_breakers', true,
    'contract_version', 'phase57-v1'
  );
end;
$$;

revoke all on function public.record_hr_it_escalation_phase57(jsonb)
  from public, anon, authenticated;
revoke all on function public.propose_hr_it_high_risk_phase57(jsonb)
  from public, anon, authenticated;
revoke all on function public.approve_hr_it_high_risk_phase57(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.list_hr_it_dual_approve_inbox_phase57(integer)
  from public, anon, authenticated;
revoke all on function public.refresh_hr_it_hardening_phase57(uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_hr_it_hardening_phase57_report(text)
  from public, anon, authenticated;

grant execute on function public.record_hr_it_escalation_phase57(jsonb)
  to authenticated, service_role;
grant execute on function public.propose_hr_it_high_risk_phase57(jsonb)
  to authenticated, service_role;
grant execute on function public.approve_hr_it_high_risk_phase57(uuid, uuid, text, jsonb)
  to authenticated, service_role;
grant execute on function public.list_hr_it_dual_approve_inbox_phase57(integer)
  to authenticated, service_role;
grant execute on function public.refresh_hr_it_hardening_phase57(uuid, text)
  to authenticated, service_role;
grant execute on function public.get_hr_it_hardening_phase57_report(text)
  to authenticated, service_role;
