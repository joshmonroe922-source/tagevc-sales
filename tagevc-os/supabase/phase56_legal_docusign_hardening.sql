-- Phase 56: Legal / DocuSign Production Hardening.
-- Template governance completeness, capital send dual-approve gates,
-- archive integrity alerts, quarterly process monitoring, and subsidiary
-- legal request visibility (ENT-R619 / ENT-INDA).
-- Apply after Phase 55. Safe to re-run.
-- Append-only evidence only. Never create/void/resend envelopes.
-- Capital docs: propose + dual-approve only — never silent send.
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

create or replace function public.phase56_legal_safe_detail(p_detail jsonb)
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

create or replace function public.reject_legal_phase56_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Legal / DocuSign Phase 56 evidence is append-only';
end;
$$;

-- ---------------------------------------------------------------------------
-- Template governance completeness snapshots (append-only).
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_template_gov_phase56_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  templates_cached integer not null default 0 check (templates_cached >= 0),
  templates_with_roles integer not null default 0 check (templates_with_roles >= 0),
  templates_stale integer not null default 0 check (templates_stale >= 0),
  completeness_pct numeric(5,2)
    check (completeness_pct is null or (completeness_pct >= 0 and completeness_pct <= 100)),
  governance_status text not null default 'unknown'
    check (governance_status in ('ok','partial','missing','unknown')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_ds_tg_p56_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=8192
      and public.phase56_legal_safe_detail(detail)
    ),
  constraint os_ds_tg_p56_no_envelope_mutate_check
    check (coalesce((detail->>'never_creates_voids_or_resends')::boolean,true)=true)
);

create index if not exists os_ds_tg_p56_entity_created_idx
  on public.os_docusign_template_gov_phase56_snapshots(entity_id, created_at desc);
create index if not exists os_ds_tg_p56_created_idx
  on public.os_docusign_template_gov_phase56_snapshots(created_at desc);

alter table public.os_docusign_template_gov_phase56_snapshots enable row level security;
drop policy if exists "os_ds_tg_p56_select"
  on public.os_docusign_template_gov_phase56_snapshots;
create policy "os_ds_tg_p56_select"
  on public.os_docusign_template_gov_phase56_snapshots for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_docusign_template_gov_phase56_snapshots
  from public, anon, authenticated;
grant select on public.os_docusign_template_gov_phase56_snapshots
  to authenticated;

drop trigger if exists os_ds_tg_p56_immutable
  on public.os_docusign_template_gov_phase56_snapshots;
create trigger os_ds_tg_p56_immutable
  before update or delete on public.os_docusign_template_gov_phase56_snapshots
  for each row execute function public.reject_legal_phase56_mutation();
drop trigger if exists os_ds_tg_p56_no_truncate
  on public.os_docusign_template_gov_phase56_snapshots;
create trigger os_ds_tg_p56_no_truncate
  before truncate on public.os_docusign_template_gov_phase56_snapshots
  for each statement execute function public.reject_legal_phase56_mutation();

-- ---------------------------------------------------------------------------
-- Capital send proposals + dual-approve (NEVER silent send / NEVER execute).
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_capital_send_phase56_proposals (
  proposal_id uuid primary key default gen_random_uuid(),
  proposal_key text not null unique
    check (proposal_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  template_id text,
  doc_id text,
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
  constraint os_ds_cap_p56_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=8192
      and public.phase56_legal_safe_detail(detail)
    ),
  constraint os_ds_cap_p56_no_silent_send_check
    check (coalesce((detail->>'envelope_send_executed')::boolean,false)=false),
  constraint os_ds_cap_p56_dual_required_check
    check (coalesce((detail->>'dual_approve_required')::boolean,true)=true)
);

create unique index if not exists os_ds_cap_p56_one_pending_per_key
  on public.os_docusign_capital_send_phase56_proposals(proposal_key)
  where status = 'pending';

create index if not exists os_ds_cap_p56_status_created_idx
  on public.os_docusign_capital_send_phase56_proposals(status, created_at desc);
create index if not exists os_ds_cap_p56_entity_idx
  on public.os_docusign_capital_send_phase56_proposals(entity_id, created_at desc);

alter table public.os_docusign_capital_send_phase56_proposals enable row level security;
drop policy if exists "os_ds_cap_p56_select"
  on public.os_docusign_capital_send_phase56_proposals;
create policy "os_ds_cap_p56_select"
  on public.os_docusign_capital_send_phase56_proposals for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_docusign_capital_send_phase56_proposals
  from public, anon, authenticated;
grant select on public.os_docusign_capital_send_phase56_proposals
  to authenticated;

drop trigger if exists os_ds_cap_p56_immutable
  on public.os_docusign_capital_send_phase56_proposals;
create trigger os_ds_cap_p56_immutable
  before update or delete on public.os_docusign_capital_send_phase56_proposals
  for each row execute function public.reject_legal_phase56_mutation();
drop trigger if exists os_ds_cap_p56_no_truncate
  on public.os_docusign_capital_send_phase56_proposals;
create trigger os_ds_cap_p56_no_truncate
  before truncate on public.os_docusign_capital_send_phase56_proposals
  for each statement execute function public.reject_legal_phase56_mutation();

create table if not exists public.os_docusign_capital_send_phase56_approvals (
  approval_id uuid primary key default gen_random_uuid(),
  approval_key text not null unique
    check (approval_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  proposal_id uuid not null
    references public.os_docusign_capital_send_phase56_proposals(proposal_id),
  actor_id uuid not null,
  decision text not null check (decision in ('approve','reject')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_ds_cap_appr_p56_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase56_legal_safe_detail(detail)
    )
);

create index if not exists os_ds_cap_appr_p56_proposal_idx
  on public.os_docusign_capital_send_phase56_approvals(proposal_id, created_at desc);

alter table public.os_docusign_capital_send_phase56_approvals enable row level security;
drop policy if exists "os_ds_cap_appr_p56_select"
  on public.os_docusign_capital_send_phase56_approvals;
create policy "os_ds_cap_appr_p56_select"
  on public.os_docusign_capital_send_phase56_approvals for select to authenticated
  using (true);
revoke all on public.os_docusign_capital_send_phase56_approvals
  from public, anon, authenticated;
grant select on public.os_docusign_capital_send_phase56_approvals
  to authenticated;

drop trigger if exists os_ds_cap_appr_p56_immutable
  on public.os_docusign_capital_send_phase56_approvals;
create trigger os_ds_cap_appr_p56_immutable
  before update or delete on public.os_docusign_capital_send_phase56_approvals
  for each row execute function public.reject_legal_phase56_mutation();
drop trigger if exists os_ds_cap_appr_p56_no_truncate
  on public.os_docusign_capital_send_phase56_approvals;
create trigger os_ds_cap_appr_p56_no_truncate
  before truncate on public.os_docusign_capital_send_phase56_approvals
  for each statement execute function public.reject_legal_phase56_mutation();

-- ---------------------------------------------------------------------------
-- Archive integrity alerts (monitoring only — never mutate envelopes).
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_integrity_phase56_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  alert_kind text not null
    check (alert_kind in (
      'drift_detected','quarantine_aging','hash_gap','scan_overdue',
      'integrity_unknown','manual_review_backlog'
    )),
  severity text not null default 'warning'
    check (severity in ('info','warning','critical')),
  title text not null check (char_length(title) between 2 and 240),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_ds_arch_p56_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase56_legal_safe_detail(detail)
    ),
  constraint os_ds_arch_p56_no_envelope_mutate_check
    check (coalesce((detail->>'never_creates_voids_or_resends')::boolean,true)=true)
);

create index if not exists os_ds_arch_p56_created_idx
  on public.os_docusign_archive_integrity_phase56_alerts(created_at desc);
create index if not exists os_ds_arch_p56_entity_idx
  on public.os_docusign_archive_integrity_phase56_alerts(entity_id, created_at desc);

alter table public.os_docusign_archive_integrity_phase56_alerts enable row level security;
drop policy if exists "os_ds_arch_p56_select"
  on public.os_docusign_archive_integrity_phase56_alerts;
create policy "os_ds_arch_p56_select"
  on public.os_docusign_archive_integrity_phase56_alerts for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_docusign_archive_integrity_phase56_alerts
  from public, anon, authenticated;
grant select on public.os_docusign_archive_integrity_phase56_alerts
  to authenticated;

drop trigger if exists os_ds_arch_p56_immutable
  on public.os_docusign_archive_integrity_phase56_alerts;
create trigger os_ds_arch_p56_immutable
  before update or delete on public.os_docusign_archive_integrity_phase56_alerts
  for each row execute function public.reject_legal_phase56_mutation();
drop trigger if exists os_ds_arch_p56_no_truncate
  on public.os_docusign_archive_integrity_phase56_alerts;
create trigger os_ds_arch_p56_no_truncate
  before truncate on public.os_docusign_archive_integrity_phase56_alerts
  for each statement execute function public.reject_legal_phase56_mutation();

-- ---------------------------------------------------------------------------
-- Quarterly process monitoring events (append-only orchestration).
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_quarterly_process_phase56_events (
  event_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  period_key text not null
    check (period_key ~ '^[0-9]{4}-Q[1-4]$'),
  step_key text not null
    check (step_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$'),
  step_label text not null check (char_length(step_label) between 2 and 200),
  status text not null
    check (status in ('open','in_progress','blocked','done','waived','overdue')),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_ds_qtr_p56_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase56_legal_safe_detail(detail)
    ),
  constraint os_ds_qtr_p56_no_envelope_mutate_check
    check (coalesce((detail->>'never_creates_voids_or_resends')::boolean,true)=true)
);

create index if not exists os_ds_qtr_p56_entity_created_idx
  on public.os_docusign_quarterly_process_phase56_events(entity_id, created_at desc);
create index if not exists os_ds_qtr_p56_period_idx
  on public.os_docusign_quarterly_process_phase56_events(period_key, created_at desc);

alter table public.os_docusign_quarterly_process_phase56_events enable row level security;
drop policy if exists "os_ds_qtr_p56_select"
  on public.os_docusign_quarterly_process_phase56_events;
create policy "os_ds_qtr_p56_select"
  on public.os_docusign_quarterly_process_phase56_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_docusign_quarterly_process_phase56_events
  from public, anon, authenticated;
grant select on public.os_docusign_quarterly_process_phase56_events
  to authenticated;

drop trigger if exists os_ds_qtr_p56_immutable
  on public.os_docusign_quarterly_process_phase56_events;
create trigger os_ds_qtr_p56_immutable
  before update or delete on public.os_docusign_quarterly_process_phase56_events
  for each row execute function public.reject_legal_phase56_mutation();
drop trigger if exists os_ds_qtr_p56_no_truncate
  on public.os_docusign_quarterly_process_phase56_events;
create trigger os_ds_qtr_p56_no_truncate
  before truncate on public.os_docusign_quarterly_process_phase56_events
  for each statement execute function public.reject_legal_phase56_mutation();

-- ---------------------------------------------------------------------------
-- Subsidiary legal request visibility evidence (ENT-R619 / ENT-INDA).
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_subsidiary_legal_phase56_events (
  event_id uuid primary key default gen_random_uuid(),
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  request_kind text not null
    check (request_kind in (
      'legal_ticket','contract_review','capital_packet','nda_request','other'
    )),
  open_count integer not null default 0 check (open_count >= 0),
  overdue_count integer not null default 0 check (overdue_count >= 0),
  visibility_status text not null default 'missing'
    check (visibility_status in ('ok','partial','missing','unknown')),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_ds_sub_p56_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase56_legal_safe_detail(detail)
    )
);

create index if not exists os_ds_sub_p56_entity_created_idx
  on public.os_docusign_subsidiary_legal_phase56_events(entity_id, created_at desc);

alter table public.os_docusign_subsidiary_legal_phase56_events enable row level security;
drop policy if exists "os_ds_sub_p56_select"
  on public.os_docusign_subsidiary_legal_phase56_events;
create policy "os_ds_sub_p56_select"
  on public.os_docusign_subsidiary_legal_phase56_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_docusign_subsidiary_legal_phase56_events
  from public, anon, authenticated;
grant select on public.os_docusign_subsidiary_legal_phase56_events
  to authenticated;

drop trigger if exists os_ds_sub_p56_immutable
  on public.os_docusign_subsidiary_legal_phase56_events;
create trigger os_ds_sub_p56_immutable
  before update or delete on public.os_docusign_subsidiary_legal_phase56_events
  for each row execute function public.reject_legal_phase56_mutation();
drop trigger if exists os_ds_sub_p56_no_truncate
  on public.os_docusign_subsidiary_legal_phase56_events;
create trigger os_ds_sub_p56_no_truncate
  before truncate on public.os_docusign_subsidiary_legal_phase56_events
  for each statement execute function public.reject_legal_phase56_mutation();

-- ---------------------------------------------------------------------------
-- Ops alerts (append-only visibility).
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_phase56_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  alert_kind text not null
    check (alert_kind in (
      'template_gov_gap','capital_send_pending','dual_approve_required',
      'archive_integrity','quarterly_overdue','refresh_failed',
      'subsidiary_legal_gap'
    )),
  reference_id uuid,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null default 'warning'
    check (severity in ('info','warning','critical')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_ds_ops_p56_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase56_legal_safe_detail(detail)
    ),
  constraint os_ds_ops_p56_no_envelope_mutate_check
    check (coalesce((detail->>'never_creates_voids_or_resends')::boolean,true)=true)
);

create index if not exists os_ds_ops_p56_created_idx
  on public.os_docusign_phase56_ops_alerts(created_at desc);

alter table public.os_docusign_phase56_ops_alerts enable row level security;
drop policy if exists "os_ds_ops_p56_select"
  on public.os_docusign_phase56_ops_alerts;
create policy "os_ds_ops_p56_select"
  on public.os_docusign_phase56_ops_alerts for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_docusign_phase56_ops_alerts
  from public, anon, authenticated;
grant select on public.os_docusign_phase56_ops_alerts
  to authenticated;

drop trigger if exists os_ds_ops_p56_immutable
  on public.os_docusign_phase56_ops_alerts;
create trigger os_ds_ops_p56_immutable
  before update or delete on public.os_docusign_phase56_ops_alerts
  for each row execute function public.reject_legal_phase56_mutation();
drop trigger if exists os_ds_ops_p56_no_truncate
  on public.os_docusign_phase56_ops_alerts;
create trigger os_ds_ops_p56_no_truncate
  before truncate on public.os_docusign_phase56_ops_alerts
  for each statement execute function public.reject_legal_phase56_mutation();

-- ---------------------------------------------------------------------------
-- Record a quarterly process monitoring event (never mutates envelopes).
-- ---------------------------------------------------------------------------
create or replace function public.record_quarterly_process_phase56(
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := nullif(trim(coalesce(p_payload->>'entity_id','')),'');
  v_period text := nullif(trim(coalesce(p_payload->>'period_key','')),'');
  v_step text := nullif(trim(coalesce(p_payload->>'step_key','')),'');
  v_label text := nullif(trim(coalesce(p_payload->>'step_label','')),'');
  v_status text := nullif(trim(coalesce(p_payload->>'status','')),'');
  v_actor uuid := nullif(p_payload->>'actor_id','')::uuid;
  v_meta jsonb := coalesce(p_payload->'detail', '{}'::jsonb);
  v_window text;
  v_hash text;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Phase 56 quarterly process payload must be a JSON object';
  end if;
  if v_period is null or v_period !~ '^[0-9]{4}-Q[1-4]$'
    or v_step is null or v_step !~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$'
    or v_label is null or char_length(v_label) < 2
    or v_status is null
    or v_status not in ('open','in_progress','blocked','done','waived','overdue')
    or not public.phase56_legal_safe_detail(v_meta) then
    raise exception 'Phase 56 quarterly process contract is invalid or unsafe';
  end if;
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 56 quarterly process';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 56 quarterly process';
  end if;

  v_window := left(
    'phase56:qtr:' || coalesce(v_entity,'firm') || ':' || v_period || ':'
      || v_step || ':' || v_status || ':'
      || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24MI'),
    200
  );
  v_hash := public.os_sha256_hex(
    coalesce(v_entity,'firm') || '|' || v_period || '|' || v_step || '|'
    || v_status || '|' || v_window
  );

  insert into public.os_docusign_quarterly_process_phase56_events (
    entity_id, period_key, step_key, step_label, status,
    window_key, metrics_sha256, detail, actor_id
  ) values (
    v_entity, v_period, v_step, left(v_label,200), v_status,
    v_window, v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase56-v1',
      'never_creates_voids_or_resends',true,
      'envelope_send_executed',false
    ),
    v_actor
  )
  on conflict (window_key) do nothing
  returning event_id into v_id;

  if v_id is null then
    select event_id into v_id
    from public.os_docusign_quarterly_process_phase56_events
    where window_key = v_window;
  end if;

  return jsonb_build_object(
    'event_id', v_id,
    'window_key', v_window,
    'status', v_status,
    'envelope_send_executed', false,
    'never_creates_voids_or_resends', true,
    'contract_version', 'phase56-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Propose a capital DocuSign send (NEVER executes — dual-approve gate only).
-- ---------------------------------------------------------------------------
create or replace function public.propose_capital_send_phase56(
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := nullif(trim(coalesce(p_payload->>'entity_id','')),'');
  v_template text := nullif(trim(coalesce(p_payload->>'template_id','')),'');
  v_doc text := nullif(trim(coalesce(p_payload->>'doc_id','')),'');
  v_summary text := nullif(trim(coalesce(p_payload->>'summary','')),'');
  v_actor uuid := nullif(p_payload->>'proposed_by','')::uuid;
  v_meta jsonb := coalesce(p_payload->'detail', '{}'::jsonb);
  v_key text;
  v_hash text;
  v_row public.os_docusign_capital_send_phase56_proposals%rowtype;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Phase 56 capital send proposal payload must be a JSON object';
  end if;
  if v_actor is null
    or v_summary is null or char_length(v_summary) < 2
    or (v_template is null and v_doc is null)
    or not public.phase56_legal_safe_detail(v_meta) then
    raise exception 'Phase 56 capital send proposal requires proposed_by, summary, template_id or doc_id, and safe detail';
  end if;
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 56 capital send proposal';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 56 capital send proposal';
  end if;

  -- Never silent-send capital docs from this gate.
  v_key := left(
    'cap56:' || coalesce(v_entity,'firm') || ':'
      || coalesce(v_template, v_doc, 'unknown') || ':'
      || public.os_sha256_hex(v_summary || '|' || v_actor::text),
    200
  );

  select * into v_row
  from public.os_docusign_capital_send_phase56_proposals
  where proposal_key = v_key and status = 'pending'
  order by created_at desc
  limit 1;
  if v_row.proposal_id is not null then
    return jsonb_build_object(
      'version','phase56-v1',
      'disposition','unchanged',
      'status','pending',
      'proposal_id',v_row.proposal_id,
      'proposal_key',v_row.proposal_key,
      'envelope_send_executed',false,
      'never_silent_send',true,
      'dual_approve_required',true
    );
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase56-v1',
    'kind','capital_send_proposal',
    'proposal_key',v_key,
    'entity_id',v_entity,
    'template_id',v_template,
    'doc_id',v_doc,
    'proposed_by',v_actor
  )::text);

  insert into public.os_docusign_capital_send_phase56_proposals (
    proposal_key, entity_id, template_id, doc_id, summary, proposed_by,
    status, metrics_sha256, detail
  ) values (
    v_key, v_entity, v_template, v_doc, left(v_summary,500), v_actor,
    'pending', v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase56-v1',
      'envelope_send_executed',false,
      'never_silent_send',true,
      'dual_approve_required',true,
      'never_creates_voids_or_resends',true,
      'operator_must_send_after_dual_approve',true
    )
  )
  on conflict (proposal_key) do nothing
  returning * into v_row;

  if v_row.proposal_id is null then
    select * into v_row
    from public.os_docusign_capital_send_phase56_proposals
    where proposal_key = v_key
    order by created_at desc
    limit 1;
    return jsonb_build_object(
      'version','phase56-v1',
      'disposition','unchanged',
      'status',v_row.status,
      'proposal_id',v_row.proposal_id,
      'proposal_key',v_row.proposal_key,
      'envelope_send_executed',false,
      'never_silent_send',true,
      'dual_approve_required',true
    );
  end if;

  insert into public.os_docusign_phase56_ops_alerts (
    entity_id, alert_kind, reference_id, window_key, severity,
    metrics_sha256, detail
  ) values (
    v_entity, 'dual_approve_required', v_row.proposal_id,
    left('phase56:alert:dual_approve:' || v_row.proposal_id::text, 200),
    'warning', v_hash,
    jsonb_build_object(
      'contract_version','phase56-v1',
      'envelope_send_executed',false,
      'never_creates_voids_or_resends',true,
      'proposal_id',v_row.proposal_id
    )
  ) on conflict (window_key) do nothing;

  return jsonb_build_object(
    'version','phase56-v1',
    'disposition','proposed',
    'status','pending',
    'proposal_id',v_row.proposal_id,
    'proposal_key',v_row.proposal_key,
    'envelope_send_executed',false,
    'never_silent_send',true,
    'dual_approve_required',true
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Dual-human approval for capital send proposals.
-- After 2 DISTINCT approvers (neither is the proposer), status becomes
-- dual_approved. Tage NEVER creates/sends the envelope — operator sends.
-- ---------------------------------------------------------------------------
create or replace function public.approve_capital_send_phase56(
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
  v_proposal public.os_docusign_capital_send_phase56_proposals%rowtype;
  v_approval_key text;
  v_hash text;
  v_id uuid;
  v_distinct_approvers integer := 0;
  v_result_key text;
  v_result_row public.os_docusign_capital_send_phase56_proposals%rowtype;
begin
  if p_proposal_id is null or p_actor_id is null
    or v_decision not in ('approve','reject')
    or not public.phase56_legal_safe_detail(v_meta) then
    raise exception 'Phase 56 dual-approve capital send contract is invalid or unsafe';
  end if;

  select * into v_proposal
  from public.os_docusign_capital_send_phase56_proposals
  where proposal_id = p_proposal_id;
  if v_proposal.proposal_id is null then
    raise exception 'Phase 56 capital send proposal is unknown';
  end if;
  if v_proposal.proposed_by = p_actor_id then
    raise exception 'Proposer may not also approve their own Phase 56 capital send proposal';
  end if;
  if v_proposal.status <> 'pending' then
    return jsonb_build_object(
      'version','phase56-v1',
      'disposition','unchanged',
      'status',v_proposal.status,
      'proposal_id',v_proposal.proposal_id,
      'envelope_send_executed',false,
      'never_silent_send',true
    );
  end if;

  v_approval_key := left(p_proposal_id::text || ':' || p_actor_id::text, 200);
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase56-v1',
    'kind','capital_send_approval',
    'proposal_id',p_proposal_id,
    'actor_id',p_actor_id,
    'decision',v_decision
  )::text);

  insert into public.os_docusign_capital_send_phase56_approvals (
    approval_key, proposal_id, actor_id, decision, metrics_sha256, detail
  ) values (
    v_approval_key, p_proposal_id, p_actor_id, v_decision, v_hash,
    v_meta || jsonb_build_object('contract_version','phase56-v1')
  )
  on conflict (approval_key) do nothing
  returning approval_id into v_id;

  if v_id is null then
    return jsonb_build_object(
      'version','phase56-v1',
      'disposition','unchanged',
      'status','duplicate_actor_decision',
      'proposal_id',p_proposal_id,
      'envelope_send_executed',false,
      'never_silent_send',true
    );
  end if;

  if v_decision = 'reject' then
    v_result_key := left('cap56:rejected:' || p_proposal_id::text, 200);
    insert into public.os_docusign_capital_send_phase56_proposals (
      proposal_key, source_proposal_id, entity_id, template_id, doc_id,
      summary, proposed_by, status, block_reason, metrics_sha256, detail
    ) values (
      v_result_key, p_proposal_id, v_proposal.entity_id, v_proposal.template_id,
      v_proposal.doc_id, v_proposal.summary, v_proposal.proposed_by, 'rejected',
      'rejected_by_approver',
      public.os_sha256_hex('reject:' || p_proposal_id::text),
      v_meta || jsonb_build_object(
        'contract_version','phase56-v1',
        'envelope_send_executed',false,
        'never_silent_send',true,
        'dual_approve_required',true,
        'never_creates_voids_or_resends',true
      )
    )
    on conflict (proposal_key) do nothing;
    return jsonb_build_object(
      'version','phase56-v1',
      'disposition','rejected',
      'status','rejected',
      'proposal_id',p_proposal_id,
      'envelope_send_executed',false,
      'never_silent_send',true
    );
  end if;

  select count(distinct actor_id)::integer into v_distinct_approvers
  from public.os_docusign_capital_send_phase56_approvals
  where proposal_id = p_proposal_id
    and decision = 'approve'
    and actor_id <> v_proposal.proposed_by;

  if v_distinct_approvers < 2 then
    return jsonb_build_object(
      'version','phase56-v1',
      'disposition','awaiting_second_approval',
      'status','pending',
      'proposal_id',p_proposal_id,
      'distinct_approvers',v_distinct_approvers,
      'envelope_send_executed',false,
      'never_silent_send',true
    );
  end if;

  -- Dual-human gate satisfied. NEVER create/send envelope from Tage.
  v_result_key := left('cap56:dual_approved:' || p_proposal_id::text, 200);
  insert into public.os_docusign_capital_send_phase56_proposals (
    proposal_key, source_proposal_id, entity_id, template_id, doc_id,
    summary, proposed_by, status, metrics_sha256, detail
  ) values (
    v_result_key, p_proposal_id, v_proposal.entity_id, v_proposal.template_id,
    v_proposal.doc_id, v_proposal.summary, v_proposal.proposed_by, 'dual_approved',
    public.os_sha256_hex('dual_approved:' || p_proposal_id::text),
    v_meta || jsonb_build_object(
      'contract_version','phase56-v1',
      'envelope_send_executed',false,
      'never_silent_send',true,
      'dual_approve_required',true,
      'dual_approved',true,
      'never_creates_voids_or_resends',true,
      'operator_must_send_after_dual_approve',true
    )
  )
  on conflict (proposal_key) do nothing
  returning * into v_result_row;

  return jsonb_build_object(
    'version','phase56-v1',
    'disposition','dual_approved',
    'status','dual_approved',
    'proposal_id',coalesce(v_result_row.proposal_id,p_proposal_id),
    'source_proposal_id',p_proposal_id,
    'distinct_approvers',v_distinct_approvers,
    'envelope_send_executed',false,
    'never_silent_send',true,
    'todo','Operator sends capital envelope via DocuSign hub after dual-approve (never silent)'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Refresh Legal / DocuSign hardening board (observe + evidence only).
-- Never create/void/resend envelopes from monitoring logic.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_legal_docusign_hardening_phase56(
  p_actor_id uuid default null,
  p_entity_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := nullif(trim(coalesce(p_entity_id,'')),'');
  v_has_templates boolean := false;
  v_cached integer := 0;
  v_with_roles integer := 0;
  v_stale integer := 0;
  v_completeness numeric(5,2);
  v_gov text := 'missing';
  v_has_quarantine boolean := false;
  v_quarantine integer := 0;
  v_pending_cap integer := 0;
  v_period text;
  v_month integer;
  v_window text;
  v_hash text;
  v_id uuid;
  v_inda_tickets boolean := false;
  v_r619_tickets boolean := false;
begin
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 56 legal refresh';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 56 legal refresh';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is null then
    raise exception 'Firm-wide access or entity filter required for Phase 56 legal refresh';
  end if;

  v_month := extract(month from (now() at time zone 'utc'))::integer;
  if v_month <= 3 then
    v_period := to_char(now() at time zone 'utc','YYYY') || '-Q1';
  elsif v_month <= 6 then
    v_period := to_char(now() at time zone 'utc','YYYY') || '-Q2';
  elsif v_month <= 9 then
    v_period := to_char(now() at time zone 'utc','YYYY') || '-Q3';
  else
    v_period := to_char(now() at time zone 'utc','YYYY') || '-Q4';
  end if;

  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_docusign_templates'
  ) into v_has_templates;

  if v_has_templates then
    begin
      execute
        'select count(*)::integer,
                count(*) filter (
                  where coalesce(raw->''recipients''->''signers'', ''[]''::jsonb)
                        <> ''[]''::jsonb
                     or coalesce(jsonb_array_length(coalesce(raw->''roles'',''[]''::jsonb)),0) > 0
                )::integer,
                count(*) filter (
                  where synced_at < now() - interval ''7 days''
                )::integer
         from public.os_docusign_templates'
      into v_cached, v_with_roles, v_stale;
    exception when others then
      v_cached := 0;
      v_with_roles := 0;
      v_stale := 0;
      v_gov := 'unknown';
    end;
  end if;

  if v_cached > 0 then
    v_completeness := round((v_with_roles::numeric / v_cached::numeric) * 100, 2);
    if v_completeness >= 90 and v_stale = 0 then
      v_gov := 'ok';
    elsif v_with_roles > 0 then
      v_gov := 'partial';
    else
      v_gov := 'missing';
    end if;
  else
    -- TODO: sync DocuSign templates when JWT cache is empty.
    v_gov := 'missing';
    v_completeness := null;
  end if;

  select exists (
    select 1 from information_schema.tables
    where table_schema='public'
      and table_name='os_docusign_archive_quarantine'
  ) into v_has_quarantine;

  if v_has_quarantine then
    begin
      execute
        'select count(*)::integer
         from public.os_docusign_archive_quarantine
         where status = ''manual_review'''
      into v_quarantine;
    exception when others then
      v_quarantine := 0;
    end;
  end if;

  select count(*)::integer into v_pending_cap
  from public.os_docusign_capital_send_phase56_proposals p
  where p.status = 'pending'
    and p.source_proposal_id is null
    and (v_entity is null or p.entity_id = v_entity)
    and not exists (
      select 1
      from public.os_docusign_capital_send_phase56_proposals c
      where c.source_proposal_id = p.proposal_id
        and c.status in ('dual_approved','rejected','blocked','superseded')
    );

  -- Seed quarterly process stubs when none exist for current period.
  if not exists (
    select 1 from public.os_docusign_quarterly_process_phase56_events e
    where e.period_key = v_period
      and (v_entity is null and e.entity_id is null
           or v_entity is not null and e.entity_id = v_entity)
  ) then
    perform public.record_quarterly_process_phase56(
      jsonb_build_object(
        'entity_id', v_entity,
        'period_key', v_period,
        'step_key', 'template_gov_review',
        'step_label', 'Template governance completeness review',
        'status', 'open',
        'actor_id', p_actor_id,
        'detail', jsonb_build_object('source','refresh_legal_docusign_hardening_phase56')
      )
    );
    perform public.record_quarterly_process_phase56(
      jsonb_build_object(
        'entity_id', v_entity,
        'period_key', v_period,
        'step_key', 'archive_integrity_window',
        'step_label', 'Archive integrity quarterly window',
        'status', 'open',
        'actor_id', p_actor_id,
        'detail', jsonb_build_object('source','refresh_legal_docusign_hardening_phase56')
      )
    );
    perform public.record_quarterly_process_phase56(
      jsonb_build_object(
        'entity_id', v_entity,
        'period_key', v_period,
        'step_key', 'capital_gate_soak',
        'step_label', 'Capital send dual-control soak check',
        'status', 'open',
        'actor_id', p_actor_id,
        'detail', jsonb_build_object('source','refresh_legal_docusign_hardening_phase56')
      )
    );
    perform public.record_quarterly_process_phase56(
      jsonb_build_object(
        'entity_id', v_entity,
        'period_key', v_period,
        'step_key', 'subsidiary_legal_visibility',
        'step_label', 'Subsidiary legal request visibility (R619/INDA)',
        'status', 'open',
        'actor_id', p_actor_id,
        'detail', jsonb_build_object('source','refresh_legal_docusign_hardening_phase56')
      )
    );
  end if;

  -- Subsidiary legal visibility probes (fail-soft).
  begin
    if exists (
      select 1 from information_schema.tables
      where table_schema='public' and table_name='os_tickets'
    ) then
      execute
        'select exists (
           select 1 from public.os_tickets
           where entity_id = ''ENT-R619''
             and coalesce(service,'''') ilike ''%legal%''
         ),
         exists (
           select 1 from public.os_tickets
           where entity_id = ''ENT-INDA''
             and coalesce(service,'''') ilike ''%legal%''
         )'
      into v_r619_tickets, v_inda_tickets;
    end if;
  exception when others then
    v_r619_tickets := false;
    v_inda_tickets := false;
  end;

  insert into public.os_docusign_subsidiary_legal_phase56_events (
    entity_id, request_kind, open_count, overdue_count, visibility_status,
    window_key, metrics_sha256, detail
  ) values (
    'ENT-R619', 'legal_ticket',
    case when v_r619_tickets then 1 else 0 end,
    0,
    case when v_r619_tickets then 'partial' else 'missing' end,
    left(
      'phase56:sub:ENT-R619:' || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24'),
      200
    ),
    public.os_sha256_hex('sub|ENT-R619|' || v_r619_tickets::text),
    jsonb_build_object(
      'contract_version','phase56-v1',
      'name','Recruit 619',
      'priority',1,
      'todo', case when v_r619_tickets then null
                   else 'TODO: wire Recruit legal request feed'
              end,
      'never_creates_voids_or_resends',true
    )
  ) on conflict (window_key) do nothing;

  insert into public.os_docusign_subsidiary_legal_phase56_events (
    entity_id, request_kind, open_count, overdue_count, visibility_status,
    window_key, metrics_sha256, detail
  ) values (
    'ENT-INDA', 'legal_ticket',
    case when v_inda_tickets then 1 else 0 end,
    0,
    case when v_inda_tickets then 'partial' else 'missing' end,
    left(
      'phase56:sub:ENT-INDA:' || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24'),
      200
    ),
    public.os_sha256_hex('sub|ENT-INDA|' || v_inda_tickets::text),
    jsonb_build_object(
      'contract_version','phase56-v1',
      'name','Instant NDA',
      'priority',2,
      'todo', case when v_inda_tickets then null
                   else 'TODO: show ENT-INDA legal requests when evidence exists'
              end,
      'never_creates_voids_or_resends',true
    )
  ) on conflict (window_key) do nothing;

  if v_gov in ('missing','partial') then
    insert into public.os_docusign_phase56_ops_alerts (
      entity_id, alert_kind, window_key, severity, metrics_sha256, detail
    ) values (
      v_entity, 'template_gov_gap',
      left(
        'phase56:alert:template_gov:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      'warning',
      public.os_sha256_hex('template_gov|' || coalesce(v_entity,'firm') || '|' || v_gov),
      jsonb_build_object(
        'contract_version','phase56-v1',
        'governance_status', v_gov,
        'never_creates_voids_or_resends',true
      )
    ) on conflict (window_key) do nothing;
  end if;

  if coalesce(v_quarantine,0) > 0 then
    insert into public.os_docusign_archive_integrity_phase56_alerts (
      entity_id, alert_kind, severity, title, window_key,
      metrics_sha256, detail
    ) values (
      v_entity, 'manual_review_backlog', 'warning',
      'Archive quarantine backlog requires manual review',
      left(
        'phase56:arch:quarantine:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      public.os_sha256_hex('quarantine|' || coalesce(v_quarantine,0)::text),
      jsonb_build_object(
        'contract_version','phase56-v1',
        'quarantine_count', v_quarantine,
        'never_creates_voids_or_resends',true
      )
    ) on conflict (window_key) do nothing;
  else
    insert into public.os_docusign_archive_integrity_phase56_alerts (
      entity_id, alert_kind, severity, title, window_key,
      metrics_sha256, detail
    ) values (
      v_entity, 'integrity_unknown', 'info',
      'Archive integrity monitoring refreshed (no quarantine backlog)',
      left(
        'phase56:arch:ok:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      public.os_sha256_hex('arch_ok|' || coalesce(v_entity,'firm')),
      jsonb_build_object(
        'contract_version','phase56-v1',
        'quarantine_count', 0,
        'never_creates_voids_or_resends',true
      )
    ) on conflict (window_key) do nothing;
  end if;

  if coalesce(v_pending_cap,0) > 0 then
    insert into public.os_docusign_phase56_ops_alerts (
      entity_id, alert_kind, window_key, severity, metrics_sha256, detail
    ) values (
      v_entity, 'capital_send_pending',
      left(
        'phase56:alert:capital_pending:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      'warning',
      public.os_sha256_hex('cap_pending|' || coalesce(v_pending_cap,0)::text),
      jsonb_build_object(
        'contract_version','phase56-v1',
        'pending_count', v_pending_cap,
        'envelope_send_executed',false,
        'never_creates_voids_or_resends',true
      )
    ) on conflict (window_key) do nothing;
  end if;

  v_window := left(
    'phase56:tg:' || coalesce(v_entity,'firm') || ':'
      || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24'),
    200
  );
  v_hash := public.os_sha256_hex(
    coalesce(v_entity,'firm') || '|' || coalesce(v_cached,0)::text || '|'
    || coalesce(v_with_roles,0)::text || '|' || v_gov || '|' || v_window
  );

  insert into public.os_docusign_template_gov_phase56_snapshots (
    entity_id, window_key, templates_cached, templates_with_roles,
    templates_stale, completeness_pct, governance_status,
    metrics_sha256, detail, actor_id
  ) values (
    v_entity, v_window, coalesce(v_cached,0), coalesce(v_with_roles,0),
    coalesce(v_stale,0), v_completeness, v_gov, v_hash,
    jsonb_build_object(
      'contract_version','phase56-v1',
      'source','refresh_legal_docusign_hardening_phase56',
      'pending_capital_send_count', coalesce(v_pending_cap,0),
      'quarantine_count', coalesce(v_quarantine,0),
      'period_key', v_period,
      'never_creates_voids_or_resends', true,
      'envelope_send_executed', false,
      'subsidiary_hint','ENT-R619'
    ),
    p_actor_id
  )
  on conflict (window_key) do nothing
  returning snapshot_id into v_id;

  if v_id is null then
    select snapshot_id into v_id
    from public.os_docusign_template_gov_phase56_snapshots
    where window_key = v_window;
  end if;

  return jsonb_build_object(
    'snapshot_id', v_id,
    'entity_id', v_entity,
    'templates_cached', coalesce(v_cached,0),
    'templates_with_roles', coalesce(v_with_roles,0),
    'templates_stale', coalesce(v_stale,0),
    'completeness_pct', v_completeness,
    'governance_status', v_gov,
    'pending_capital_send_count', coalesce(v_pending_cap,0),
    'quarantine_count', coalesce(v_quarantine,0),
    'period_key', v_period,
    'envelope_send_executed', false,
    'never_creates_voids_or_resends', true,
    'never_silent_send', true,
    'contract_version', 'phase56-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Report: Legal / DocuSign hardening board.
-- ---------------------------------------------------------------------------
create or replace function public.get_legal_docusign_hardening_phase56_report(
  p_entity_id text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_entity text := nullif(trim(coalesce(p_entity_id,'')),'');
  v_latest public.os_docusign_template_gov_phase56_snapshots%rowtype;
  v_quarterly jsonb := '[]'::jsonb;
  v_archive_alerts jsonb := '[]'::jsonb;
  v_proposals jsonb := '[]'::jsonb;
  v_ops_alerts jsonb := '[]'::jsonb;
  v_subsidiaries jsonb := '[]'::jsonb;
  v_period text;
  v_month integer;
  v_r619 public.os_docusign_subsidiary_legal_phase56_events%rowtype;
  v_inda public.os_docusign_subsidiary_legal_phase56_events%rowtype;
begin
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 56 legal report';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 56 legal report';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is null then
    raise exception 'Firm-wide access or entity filter required for Phase 56 legal report';
  end if;

  v_month := extract(month from (now() at time zone 'utc'))::integer;
  if v_month <= 3 then
    v_period := to_char(now() at time zone 'utc','YYYY') || '-Q1';
  elsif v_month <= 6 then
    v_period := to_char(now() at time zone 'utc','YYYY') || '-Q2';
  elsif v_month <= 9 then
    v_period := to_char(now() at time zone 'utc','YYYY') || '-Q3';
  else
    v_period := to_char(now() at time zone 'utc','YYYY') || '-Q4';
  end if;

  select * into v_latest
  from public.os_docusign_template_gov_phase56_snapshots s
  where (v_entity is null and s.entity_id is null)
     or (v_entity is not null and s.entity_id = v_entity)
  order by s.created_at desc
  limit 1;

  select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.created_at desc), '[]'::jsonb)
  into v_quarterly
  from (
    select distinct on (e.step_key)
      e.event_id, e.entity_id, e.period_key, e.step_key, e.step_label,
      e.status, e.created_at
    from public.os_docusign_quarterly_process_phase56_events e
    where e.period_key = v_period
      and (v_entity is null or e.entity_id = v_entity or e.entity_id is null)
    order by e.step_key, e.created_at desc
  ) q;

  select coalesce(jsonb_agg(row_to_json(a)::jsonb order by a.created_at desc), '[]'::jsonb)
  into v_archive_alerts
  from (
    select al.alert_id, al.entity_id, al.alert_kind, al.severity,
           al.title, al.created_at
    from public.os_docusign_archive_integrity_phase56_alerts al
    where (v_entity is null or al.entity_id = v_entity)
    order by al.created_at desc
    limit 40
  ) a;

  select coalesce(jsonb_agg(row_to_json(p)::jsonb order by p.created_at desc), '[]'::jsonb)
  into v_proposals
  from (
    select pr.proposal_id, pr.entity_id, pr.template_id, pr.doc_id,
           pr.summary, pr.proposed_by, pr.status, pr.created_at
    from public.os_docusign_capital_send_phase56_proposals pr
    where (v_entity is null or pr.entity_id = v_entity)
      and (
        (
          pr.status = 'pending'
          and pr.source_proposal_id is null
          and not exists (
            select 1
            from public.os_docusign_capital_send_phase56_proposals c
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

  select coalesce(jsonb_agg(row_to_json(o)::jsonb order by o.created_at desc), '[]'::jsonb)
  into v_ops_alerts
  from (
    select oa.alert_id, oa.alert_kind, oa.severity, oa.entity_id, oa.created_at
    from public.os_docusign_phase56_ops_alerts oa
    where (v_entity is null or oa.entity_id = v_entity)
    order by oa.created_at desc
    limit 12
  ) o;

  select * into v_r619
  from public.os_docusign_subsidiary_legal_phase56_events e
  where e.entity_id = 'ENT-R619'
  order by e.created_at desc
  limit 1;

  select * into v_inda
  from public.os_docusign_subsidiary_legal_phase56_events e
  where e.entity_id = 'ENT-INDA'
  order by e.created_at desc
  limit 1;

  v_subsidiaries := jsonb_build_array(
    jsonb_build_object(
      'entity_id', 'ENT-R619',
      'name', 'Recruit 619',
      'priority', 1,
      'visibility_status', coalesce(v_r619.visibility_status, 'missing'),
      'open_count', coalesce(v_r619.open_count, 0),
      'overdue_count', coalesce(v_r619.overdue_count, 0),
      'has_data', coalesce(v_r619.visibility_status,'missing') in ('ok','partial'),
      'todo', coalesce(v_r619.detail->>'todo',
        'TODO: wire Recruit legal request feed')
    ),
    jsonb_build_object(
      'entity_id', 'ENT-INDA',
      'name', 'Instant NDA',
      'priority', 2,
      'visibility_status', coalesce(v_inda.visibility_status, 'missing'),
      'open_count', coalesce(v_inda.open_count, 0),
      'overdue_count', coalesce(v_inda.overdue_count, 0),
      'has_data', coalesce(v_inda.visibility_status,'missing') in ('ok','partial'),
      'todo', coalesce(v_inda.detail->>'todo',
        'TODO: show ENT-INDA legal requests when evidence exists')
    )
  );

  if v_latest.snapshot_id is null then
    return jsonb_build_object(
      'entity_id', v_entity,
      'templates_cached', 0,
      'templates_with_roles', 0,
      'templates_stale', 0,
      'completeness_pct', null,
      'governance_status', 'missing',
      'pending_capital_send_count', 0,
      'quarantine_count', 0,
      'period_key', v_period,
      'snapshot_id', null,
      'captured_at', null,
      'quarterly_steps', v_quarterly,
      'archive_alerts', v_archive_alerts,
      'capital_send_proposals', v_proposals,
      'recent_alerts', v_ops_alerts,
      'subsidiaries', v_subsidiaries,
      'entity_filter_hint', 'ENT-R619',
      'todo', 'Refresh Legal / DocuSign hardening board; sync templates when JWT ready',
      'envelope_send_executed', false,
      'never_silent_send', true,
      'never_creates_voids_or_resends', true,
      'contract_version', 'phase56-v1'
    );
  end if;

  return jsonb_build_object(
    'entity_id', v_entity,
    'templates_cached', v_latest.templates_cached,
    'templates_with_roles', v_latest.templates_with_roles,
    'templates_stale', v_latest.templates_stale,
    'completeness_pct', v_latest.completeness_pct,
    'governance_status', v_latest.governance_status,
    'pending_capital_send_count',
      coalesce((v_latest.detail->>'pending_capital_send_count')::integer, 0),
    'quarantine_count',
      coalesce((v_latest.detail->>'quarantine_count')::integer, 0),
    'period_key', coalesce(v_latest.detail->>'period_key', v_period),
    'snapshot_id', v_latest.snapshot_id,
    'captured_at', v_latest.created_at,
    'quarterly_steps', v_quarterly,
    'archive_alerts', v_archive_alerts,
    'capital_send_proposals', v_proposals,
    'recent_alerts', v_ops_alerts,
    'subsidiaries', v_subsidiaries,
    'entity_filter_hint', 'ENT-R619',
    'todo', 'Capital sends require dual-approve; operator sends after gate (never silent)',
    'envelope_send_executed', false,
    'never_silent_send', true,
    'never_creates_voids_or_resends', true,
    'contract_version', 'phase56-v1'
  );
end;
$$;

revoke all on function public.record_quarterly_process_phase56(jsonb)
  from public, anon, authenticated;
revoke all on function public.propose_capital_send_phase56(jsonb)
  from public, anon, authenticated;
revoke all on function public.approve_capital_send_phase56(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.refresh_legal_docusign_hardening_phase56(uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_legal_docusign_hardening_phase56_report(text)
  from public, anon, authenticated;

grant execute on function public.record_quarterly_process_phase56(jsonb)
  to authenticated, service_role;
grant execute on function public.propose_capital_send_phase56(jsonb)
  to authenticated, service_role;
grant execute on function public.approve_capital_send_phase56(uuid, uuid, text, jsonb)
  to authenticated, service_role;
grant execute on function public.refresh_legal_docusign_hardening_phase56(uuid, text)
  to authenticated, service_role;
grant execute on function public.get_legal_docusign_hardening_phase56_report(text)
  to authenticated, service_role;
