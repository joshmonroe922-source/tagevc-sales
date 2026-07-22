-- Phase 45: DocuSign archive gate-clearing path, drift budgets, integrity cadence.
-- Depends on phase44_docusign_archive_ops.sql.
-- Structured checklist: first quarterly evidence → recurring quarterly readiness.
-- Drift budgets + health thresholds for signed archives. Cadence visibility.
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

create or replace function public.phase45_docusign_ops_safe_metadata(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select public.phase44_docusign_ops_safe_metadata(p_detail);
$$;

-- ---------------------------------------------------------------------------
-- Append-only drift budgets (active/retired via new rows; current = latest active)
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_drift_budgets (
  budget_id uuid primary key default gen_random_uuid(),
  budget_key text not null
    check (budget_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  max_content_drift_per_window integer not null
    check (max_content_drift_per_window >= 0),
  max_storage_unavailable integer not null
    check (max_storage_unavailable >= 0),
  window_days integer not null
    check (window_days between 1 and 90),
  status text not null
    check (status in ('active','retired')),
  metrics_sha256 text not null
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_drift_budget_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase45_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_drift_budget_key_idx
  on public.os_docusign_archive_drift_budgets(budget_key, created_at desc);
create index if not exists os_docusign_archive_drift_budget_active_idx
  on public.os_docusign_archive_drift_budgets(budget_key, created_at desc)
  where status='active';

alter table public.os_docusign_archive_drift_budgets
  enable row level security;
drop policy if exists "os_docusign_archive_drift_budget_select"
  on public.os_docusign_archive_drift_budgets;
create policy "os_docusign_archive_drift_budget_select"
  on public.os_docusign_archive_drift_budgets for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_drift_budgets
  from public, anon, authenticated;
grant select on public.os_docusign_archive_drift_budgets
  to authenticated;

-- ---------------------------------------------------------------------------
-- Append-only gate-clearing checklist evidence (step_key + status)
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_gate_clearing_evidence (
  evidence_id uuid primary key default gen_random_uuid(),
  step_key text not null unique
    check (step_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  step_kind text not null,
  status text not null,
  remaining_unhashed integer not null default 0
    check (remaining_unhashed >= 0),
  quarantine_backlog integer not null default 0
    check (quarantine_backlog >= 0),
  quarantine_oldest_days integer not null default 0
    check (quarantine_oldest_days >= 0),
  metrics_sha256 text not null
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_gate_clear_kind_check
    check (step_kind in (
      'remaining_unhashed_cleared',
      'quarantine_age_cleared',
      'quarantine_backlog_cleared',
      'first_quarterly_ready',
      'first_quarterly_completed',
      'recurring_quarterly_armed'
    )),
  constraint os_docusign_archive_gate_clear_status_check
    check (status in (
      'cleared','ready','completed','armed'
    )),
  constraint os_docusign_archive_gate_clear_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase45_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_gate_clear_created_idx
  on public.os_docusign_archive_gate_clearing_evidence(created_at desc);
create index if not exists os_docusign_archive_gate_clear_kind_idx
  on public.os_docusign_archive_gate_clearing_evidence(step_kind, created_at desc);

alter table public.os_docusign_archive_gate_clearing_evidence
  enable row level security;
drop policy if exists "os_docusign_archive_gate_clear_select"
  on public.os_docusign_archive_gate_clearing_evidence;
create policy "os_docusign_archive_gate_clear_select"
  on public.os_docusign_archive_gate_clearing_evidence for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_gate_clearing_evidence
  from public, anon, authenticated;
grant select on public.os_docusign_archive_gate_clearing_evidence
  to authenticated;

-- ---------------------------------------------------------------------------
-- Append-only integrity cadence snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_integrity_cadence_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  last_sample_at timestamptz,
  last_full_at timestamptz,
  next_quarterly_due timestamptz,
  sample_overdue boolean not null default false,
  full_overdue boolean not null default false,
  metrics_sha256 text not null
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_cadence_snap_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase45_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_cadence_snap_created_idx
  on public.os_docusign_archive_integrity_cadence_snapshots(created_at desc);

alter table public.os_docusign_archive_integrity_cadence_snapshots
  enable row level security;
drop policy if exists "os_docusign_archive_cadence_snap_select"
  on public.os_docusign_archive_integrity_cadence_snapshots;
create policy "os_docusign_archive_cadence_snap_select"
  on public.os_docusign_archive_integrity_cadence_snapshots for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_integrity_cadence_snapshots
  from public, anon, authenticated;
grant select on public.os_docusign_archive_integrity_cadence_snapshots
  to authenticated;

-- ---------------------------------------------------------------------------
-- Append-only Phase 45 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_phase45_ops_alerts (
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
  constraint os_docusign_archive_p45_alert_kind_check
    check (alert_kind in (
      'drift_budget_breach',
      'gate_clearing_stalled',
      'recurring_quarterly_unarmed',
      'integrity_cadence_overdue'
    )),
  constraint os_docusign_archive_p45_alert_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase45_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_p45_alert_created_idx
  on public.os_docusign_archive_phase45_ops_alerts(created_at desc);
create index if not exists os_docusign_archive_p45_alert_kind_idx
  on public.os_docusign_archive_phase45_ops_alerts(alert_kind, created_at desc);

alter table public.os_docusign_archive_phase45_ops_alerts
  enable row level security;
drop policy if exists "os_docusign_archive_p45_alert_select"
  on public.os_docusign_archive_phase45_ops_alerts;
create policy "os_docusign_archive_p45_alert_select"
  on public.os_docusign_archive_phase45_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_phase45_ops_alerts
  from public, anon, authenticated;
grant select on public.os_docusign_archive_phase45_ops_alerts
  to authenticated;

create or replace function public.reject_docusign_phase45_ops_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Phase 45 DocuSign archive ops evidence is append-only';
end;
$$;

drop trigger if exists os_docusign_archive_drift_budget_immutable
  on public.os_docusign_archive_drift_budgets;
create trigger os_docusign_archive_drift_budget_immutable
  before update or delete on public.os_docusign_archive_drift_budgets
  for each row execute function public.reject_docusign_phase45_ops_mutation();
drop trigger if exists os_docusign_archive_drift_budget_no_truncate
  on public.os_docusign_archive_drift_budgets;
create trigger os_docusign_archive_drift_budget_no_truncate
  before truncate on public.os_docusign_archive_drift_budgets
  for each statement execute function public.reject_docusign_phase45_ops_mutation();

drop trigger if exists os_docusign_archive_gate_clear_immutable
  on public.os_docusign_archive_gate_clearing_evidence;
create trigger os_docusign_archive_gate_clear_immutable
  before update or delete on public.os_docusign_archive_gate_clearing_evidence
  for each row execute function public.reject_docusign_phase45_ops_mutation();
drop trigger if exists os_docusign_archive_gate_clear_no_truncate
  on public.os_docusign_archive_gate_clearing_evidence;
create trigger os_docusign_archive_gate_clear_no_truncate
  before truncate on public.os_docusign_archive_gate_clearing_evidence
  for each statement execute function public.reject_docusign_phase45_ops_mutation();

drop trigger if exists os_docusign_archive_cadence_snap_immutable
  on public.os_docusign_archive_integrity_cadence_snapshots;
create trigger os_docusign_archive_cadence_snap_immutable
  before update or delete on public.os_docusign_archive_integrity_cadence_snapshots
  for each row execute function public.reject_docusign_phase45_ops_mutation();
drop trigger if exists os_docusign_archive_cadence_snap_no_truncate
  on public.os_docusign_archive_integrity_cadence_snapshots;
create trigger os_docusign_archive_cadence_snap_no_truncate
  before truncate on public.os_docusign_archive_integrity_cadence_snapshots
  for each statement execute function public.reject_docusign_phase45_ops_mutation();

drop trigger if exists os_docusign_archive_p45_alert_immutable
  on public.os_docusign_archive_phase45_ops_alerts;
create trigger os_docusign_archive_p45_alert_immutable
  before update or delete on public.os_docusign_archive_phase45_ops_alerts
  for each row execute function public.reject_docusign_phase45_ops_mutation();
drop trigger if exists os_docusign_archive_p45_alert_no_truncate
  on public.os_docusign_archive_phase45_ops_alerts;
create trigger os_docusign_archive_p45_alert_no_truncate
  before truncate on public.os_docusign_archive_phase45_ops_alerts
  for each statement execute function public.reject_docusign_phase45_ops_mutation();

-- ---------------------------------------------------------------------------
-- Upsert / record drift budget (service_role). Active/retired via new rows.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_docusign_archive_drift_budget_phase45(
  p_budget_key text,
  p_max_content_drift_per_window integer,
  p_max_storage_unavailable integer,
  p_window_days integer default 7,
  p_status text default 'active',
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text := nullif(trim(p_budget_key), '');
  v_status text := coalesce(nullif(trim(p_status), ''), 'active');
  v_drift integer := coalesce(p_max_content_drift_per_window, 0);
  v_storage integer := coalesce(p_max_storage_unavailable, 0);
  v_days integer := least(greatest(coalesce(p_window_days, 7), 1), 90);
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_hash text;
  v_prev public.os_docusign_archive_drift_budgets%rowtype;
  v_row public.os_docusign_archive_drift_budgets%rowtype;
begin
  if v_key is null
     or v_key !~ '^[a-z][a-z0-9_]{0,62}$'
     or v_status not in ('active','retired')
     or v_drift < 0
     or v_storage < 0
     or not public.phase45_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 45 drift budget contract is invalid or unsafe';
  end if;

  select * into v_prev
  from public.os_docusign_archive_drift_budgets b
  where b.budget_key = v_key
    and b.status = 'active'
  order by b.created_at desc
  limit 1;

  if v_status = 'active'
     and v_prev.budget_id is not null
     and v_prev.max_content_drift_per_window = v_drift
     and v_prev.max_storage_unavailable = v_storage
     and v_prev.window_days = v_days then
    return jsonb_build_object(
      'disposition','unchanged',
      'budget_id',v_prev.budget_id,
      'budget_key',v_prev.budget_key,
      'max_content_drift_per_window',v_prev.max_content_drift_per_window,
      'max_storage_unavailable',v_prev.max_storage_unavailable,
      'window_days',v_prev.window_days,
      'status',v_prev.status,
      'metrics_sha256',v_prev.metrics_sha256,
      'contract_version','phase45-v1'
    );
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase45-v1',
    'kind','drift_budget',
    'budget_key',v_key,
    'max_content_drift_per_window',v_drift,
    'max_storage_unavailable',v_storage,
    'window_days',v_days,
    'status',v_status,
    'metadata',v_meta
  )::text);

  insert into public.os_docusign_archive_drift_budgets(
    budget_key,max_content_drift_per_window,max_storage_unavailable,
    window_days,status,metrics_sha256,metadata)
  values (
    v_key,v_drift,v_storage,v_days,v_status,v_hash,
    v_meta || jsonb_build_object('contract_version','phase45-v1'))
  returning * into v_row;

  return jsonb_build_object(
    'disposition','recorded',
    'budget_id',v_row.budget_id,
    'budget_key',v_row.budget_key,
    'max_content_drift_per_window',v_row.max_content_drift_per_window,
    'max_storage_unavailable',v_row.max_storage_unavailable,
    'window_days',v_row.window_days,
    'status',v_row.status,
    'metrics_sha256',v_row.metrics_sha256,
    'contract_version','phase45-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Evaluate / record gate-clearing checklist (Phase 43 thresholds; idempotent)
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_docusign_gate_clearing_phase45(
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_gates jsonb;
  v_remaining integer;
  v_quarantine integer;
  v_oldest integer;
  v_unlocked boolean;
  v_first_done boolean;
  v_aging_sla integer := 45;
  v_backlog_gate integer := 25;
  v_recorded integer := 0;
  v_steps jsonb := '[]'::jsonb;
  v_kind text;
  v_status text;
  v_key text;
  v_hash text;
  v_id uuid;
  v_cleared_unhashed boolean := false;
  v_cleared_age boolean := false;
  v_cleared_backlog boolean := false;
  v_ready boolean := false;
  v_completed boolean := false;
  v_armed boolean := false;
begin
  if not public.phase45_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 45 gate-clearing metadata is invalid or unsafe';
  end if;

  v_gates := public.evaluate_docusign_first_quarterly_gates_phase43(null);
  v_remaining := coalesce((v_gates->>'remaining_unhashed')::integer, 0);
  v_quarantine := coalesce((v_gates->>'quarantine_backlog')::integer, 0);
  v_oldest := coalesce((v_gates->>'quarantine_oldest_days')::integer, 0);
  v_unlocked := coalesce((v_gates->>'quarterly_unlocked')::boolean, false);
  v_first_done := coalesce((v_gates->>'first_quarterly_completed')::boolean, false);
  v_aging_sla := coalesce((v_gates->>'aging_sla_days')::integer, 45);
  v_backlog_gate := coalesce((v_gates->>'quarantine_backlog_gate')::integer, 25);

  if v_remaining <= 0 then
    v_kind := 'remaining_unhashed_cleared';
    v_status := 'cleared';
    v_key := 'gateclear:firm:remaining_unhashed_cleared';
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase45-v1','step_kind',v_kind,'step_key',v_key,
      'status',v_status,'remaining_unhashed',v_remaining,
      'quarantine_backlog',v_quarantine,'quarantine_oldest_days',v_oldest
    )::text);
    v_id := null;
    insert into public.os_docusign_archive_gate_clearing_evidence(
      step_key,step_kind,status,remaining_unhashed,quarantine_backlog,
      quarantine_oldest_days,metrics_sha256,metadata)
    values (
      v_key,v_kind,v_status,v_remaining,v_quarantine,v_oldest,v_hash,
      v_meta || jsonb_build_object('contract_version','phase45-v1'))
    on conflict (step_key) do nothing
    returning evidence_id into v_id;
    if v_id is not null then
      v_recorded := v_recorded + 1;
    end if;
    v_cleared_unhashed := true;
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'step_kind',v_kind,'status',v_status,'recorded',v_id is not null));
  end if;

  if v_oldest <= v_aging_sla then
    v_kind := 'quarantine_age_cleared';
    v_status := 'cleared';
    v_key := 'gateclear:firm:quarantine_age_cleared';
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase45-v1','step_kind',v_kind,'step_key',v_key,
      'status',v_status,'remaining_unhashed',v_remaining,
      'quarantine_backlog',v_quarantine,'quarantine_oldest_days',v_oldest,
      'aging_sla_days',v_aging_sla
    )::text);
    v_id := null;
    insert into public.os_docusign_archive_gate_clearing_evidence(
      step_key,step_kind,status,remaining_unhashed,quarantine_backlog,
      quarantine_oldest_days,metrics_sha256,metadata)
    values (
      v_key,v_kind,v_status,v_remaining,v_quarantine,v_oldest,v_hash,
      v_meta || jsonb_build_object('contract_version','phase45-v1'))
    on conflict (step_key) do nothing
    returning evidence_id into v_id;
    if v_id is not null then
      v_recorded := v_recorded + 1;
    end if;
    v_cleared_age := true;
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'step_kind',v_kind,'status',v_status,'recorded',v_id is not null));
  end if;

  if v_quarantine <= v_backlog_gate then
    v_kind := 'quarantine_backlog_cleared';
    v_status := 'cleared';
    v_key := 'gateclear:firm:quarantine_backlog_cleared';
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase45-v1','step_kind',v_kind,'step_key',v_key,
      'status',v_status,'remaining_unhashed',v_remaining,
      'quarantine_backlog',v_quarantine,'quarantine_oldest_days',v_oldest,
      'quarantine_backlog_gate',v_backlog_gate
    )::text);
    v_id := null;
    insert into public.os_docusign_archive_gate_clearing_evidence(
      step_key,step_kind,status,remaining_unhashed,quarantine_backlog,
      quarantine_oldest_days,metrics_sha256,metadata)
    values (
      v_key,v_kind,v_status,v_remaining,v_quarantine,v_oldest,v_hash,
      v_meta || jsonb_build_object('contract_version','phase45-v1'))
    on conflict (step_key) do nothing
    returning evidence_id into v_id;
    if v_id is not null then
      v_recorded := v_recorded + 1;
    end if;
    v_cleared_backlog := true;
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'step_kind',v_kind,'status',v_status,'recorded',v_id is not null));
  end if;

  if v_unlocked
     and v_cleared_unhashed
     and v_cleared_age
     and v_cleared_backlog then
    v_kind := 'first_quarterly_ready';
    v_status := 'ready';
    v_key := 'gateclear:firm:first_quarterly_ready';
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase45-v1','step_kind',v_kind,'step_key',v_key,
      'status',v_status,'remaining_unhashed',v_remaining,
      'quarantine_backlog',v_quarantine,'quarantine_oldest_days',v_oldest
    )::text);
    v_id := null;
    insert into public.os_docusign_archive_gate_clearing_evidence(
      step_key,step_kind,status,remaining_unhashed,quarantine_backlog,
      quarantine_oldest_days,metrics_sha256,metadata)
    values (
      v_key,v_kind,v_status,v_remaining,v_quarantine,v_oldest,v_hash,
      v_meta || jsonb_build_object('contract_version','phase45-v1'))
    on conflict (step_key) do nothing
    returning evidence_id into v_id;
    if v_id is not null then
      v_recorded := v_recorded + 1;
    end if;
    v_ready := true;
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'step_kind',v_kind,'status',v_status,'recorded',v_id is not null));
  end if;

  if v_first_done then
    v_kind := 'first_quarterly_completed';
    v_status := 'completed';
    v_key := 'gateclear:firm:first_quarterly_completed';
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase45-v1','step_kind',v_kind,'step_key',v_key,
      'status',v_status,'remaining_unhashed',v_remaining,
      'quarantine_backlog',v_quarantine,'quarantine_oldest_days',v_oldest
    )::text);
    v_id := null;
    insert into public.os_docusign_archive_gate_clearing_evidence(
      step_key,step_kind,status,remaining_unhashed,quarantine_backlog,
      quarantine_oldest_days,metrics_sha256,metadata)
    values (
      v_key,v_kind,v_status,v_remaining,v_quarantine,v_oldest,v_hash,
      v_meta || jsonb_build_object('contract_version','phase45-v1'))
    on conflict (step_key) do nothing
    returning evidence_id into v_id;
    if v_id is not null then
      v_recorded := v_recorded + 1;
    end if;
    v_completed := true;
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'step_kind',v_kind,'status',v_status,'recorded',v_id is not null));
  end if;

  if v_completed
     and (
       v_ready
       or exists (
         select 1 from public.os_docusign_archive_gate_clearing_evidence e
         where e.step_kind='first_quarterly_ready' and e.status='ready'
       )
     )
     and v_unlocked then
    v_kind := 'recurring_quarterly_armed';
    v_status := 'armed';
    v_key := 'gateclear:firm:recurring_quarterly_armed';
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase45-v1','step_kind',v_kind,'step_key',v_key,
      'status',v_status,'remaining_unhashed',v_remaining,
      'quarantine_backlog',v_quarantine,'quarantine_oldest_days',v_oldest
    )::text);
    v_id := null;
    insert into public.os_docusign_archive_gate_clearing_evidence(
      step_key,step_kind,status,remaining_unhashed,quarantine_backlog,
      quarantine_oldest_days,metrics_sha256,metadata)
    values (
      v_key,v_kind,v_status,v_remaining,v_quarantine,v_oldest,v_hash,
      v_meta || jsonb_build_object('contract_version','phase45-v1'))
    on conflict (step_key) do nothing
    returning evidence_id into v_id;
    if v_id is not null then
      v_recorded := v_recorded + 1;
    end if;
    v_armed := true;
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'step_kind',v_kind,'status',v_status,'recorded',v_id is not null));
  end if;

  select exists (
    select 1 from public.os_docusign_archive_gate_clearing_evidence e
    where e.step_kind='remaining_unhashed_cleared'
  ) into v_cleared_unhashed;
  select exists (
    select 1 from public.os_docusign_archive_gate_clearing_evidence e
    where e.step_kind='quarantine_age_cleared'
  ) into v_cleared_age;
  select exists (
    select 1 from public.os_docusign_archive_gate_clearing_evidence e
    where e.step_kind='quarantine_backlog_cleared'
  ) into v_cleared_backlog;
  select exists (
    select 1 from public.os_docusign_archive_gate_clearing_evidence e
    where e.step_kind='first_quarterly_ready'
  ) into v_ready;
  select exists (
    select 1 from public.os_docusign_archive_gate_clearing_evidence e
    where e.step_kind='first_quarterly_completed'
  ) into v_completed;
  select exists (
    select 1 from public.os_docusign_archive_gate_clearing_evidence e
    where e.step_kind='recurring_quarterly_armed'
  ) into v_armed;

  return jsonb_build_object(
    'disposition','evaluated',
    'contract_version','phase45-v1',
    'recorded_count',v_recorded,
    'remaining_unhashed',v_remaining,
    'quarantine_backlog',v_quarantine,
    'quarantine_oldest_days',v_oldest,
    'aging_sla_days',v_aging_sla,
    'quarantine_backlog_gate',v_backlog_gate,
    'remaining_unhashed_cleared',v_cleared_unhashed,
    'quarantine_age_cleared',v_cleared_age,
    'quarantine_backlog_cleared',v_cleared_backlog,
    'first_quarterly_ready',v_ready,
    'first_quarterly_completed',v_completed,
    'recurring_quarterly_armed',v_armed,
    'steps_cleared',(
      (v_cleared_unhashed::integer)
      + (v_cleared_age::integer)
      + (v_cleared_backlog::integer)
      + (v_ready::integer)
      + (v_completed::integer)
      + (v_armed::integer)
    ),
    'steps_total',6,
    'steps_evaluated',v_steps
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record integrity cadence snapshot (sample + full + quarterly due)
-- ---------------------------------------------------------------------------
create or replace function public.record_docusign_integrity_cadence_snapshot_phase45(
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
  v_next_due timestamptz;
  v_sample_overdue boolean;
  v_full_overdue boolean;
  v_quarter_start timestamptz;
  v_next_quarter timestamptz;
  v_hash text;
  v_row public.os_docusign_archive_integrity_cadence_snapshots%rowtype;
begin
  if not public.phase45_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 45 cadence snapshot metadata is invalid or unsafe';
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

  v_full_overdue := public.is_docusign_quarterly_full_integrity_due();

  v_quarter_start := date_trunc('quarter', timezone('utc', now()));
  v_next_quarter := v_quarter_start + interval '3 months';
  if v_full_overdue then
    v_next_due := now();
  else
    v_next_due := v_next_quarter;
  end if;

  v_sample_overdue := false;
  if v_last_sample is null then
    v_sample_overdue := true;
  elsif v_last_sample < now() - make_interval(days => v_sample_sla) then
    v_sample_overdue := true;
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase45-v1',
    'kind','integrity_cadence_snapshot',
    'last_sample_at',v_last_sample,
    'last_full_at',v_last_full,
    'next_quarterly_due',v_next_due,
    'sample_overdue',v_sample_overdue,
    'full_overdue',v_full_overdue,
    'sample_sla_days',v_sample_sla,
    'metadata',v_meta
  )::text);

  insert into public.os_docusign_archive_integrity_cadence_snapshots(
    last_sample_at,last_full_at,next_quarterly_due,
    sample_overdue,full_overdue,metrics_sha256,metadata)
  values (
    v_last_sample,v_last_full,v_next_due,
    v_sample_overdue,v_full_overdue,v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase45-v1',
      'sample_sla_days',v_sample_sla
    ))
  returning * into v_row;

  return jsonb_build_object(
    'disposition','recorded',
    'snapshot_id',v_row.snapshot_id,
    'last_sample_at',v_row.last_sample_at,
    'last_full_at',v_row.last_full_at,
    'next_quarterly_due',v_row.next_quarterly_due,
    'sample_overdue',v_row.sample_overdue,
    'full_overdue',v_row.full_overdue,
    'metrics_sha256',v_row.metrics_sha256,
    'contract_version','phase45-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- List critical windows that still need an idempotent ops alert insert
-- ---------------------------------------------------------------------------
create or replace function public.list_docusign_archive_phase45_critical_windows(
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
  v_budget public.os_docusign_archive_drift_budgets%rowtype;
  v_drift public.os_docusign_archive_drift_snapshots%rowtype;
  v_cadence public.os_docusign_archive_integrity_cadence_snapshots%rowtype;
  v_gates jsonb;
  v_unlocked boolean;
  v_first_done boolean;
  v_armed boolean;
  v_steps_cleared integer := 0;
  v_key text;
  v_breach boolean := false;
begin
  v_bucket := to_char(
    to_timestamp(
      (floor(extract(epoch from now()) / (v_hours * 3600.0))
        * (v_hours * 3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  select * into v_budget
  from public.os_docusign_archive_drift_budgets b
  where b.status='active'
  order by b.created_at desc
  limit 1;

  select * into v_drift
  from public.os_docusign_archive_drift_snapshots
  order by created_at desc
  limit 1;

  select * into v_cadence
  from public.os_docusign_archive_integrity_cadence_snapshots
  order by created_at desc
  limit 1;

  v_gates := public.evaluate_docusign_first_quarterly_gates_phase43(null);
  v_unlocked := coalesce((v_gates->>'quarterly_unlocked')::boolean, false);
  v_first_done := coalesce((v_gates->>'first_quarterly_completed')::boolean, false);

  select exists (
    select 1 from public.os_docusign_archive_gate_clearing_evidence e
    where e.step_kind='recurring_quarterly_armed' and e.status='armed'
  ) into v_armed;

  select count(*)::integer into v_steps_cleared
  from public.os_docusign_archive_gate_clearing_evidence e
  where e.step_kind in (
    'remaining_unhashed_cleared',
    'quarantine_age_cleared',
    'quarantine_backlog_cleared',
    'first_quarterly_ready',
    'first_quarterly_completed',
    'recurring_quarterly_armed'
  );

  if v_budget.budget_id is not null
     and v_drift.snapshot_id is not null then
    if v_drift.content_drift_count > v_budget.max_content_drift_per_window then
      v_breach := true;
    end if;
    if v_drift.storage_unavailable_count > v_budget.max_storage_unavailable then
      v_breach := true;
    end if;
  end if;

  if v_breach then
    v_key := 'driftbudg:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase45_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','drift_budget_breach',
        'window_key',v_key,
        'severity','critical',
        'metrics_sha256',v_drift.metrics_sha256,
        'budget_id',v_budget.budget_id,
        'snapshot_id',v_drift.snapshot_id,
        'content_drift_count',v_drift.content_drift_count,
        'storage_unavailable_count',v_drift.storage_unavailable_count,
        'max_content_drift_per_window',v_budget.max_content_drift_per_window,
        'max_storage_unavailable',v_budget.max_storage_unavailable
      ));
    end if;
  end if;

  if not v_first_done and not v_unlocked then
    v_key := 'gatestall:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase45_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','gate_clearing_stalled',
        'window_key',v_key,
        'severity','critical',
        'steps_cleared',v_steps_cleared,
        'steps_total',6,
        'remaining_unhashed',coalesce((v_gates->>'remaining_unhashed')::integer,0),
        'quarantine_backlog',coalesce((v_gates->>'quarantine_backlog')::integer,0),
        'quarantine_oldest_days',coalesce((v_gates->>'quarantine_oldest_days')::integer,0)
      ));
    end if;
  end if;

  if v_first_done and not v_armed then
    v_key := 'recurunarm:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase45_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','recurring_quarterly_unarmed',
        'window_key',v_key,
        'severity','critical',
        'first_quarterly_completed',true,
        'recurring_quarterly_armed',false,
        'quarterly_unlocked',v_unlocked
      ));
    end if;
  end if;

  if v_cadence.snapshot_id is not null
     and (v_cadence.sample_overdue or v_cadence.full_overdue) then
    v_key := 'cadenceov:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase45_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','integrity_cadence_overdue',
        'window_key',v_key,
        'severity','critical',
        'metrics_sha256',v_cadence.metrics_sha256,
        'snapshot_id',v_cadence.snapshot_id,
        'sample_overdue',v_cadence.sample_overdue,
        'full_overdue',v_cadence.full_overdue,
        'last_sample_at',v_cadence.last_sample_at,
        'last_full_at',v_cadence.last_full_at,
        'next_quarterly_due',v_cadence.next_quarterly_due
      ));
    end if;
  end if;

  return jsonb_build_object(
    'version','phase45-v1',
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',v_pending
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record one critical ops alert after delivery attempt (idempotent window_key)
-- ---------------------------------------------------------------------------
create or replace function public.record_docusign_archive_phase45_ops_alert(
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
    raise exception 'Phase 45 ops alert payload must be a JSON object';
  end if;

  v_kind := coalesce(p_alert->>'alert_kind','');
  v_window := coalesce(p_alert->>'window_key','');
  v_dest := coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery := coalesce(p_alert->>'delivery_status','recorded');
  v_code := nullif(p_alert->>'response_code','')::integer;
  v_meta := coalesce(p_alert->'metadata','{}'::jsonb);

  if v_kind not in (
       'drift_budget_breach',
       'gate_clearing_stalled',
       'recurring_quarterly_unarmed',
       'integrity_cadence_overdue'
     )
     or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
     or v_dest ~* '://|^https?'
     or v_delivery not in
       ('delivered','skipped_no_webhook','failed','recorded')
     or not public.phase45_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 45 ops alert contract is invalid or unsafe';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase45-v1',
    'alert_kind',v_kind,
    'window_key',v_window,
    'severity','critical',
    'destination_key',v_dest,
    'delivery_status',v_delivery,
    'response_code',v_code
  )::text);

  insert into public.os_docusign_archive_phase45_ops_alerts(
    alert_kind,window_key,severity,destination_key,
    delivery_status,response_code,metrics_sha256,metadata)
  values (
    v_kind,v_window,'critical',v_dest,
    v_delivery,v_code,v_hash,
    v_meta || jsonb_build_object('contract_version','phase45-v1'))
  on conflict (window_key) do nothing
  returning alert_id, delivery_status into v_id, v_status;

  if v_id is null then
    select alert_id, delivery_status into v_id, v_status
    from public.os_docusign_archive_phase45_ops_alerts
    where window_key = v_window;
    return jsonb_build_object(
      'version','phase45-v1',
      'alert_id',v_id,
      'window_key',v_window,
      'delivery_status',v_status,
      'inserted',false);
  end if;

  return jsonb_build_object(
    'version','phase45-v1',
    'alert_id',v_id,
    'window_key',v_window,
    'delivery_status',v_status,
    'inserted',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Hub report: gate clearing, drift budget health, cadence visibility
-- ---------------------------------------------------------------------------
create or replace function public.get_docusign_archive_phase45_ops_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_budget public.os_docusign_archive_drift_budgets%rowtype;
  v_drift public.os_docusign_archive_drift_snapshots%rowtype;
  v_cadence public.os_docusign_archive_integrity_cadence_snapshots%rowtype;
  v_evidence jsonb;
  v_alerts jsonb;
  v_gates jsonb;
  v_steps_cleared integer := 0;
  v_armed boolean := false;
  v_first_done boolean := false;
  v_ready boolean := false;
  v_drift_budget_health text := 'unknown';
  v_cadence_health text := 'unknown';
  v_gate_progress text := 'unknown';
  v_alert_delivery text := 'none';
  v_critical_open integer := 0;
  v_remaining integer;
  v_quarantine integer;
begin
  select * into v_budget
  from public.os_docusign_archive_drift_budgets b
  where b.status='active'
  order by b.created_at desc
  limit 1;

  select * into v_drift
  from public.os_docusign_archive_drift_snapshots
  order by created_at desc
  limit 1;

  select * into v_cadence
  from public.os_docusign_archive_integrity_cadence_snapshots
  order by created_at desc
  limit 1;

  v_gates := public.evaluate_docusign_first_quarterly_gates_phase43(null);
  v_remaining := coalesce((v_gates->>'remaining_unhashed')::integer, 0);
  v_quarantine := coalesce((v_gates->>'quarantine_backlog')::integer, 0);
  v_first_done := coalesce((v_gates->>'first_quarterly_completed')::boolean, false);

  select count(*)::integer into v_steps_cleared
  from public.os_docusign_archive_gate_clearing_evidence e
  where e.step_kind in (
    'remaining_unhashed_cleared',
    'quarantine_age_cleared',
    'quarantine_backlog_cleared',
    'first_quarterly_ready',
    'first_quarterly_completed',
    'recurring_quarterly_armed'
  );

  select exists (
    select 1 from public.os_docusign_archive_gate_clearing_evidence e
    where e.step_kind='recurring_quarterly_armed' and e.status='armed'
  ) into v_armed;

  select exists (
    select 1 from public.os_docusign_archive_gate_clearing_evidence e
    where e.step_kind='first_quarterly_ready' and e.status='ready'
  ) into v_ready;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb)
  into v_evidence
  from (
    select evidence_id, step_key, step_kind, status, remaining_unhashed,
      quarantine_backlog, quarantine_oldest_days, metrics_sha256, created_at
    from public.os_docusign_archive_gate_clearing_evidence
    order by created_at desc
    limit 12
  ) e;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
  into v_alerts
  from (
    select alert_id, alert_kind, window_key, severity, destination_key,
      delivery_status, response_code, metrics_sha256, created_at
    from public.os_docusign_archive_phase45_ops_alerts
    order by created_at desc
    limit 20
  ) a;

  if v_armed then
    v_gate_progress := 'armed';
  elsif v_first_done or v_ready then
    v_gate_progress := 'advancing';
  elsif v_steps_cleared > 0 then
    v_gate_progress := 'partial';
  elsif coalesce((v_gates->>'quarterly_unlocked')::boolean, false) then
    v_gate_progress := 'ready';
  else
    v_gate_progress := 'blocked';
  end if;

  if v_budget.budget_id is not null and v_drift.snapshot_id is not null then
    if v_drift.content_drift_count > v_budget.max_content_drift_per_window
       or v_drift.storage_unavailable_count > v_budget.max_storage_unavailable then
      v_drift_budget_health := 'critical';
    elsif v_drift.content_drift_count > 0
       or v_drift.storage_unavailable_count > 0 then
      v_drift_budget_health := 'watch';
    else
      v_drift_budget_health := 'healthy';
    end if;
  elsif v_budget.budget_id is not null then
    v_drift_budget_health := 'healthy';
  end if;

  if v_cadence.snapshot_id is not null then
    if v_cadence.sample_overdue and v_cadence.full_overdue then
      v_cadence_health := 'critical';
    elsif v_cadence.sample_overdue or v_cadence.full_overdue then
      v_cadence_health := 'watch';
    else
      v_cadence_health := 'healthy';
    end if;
  end if;

  select count(*)::integer into v_critical_open
  from public.os_docusign_archive_phase45_ops_alerts a
  where a.created_at >= now() - interval '7 days';

  select coalesce((
    select case
      when bool_or(x.delivery_status = 'failed') then 'failed'
      when bool_or(x.delivery_status = 'skipped_no_webhook') then 'skipped_no_webhook'
      when bool_or(x.delivery_status = 'delivered') then 'delivered'
      when bool_or(x.delivery_status = 'recorded') then 'recorded'
      else 'none'
    end
    from public.os_docusign_archive_phase45_ops_alerts x
    where x.created_at >= now() - interval '7 days'
  ), 'none') into v_alert_delivery;

  return jsonb_build_object(
    'version','phase45-v1',
    'gate_clearing_progress',v_gate_progress,
    'steps_cleared',v_steps_cleared,
    'steps_total',6,
    'drift_budget_health',v_drift_budget_health,
    'cadence_health',v_cadence_health,
    'alert_delivery',v_alert_delivery,
    'critical_alert_count',v_critical_open,
    'remaining_unhashed',v_remaining,
    'quarantine_backlog',v_quarantine,
    'first_quarterly_ready',v_ready,
    'first_quarterly_completed',v_first_done,
    'recurring_quarterly_armed',v_armed,
    'latest_budget', case
      when v_budget.budget_id is null then null
      else jsonb_build_object(
        'budget_id',v_budget.budget_id,
        'budget_key',v_budget.budget_key,
        'max_content_drift_per_window',v_budget.max_content_drift_per_window,
        'max_storage_unavailable',v_budget.max_storage_unavailable,
        'window_days',v_budget.window_days,
        'status',v_budget.status,
        'metrics_sha256',v_budget.metrics_sha256,
        'created_at',v_budget.created_at
      )
    end,
    'latest_cadence', case
      when v_cadence.snapshot_id is null then null
      else jsonb_build_object(
        'snapshot_id',v_cadence.snapshot_id,
        'last_sample_at',v_cadence.last_sample_at,
        'last_full_at',v_cadence.last_full_at,
        'next_quarterly_due',v_cadence.next_quarterly_due,
        'sample_overdue',v_cadence.sample_overdue,
        'full_overdue',v_cadence.full_overdue,
        'metrics_sha256',v_cadence.metrics_sha256,
        'created_at',v_cadence.created_at
      )
    end,
    'gate_evidence',coalesce(v_evidence,'[]'::jsonb),
    'alerts',coalesce(v_alerts,'[]'::jsonb),
    'destination_key','ops_alerts'
  );
end;
$$;

revoke all on function public.reject_docusign_phase45_ops_mutation()
  from public, anon, authenticated;
revoke all on function public.upsert_docusign_archive_drift_budget_phase45(
  text,integer,integer,integer,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.evaluate_docusign_gate_clearing_phase45(jsonb)
  from public, anon, authenticated;
revoke all on function public.record_docusign_integrity_cadence_snapshot_phase45(
  jsonb,integer)
  from public, anon, authenticated;
revoke all on function public.list_docusign_archive_phase45_critical_windows(integer)
  from public, anon;
revoke all on function public.record_docusign_archive_phase45_ops_alert(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_docusign_archive_phase45_ops_report()
  from public, anon;

grant execute on function public.phase45_docusign_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.list_docusign_archive_phase45_critical_windows(integer)
  to authenticated, service_role;
grant execute on function public.get_docusign_archive_phase45_ops_report()
  to authenticated, service_role;
grant execute on function public.upsert_docusign_archive_drift_budget_phase45(
  text,integer,integer,integer,text,jsonb)
  to service_role;
grant execute on function public.evaluate_docusign_gate_clearing_phase45(jsonb)
  to service_role;
grant execute on function public.record_docusign_integrity_cadence_snapshot_phase45(
  jsonb,integer)
  to service_role;
grant execute on function public.record_docusign_archive_phase45_ops_alert(jsonb)
  to service_role;
grant execute on function public.os_sha256_hex(text)
  to authenticated, service_role;
