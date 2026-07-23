-- Phase 55: Finance Control Plane (IES orchestration).
-- Append-only KPI snapshots, close checklists, anomaly evidence, write-back gates.
-- Apply after Phase 54. Safe to re-run.
-- IES remains system of record — Tage orchestrates/observes only.
-- Fail-soft when IES feed tables are missing or partial.
-- Never auto-approves money. Never mutates snapshot retirement tables.
-- Dual-approve required for any write-back-style proposal; never silent IES write.

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

create or replace function public.phase55_finance_safe_detail(p_detail jsonb)
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
        '"[^"]*(payload|secret|token|password|authorization|cookie|body|bytes|base64|webhook_url)[^"]*"\s*:'
      and p_detail::text !~*
        '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
    );
$$;

create or replace function public.reject_finance_phase55_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Finance control plane Phase 55 evidence is append-only';
end;
$$;

-- ---------------------------------------------------------------------------
-- Append-only financial KPI snapshots (firm or entity-scoped).
-- ---------------------------------------------------------------------------
create table if not exists public.os_finance_kpi_phase55_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  cash_on_hand numeric(18,2),
  ar_balance numeric(18,2),
  ap_balance numeric(18,2),
  burn_rate_monthly numeric(18,2),
  close_pct_complete numeric(5,2)
    check (close_pct_complete is null or (
      close_pct_complete >= 0 and close_pct_complete <= 100
    )),
  open_anomaly_count integer not null default 0 check (open_anomaly_count >= 0),
  pending_writeback_count integer not null default 0
    check (pending_writeback_count >= 0),
  feed_status text not null default 'unknown'
    check (feed_status in ('ok','partial','missing','unknown')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_fin_kpi_p55_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=8192
      and public.phase55_finance_safe_detail(detail)
    ),
  constraint os_fin_kpi_p55_no_money_approve_check
    check (coalesce((detail->>'money_auto_approve')::boolean,false)=false)
);

create index if not exists os_fin_kpi_p55_entity_created_idx
  on public.os_finance_kpi_phase55_snapshots(entity_id, created_at desc);
create index if not exists os_fin_kpi_p55_created_idx
  on public.os_finance_kpi_phase55_snapshots(created_at desc);

alter table public.os_finance_kpi_phase55_snapshots enable row level security;
drop policy if exists "os_fin_kpi_p55_select"
  on public.os_finance_kpi_phase55_snapshots;
create policy "os_fin_kpi_p55_select"
  on public.os_finance_kpi_phase55_snapshots for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_finance_kpi_phase55_snapshots
  from public, anon, authenticated;
grant select on public.os_finance_kpi_phase55_snapshots
  to authenticated;

drop trigger if exists os_fin_kpi_p55_immutable
  on public.os_finance_kpi_phase55_snapshots;
create trigger os_fin_kpi_p55_immutable
  before update or delete on public.os_finance_kpi_phase55_snapshots
  for each row execute function public.reject_finance_phase55_mutation();
drop trigger if exists os_fin_kpi_p55_no_truncate
  on public.os_finance_kpi_phase55_snapshots;
create trigger os_fin_kpi_p55_no_truncate
  before truncate on public.os_finance_kpi_phase55_snapshots
  for each statement execute function public.reject_finance_phase55_mutation();

-- ---------------------------------------------------------------------------
-- Append-only month-end / year-end close checklist events.
-- ---------------------------------------------------------------------------
create table if not exists public.os_finance_close_checklist_phase55_events (
  event_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  close_kind text not null
    check (close_kind in ('month_end','year_end')),
  period_key text not null
    check (period_key ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$'),
  item_key text not null
    check (item_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$'),
  item_label text not null check (char_length(item_label) between 2 and 200),
  status text not null
    check (status in ('open','in_progress','blocked','done','waived')),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_fin_close_p55_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase55_finance_safe_detail(detail)
    ),
  constraint os_fin_close_p55_no_money_approve_check
    check (coalesce((detail->>'money_auto_approve')::boolean,false)=false)
);

create index if not exists os_fin_close_p55_entity_created_idx
  on public.os_finance_close_checklist_phase55_events(entity_id, created_at desc);
create index if not exists os_fin_close_p55_period_idx
  on public.os_finance_close_checklist_phase55_events(close_kind, period_key, created_at desc);

alter table public.os_finance_close_checklist_phase55_events enable row level security;
drop policy if exists "os_fin_close_p55_select"
  on public.os_finance_close_checklist_phase55_events;
create policy "os_fin_close_p55_select"
  on public.os_finance_close_checklist_phase55_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_finance_close_checklist_phase55_events
  from public, anon, authenticated;
grant select on public.os_finance_close_checklist_phase55_events
  to authenticated;

drop trigger if exists os_fin_close_p55_immutable
  on public.os_finance_close_checklist_phase55_events;
create trigger os_fin_close_p55_immutable
  before update or delete on public.os_finance_close_checklist_phase55_events
  for each row execute function public.reject_finance_phase55_mutation();
drop trigger if exists os_fin_close_p55_no_truncate
  on public.os_finance_close_checklist_phase55_events;
create trigger os_fin_close_p55_no_truncate
  before truncate on public.os_finance_close_checklist_phase55_events
  for each statement execute function public.reject_finance_phase55_mutation();

-- ---------------------------------------------------------------------------
-- Append-only anomaly evidence (visibility only).
-- ---------------------------------------------------------------------------
create table if not exists public.os_finance_anomaly_phase55_alerts (
  anomaly_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  anomaly_kind text not null
    check (anomaly_kind in (
      'balance_drift','close_slip','feed_gap','unusual_spend',
      'subsidiary_mismatch','manual_flag'
    )),
  severity text not null default 'warning'
    check (severity in ('info','warning','critical')),
  title text not null check (char_length(title) between 2 and 200),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_fin_anom_p55_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase55_finance_safe_detail(detail)
    ),
  constraint os_fin_anom_p55_no_money_approve_check
    check (coalesce((detail->>'money_auto_approve')::boolean,false)=false)
);

create index if not exists os_fin_anom_p55_created_idx
  on public.os_finance_anomaly_phase55_alerts(created_at desc);
create index if not exists os_fin_anom_p55_entity_idx
  on public.os_finance_anomaly_phase55_alerts(entity_id, created_at desc);

alter table public.os_finance_anomaly_phase55_alerts enable row level security;
drop policy if exists "os_fin_anom_p55_select"
  on public.os_finance_anomaly_phase55_alerts;
create policy "os_fin_anom_p55_select"
  on public.os_finance_anomaly_phase55_alerts for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_finance_anomaly_phase55_alerts
  from public, anon, authenticated;
grant select on public.os_finance_anomaly_phase55_alerts
  to authenticated;

drop trigger if exists os_fin_anom_p55_immutable
  on public.os_finance_anomaly_phase55_alerts;
create trigger os_fin_anom_p55_immutable
  before update or delete on public.os_finance_anomaly_phase55_alerts
  for each row execute function public.reject_finance_phase55_mutation();
drop trigger if exists os_fin_anom_p55_no_truncate
  on public.os_finance_anomaly_phase55_alerts;
create trigger os_fin_anom_p55_no_truncate
  before truncate on public.os_finance_anomaly_phase55_alerts
  for each statement execute function public.reject_finance_phase55_mutation();

-- ---------------------------------------------------------------------------
-- Write-back proposals (propose only — never silent IES write).
-- ---------------------------------------------------------------------------
create table if not exists public.os_finance_writeback_phase55_proposals (
  proposal_id uuid primary key default gen_random_uuid(),
  proposal_key text not null unique
    check (proposal_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  action_kind text not null
    check (action_kind in (
      'ies_journal_adjustment','ies_vendor_bill_note','ies_ar_memo',
      'ies_close_flag','ies_other_observe'
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
  constraint os_fin_wb_p55_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=8192
      and public.phase55_finance_safe_detail(detail)
    ),
  constraint os_fin_wb_p55_no_money_approve_check
    check (coalesce((detail->>'money_auto_approve')::boolean,false)=false),
  constraint os_fin_wb_p55_no_ies_auto_write_check
    check (coalesce((detail->>'ies_write_executed')::boolean,false)=false)
);

create unique index if not exists os_fin_wb_p55_one_pending_per_key
  on public.os_finance_writeback_phase55_proposals(proposal_key)
  where status = 'pending';

create index if not exists os_fin_wb_p55_status_created_idx
  on public.os_finance_writeback_phase55_proposals(status, created_at desc);
create index if not exists os_fin_wb_p55_entity_idx
  on public.os_finance_writeback_phase55_proposals(entity_id, created_at desc);

alter table public.os_finance_writeback_phase55_proposals enable row level security;
drop policy if exists "os_fin_wb_p55_select"
  on public.os_finance_writeback_phase55_proposals;
create policy "os_fin_wb_p55_select"
  on public.os_finance_writeback_phase55_proposals for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_finance_writeback_phase55_proposals
  from public, anon, authenticated;
grant select on public.os_finance_writeback_phase55_proposals
  to authenticated;

-- Proposals are append-only (status transitions insert new result rows).
drop trigger if exists os_fin_wb_p55_immutable
  on public.os_finance_writeback_phase55_proposals;
create trigger os_fin_wb_p55_immutable
  before update or delete on public.os_finance_writeback_phase55_proposals
  for each row execute function public.reject_finance_phase55_mutation();
drop trigger if exists os_fin_wb_p55_no_truncate
  on public.os_finance_writeback_phase55_proposals;
create trigger os_fin_wb_p55_no_truncate
  before truncate on public.os_finance_writeback_phase55_proposals
  for each statement execute function public.reject_finance_phase55_mutation();

create table if not exists public.os_finance_writeback_phase55_approvals (
  approval_id uuid primary key default gen_random_uuid(),
  approval_key text not null unique
    check (approval_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  proposal_id uuid not null
    references public.os_finance_writeback_phase55_proposals(proposal_id),
  actor_id uuid not null,
  decision text not null check (decision in ('approve','reject')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_fin_wb_appr_p55_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase55_finance_safe_detail(detail)
    )
);

create index if not exists os_fin_wb_appr_p55_proposal_idx
  on public.os_finance_writeback_phase55_approvals(proposal_id, created_at desc);

alter table public.os_finance_writeback_phase55_approvals enable row level security;
drop policy if exists "os_fin_wb_appr_p55_select"
  on public.os_finance_writeback_phase55_approvals;
create policy "os_fin_wb_appr_p55_select"
  on public.os_finance_writeback_phase55_approvals for select to authenticated
  using (true);
revoke all on public.os_finance_writeback_phase55_approvals
  from public, anon, authenticated;
grant select on public.os_finance_writeback_phase55_approvals
  to authenticated;

drop trigger if exists os_fin_wb_appr_p55_immutable
  on public.os_finance_writeback_phase55_approvals;
create trigger os_fin_wb_appr_p55_immutable
  before update or delete on public.os_finance_writeback_phase55_approvals
  for each row execute function public.reject_finance_phase55_mutation();
drop trigger if exists os_fin_wb_appr_p55_no_truncate
  on public.os_finance_writeback_phase55_approvals;
create trigger os_fin_wb_appr_p55_no_truncate
  before truncate on public.os_finance_writeback_phase55_approvals
  for each statement execute function public.reject_finance_phase55_mutation();

-- Optional ops alerts — append-only visibility.
create table if not exists public.os_finance_phase55_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  alert_kind text not null
    check (alert_kind in (
      'feed_missing','feed_partial','close_stale','refresh_failed',
      'writeback_pending','dual_approve_required'
    )),
  reference_id uuid,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null default 'warning'
    check (severity in ('info','warning','critical')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_fin_ops_p55_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase55_finance_safe_detail(detail)
    )
);

create index if not exists os_fin_ops_p55_created_idx
  on public.os_finance_phase55_ops_alerts(created_at desc);

alter table public.os_finance_phase55_ops_alerts enable row level security;
drop policy if exists "os_fin_ops_p55_select"
  on public.os_finance_phase55_ops_alerts;
create policy "os_fin_ops_p55_select"
  on public.os_finance_phase55_ops_alerts for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_finance_phase55_ops_alerts
  from public, anon, authenticated;
grant select on public.os_finance_phase55_ops_alerts
  to authenticated;

drop trigger if exists os_fin_ops_p55_immutable
  on public.os_finance_phase55_ops_alerts;
create trigger os_fin_ops_p55_immutable
  before update or delete on public.os_finance_phase55_ops_alerts
  for each row execute function public.reject_finance_phase55_mutation();
drop trigger if exists os_fin_ops_p55_no_truncate
  on public.os_finance_phase55_ops_alerts;
create trigger os_fin_ops_p55_no_truncate
  before truncate on public.os_finance_phase55_ops_alerts
  for each statement execute function public.reject_finance_phase55_mutation();

-- ---------------------------------------------------------------------------
-- Record a close checklist event (append-only orchestration; not an IES write).
-- ---------------------------------------------------------------------------
create or replace function public.record_finance_close_checklist_event_phase55(
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := nullif(trim(coalesce(p_payload->>'entity_id','')),'');
  v_kind text := nullif(trim(coalesce(p_payload->>'close_kind','')),'');
  v_period text := nullif(trim(coalesce(p_payload->>'period_key','')),'');
  v_item text := nullif(trim(coalesce(p_payload->>'item_key','')),'');
  v_label text := nullif(trim(coalesce(p_payload->>'item_label','')),'');
  v_status text := nullif(trim(coalesce(p_payload->>'status','')),'');
  v_actor uuid := nullif(p_payload->>'actor_id','')::uuid;
  v_meta jsonb := coalesce(p_payload->'detail', '{}'::jsonb);
  v_window text;
  v_hash text;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Phase 55 close checklist payload must be a JSON object';
  end if;
  if v_kind is null or v_kind not in ('month_end','year_end')
    or v_period is null or v_period !~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$'
    or v_item is null or v_item !~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$'
    or v_label is null or char_length(v_label) < 2
    or v_status is null
    or v_status not in ('open','in_progress','blocked','done','waived')
    or not public.phase55_finance_safe_detail(v_meta) then
    raise exception 'Phase 55 close checklist contract is invalid or unsafe';
  end if;
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 55 close checklist';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 55 close checklist';
  end if;

  v_window := left(
    'phase55:close:' || coalesce(v_entity,'firm') || ':' || v_kind || ':'
      || v_period || ':' || v_item || ':' || v_status || ':'
      || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24MI'),
    200
  );
  v_hash := public.os_sha256_hex(
    coalesce(v_entity,'firm') || '|' || v_kind || '|' || v_period || '|'
    || v_item || '|' || v_status || '|' || v_window
  );

  insert into public.os_finance_close_checklist_phase55_events (
    entity_id, close_kind, period_key, item_key, item_label, status,
    window_key, metrics_sha256, detail, actor_id
  ) values (
    v_entity, v_kind, v_period, v_item, left(v_label,200), v_status,
    v_window, v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase55-v1',
      'money_auto_approve',false,
      'ies_system_of_record',true
    ),
    v_actor
  )
  on conflict (window_key) do nothing
  returning event_id into v_id;

  if v_id is null then
    select event_id into v_id
    from public.os_finance_close_checklist_phase55_events
    where window_key = v_window;
  end if;

  return jsonb_build_object(
    'event_id', v_id,
    'window_key', v_window,
    'status', v_status,
    'money_auto_approve', false,
    'ies_write_executed', false,
    'contract_version', 'phase55-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Propose an IES write-back (NEVER executes — human dual-approve gate only).
-- ---------------------------------------------------------------------------
create or replace function public.propose_finance_writeback_phase55(
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
  v_row public.os_finance_writeback_phase55_proposals%rowtype;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Phase 55 write-back proposal payload must be a JSON object';
  end if;
  if v_actor is null
    or v_kind is null
    or v_kind not in (
      'ies_journal_adjustment','ies_vendor_bill_note','ies_ar_memo',
      'ies_close_flag','ies_other_observe'
    )
    or v_summary is null or char_length(v_summary) < 2
    or not public.phase55_finance_safe_detail(v_meta) then
    raise exception 'Phase 55 write-back proposal requires proposed_by, action_kind, summary, and safe detail';
  end if;
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 55 write-back proposal';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 55 write-back proposal';
  end if;

  v_key := left(
    'finwb55:' || coalesce(v_entity,'firm') || ':' || v_kind || ':'
      || public.os_sha256_hex(v_summary || '|' || v_actor::text),
    200
  );

  select * into v_row
  from public.os_finance_writeback_phase55_proposals
  where proposal_key = v_key and status = 'pending'
  order by created_at desc
  limit 1;
  if v_row.proposal_id is not null then
    return jsonb_build_object(
      'version','phase55-v1',
      'disposition','unchanged',
      'status','pending',
      'proposal_id',v_row.proposal_id,
      'proposal_key',v_row.proposal_key,
      'money_auto_approve',false,
      'ies_write_executed',false,
      'never_auto_approves_money',true
    );
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase55-v1',
    'kind','finance_writeback_proposal',
    'proposal_key',v_key,
    'entity_id',v_entity,
    'action_kind',v_kind,
    'proposed_by',v_actor
  )::text);

  insert into public.os_finance_writeback_phase55_proposals (
    proposal_key, entity_id, action_kind, summary, proposed_by,
    status, metrics_sha256, detail
  ) values (
    v_key, v_entity, v_kind, left(v_summary,500), v_actor,
    'pending', v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase55-v1',
      'money_auto_approve',false,
      'ies_write_executed',false,
      'ies_system_of_record',true,
      'dual_approve_required',true
    )
  )
  on conflict (proposal_key) do nothing
  returning * into v_row;

  if v_row.proposal_id is null then
    select * into v_row
    from public.os_finance_writeback_phase55_proposals
    where proposal_key = v_key
    order by created_at desc
    limit 1;
    return jsonb_build_object(
      'version','phase55-v1',
      'disposition','unchanged',
      'status',v_row.status,
      'proposal_id',v_row.proposal_id,
      'proposal_key',v_row.proposal_key,
      'money_auto_approve',false,
      'ies_write_executed',false,
      'never_auto_approves_money',true
    );
  end if;

  insert into public.os_finance_phase55_ops_alerts (
    entity_id, alert_kind, reference_id, window_key, severity,
    metrics_sha256, detail
  ) values (
    v_entity, 'dual_approve_required', v_row.proposal_id,
    left('phase55:alert:dual_approve:' || v_row.proposal_id::text, 200),
    'warning', v_hash,
    jsonb_build_object(
      'contract_version','phase55-v1',
      'money_auto_approve',false,
      'proposal_id',v_row.proposal_id
    )
  ) on conflict (window_key) do nothing;

  return jsonb_build_object(
    'version','phase55-v1',
    'disposition','proposed',
    'status','pending',
    'proposal_id',v_row.proposal_id,
    'proposal_key',v_row.proposal_key,
    'money_auto_approve',false,
    'ies_write_executed',false,
    'never_auto_approves_money',true
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Dual-human approval for write-back proposals.
-- After 2 DISTINCT approvers (neither is the proposer), status becomes
-- dual_approved. Tage NEVER writes to IES — operator executes in IES.
-- ---------------------------------------------------------------------------
create or replace function public.approve_finance_writeback_phase55(
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
  v_proposal public.os_finance_writeback_phase55_proposals%rowtype;
  v_approval_key text;
  v_hash text;
  v_id uuid;
  v_distinct_approvers integer := 0;
  v_result_key text;
  v_result_row public.os_finance_writeback_phase55_proposals%rowtype;
begin
  if p_proposal_id is null or p_actor_id is null
    or v_decision not in ('approve','reject')
    or not public.phase55_finance_safe_detail(v_meta) then
    raise exception 'Phase 55 dual-approve write-back contract is invalid or unsafe';
  end if;

  select * into v_proposal
  from public.os_finance_writeback_phase55_proposals
  where proposal_id = p_proposal_id;
  if v_proposal.proposal_id is null then
    raise exception 'Phase 55 write-back proposal is unknown';
  end if;
  if v_proposal.proposed_by = p_actor_id then
    raise exception 'Proposer may not also approve their own Phase 55 write-back proposal';
  end if;
  if v_proposal.status <> 'pending' then
    return jsonb_build_object(
      'version','phase55-v1',
      'disposition','unchanged',
      'status',v_proposal.status,
      'proposal_id',v_proposal.proposal_id,
      'money_auto_approve',false,
      'ies_write_executed',false,
      'never_auto_approves_money',true
    );
  end if;

  v_approval_key := left(p_proposal_id::text || ':' || p_actor_id::text, 200);
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase55-v1',
    'kind','finance_writeback_approval',
    'proposal_id',p_proposal_id,
    'actor_id',p_actor_id,
    'decision',v_decision
  )::text);

  insert into public.os_finance_writeback_phase55_approvals (
    approval_key, proposal_id, actor_id, decision, metrics_sha256, detail
  ) values (
    v_approval_key, p_proposal_id, p_actor_id, v_decision, v_hash,
    v_meta || jsonb_build_object('contract_version','phase55-v1')
  )
  on conflict (approval_key) do nothing
  returning approval_id into v_id;

  if v_id is null then
    return jsonb_build_object(
      'version','phase55-v1',
      'disposition','unchanged',
      'status','duplicate_actor_decision',
      'proposal_id',p_proposal_id,
      'money_auto_approve',false,
      'ies_write_executed',false,
      'never_auto_approves_money',true
    );
  end if;

  if v_decision = 'reject' then
    v_result_key := left('finwb55:rejected:' || p_proposal_id::text, 200);
    insert into public.os_finance_writeback_phase55_proposals (
      proposal_key, source_proposal_id, entity_id, action_kind, summary,
      proposed_by, status, block_reason, metrics_sha256, detail
    ) values (
      v_result_key, p_proposal_id, v_proposal.entity_id, v_proposal.action_kind,
      v_proposal.summary, v_proposal.proposed_by, 'rejected',
      'rejected_by_approver',
      public.os_sha256_hex('reject:' || p_proposal_id::text),
      v_meta || jsonb_build_object(
        'contract_version','phase55-v1',
        'money_auto_approve',false,
        'ies_write_executed',false
      )
    )
    on conflict (proposal_key) do nothing;
    return jsonb_build_object(
      'version','phase55-v1',
      'disposition','rejected',
      'status','rejected',
      'proposal_id',p_proposal_id,
      'money_auto_approve',false,
      'ies_write_executed',false,
      'never_auto_approves_money',true
    );
  end if;

  select count(distinct actor_id)::integer into v_distinct_approvers
  from public.os_finance_writeback_phase55_approvals
  where proposal_id = p_proposal_id
    and decision = 'approve'
    and actor_id <> v_proposal.proposed_by;

  if v_distinct_approvers < 2 then
    return jsonb_build_object(
      'version','phase55-v1',
      'disposition','awaiting_second_approval',
      'status','pending',
      'proposal_id',p_proposal_id,
      'distinct_approvers',v_distinct_approvers,
      'money_auto_approve',false,
      'ies_write_executed',false,
      'never_auto_approves_money',true
    );
  end if;

  -- Dual-human gate satisfied. NEVER execute IES write from Tage.
  v_result_key := left('finwb55:dual_approved:' || p_proposal_id::text, 200);
  insert into public.os_finance_writeback_phase55_proposals (
    proposal_key, source_proposal_id, entity_id, action_kind, summary,
    proposed_by, status, metrics_sha256, detail
  ) values (
    v_result_key, p_proposal_id, v_proposal.entity_id, v_proposal.action_kind,
    v_proposal.summary, v_proposal.proposed_by, 'dual_approved',
    public.os_sha256_hex('dual_approved:' || p_proposal_id::text),
    v_meta || jsonb_build_object(
      'contract_version','phase55-v1',
      'money_auto_approve',false,
      'ies_write_executed',false,
      'dual_approved',true,
      'operator_must_execute_in_ies',true
    )
  )
  on conflict (proposal_key) do nothing
  returning * into v_result_row;

  return jsonb_build_object(
    'version','phase55-v1',
    'disposition','dual_approved',
    'status','dual_approved',
    'proposal_id',coalesce(v_result_row.proposal_id,p_proposal_id),
    'source_proposal_id',p_proposal_id,
    'distinct_approvers',v_distinct_approvers,
    'money_auto_approve',false,
    'ies_write_executed',false,
    'never_auto_approves_money',true,
    'todo','Operator executes approved write-back in IES (system of record)'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Refresh finance control plane from optional IES feed (fail-soft).
-- TODO: wire live IES feed tables/APIs when available
-- (e.g. os_ies_finance_feed / future ies_kpi_facts). Until then,
-- records empty KPI stubs with feed_status=missing.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_finance_control_plane_phase55(
  p_actor_id uuid default null,
  p_entity_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity text := nullif(trim(coalesce(p_entity_id,'')),'');
  v_has_ies boolean := false;
  v_has_partial boolean := false;
  v_feed text := 'missing';
  v_cash numeric;
  v_ar numeric;
  v_ap numeric;
  v_burn numeric;
  v_close_pct numeric;
  v_anomaly_count integer := 0;
  v_pending_wb integer := 0;
  v_window text;
  v_hash text;
  v_id uuid;
  v_sub_has boolean;
begin
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 55 finance refresh';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 55 finance refresh';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is null then
    raise exception 'Firm-wide access or entity filter required for Phase 55 finance refresh';
  end if;

  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_ies_finance_feed'
  ) into v_has_ies;

  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='ies_kpi_facts'
  ) into v_has_partial;

  if v_has_ies then
    v_feed := 'ok';
  elsif v_has_partial then
    v_feed := 'partial';
  else
    -- TODO: wire IES feed when tables/API land; empty KPI stubs until then.
    v_feed := 'missing';
  end if;

  if v_has_ies then
    begin
      execute format(
        'select cash_on_hand, ar_balance, ap_balance, burn_rate_monthly, close_pct_complete
         from public.os_ies_finance_feed
         where ($1 is null or entity_id = $1)
         order by as_of desc nulls last, created_at desc
         limit 1'
      )
      into v_cash, v_ar, v_ap, v_burn, v_close_pct
      using v_entity;
    exception when others then
      v_feed := 'partial';
      v_cash := null;
      v_ar := null;
      v_ap := null;
      v_burn := null;
      v_close_pct := null;
    end;
  elsif v_has_partial then
    begin
      execute format(
        'select cash_on_hand, ar_balance, ap_balance
         from public.ies_kpi_facts
         where ($1 is null or entity_id = $1)
         order by as_of desc nulls last
         limit 1'
      )
      into v_cash, v_ar, v_ap
      using v_entity;
      v_burn := null;
      v_close_pct := null;
    exception when others then
      v_feed := 'missing';
      v_cash := null;
      v_ar := null;
      v_ap := null;
    end;
  end if;

  select count(*)::integer into v_anomaly_count
  from public.os_finance_anomaly_phase55_alerts a
  where a.created_at >= now() - interval '30 days'
    and (v_entity is null or a.entity_id = v_entity);

  select count(*)::integer into v_pending_wb
  from public.os_finance_writeback_phase55_proposals p
  where p.status = 'pending'
    and p.source_proposal_id is null
    and (v_entity is null or p.entity_id = v_entity)
    and not exists (
      select 1
      from public.os_finance_writeback_phase55_proposals c
      where c.source_proposal_id = p.proposal_id
        and c.status in ('dual_approved','rejected','blocked','superseded')
    );

  -- Seed default month-end checklist stubs when none exist for current period.
  if not exists (
    select 1 from public.os_finance_close_checklist_phase55_events e
    where e.close_kind = 'month_end'
      and e.period_key = to_char(now() at time zone 'utc','YYYY-MM')
      and (v_entity is null and e.entity_id is null
           or v_entity is not null and e.entity_id = v_entity)
  ) then
    perform public.record_finance_close_checklist_event_phase55(
      jsonb_build_object(
        'entity_id', v_entity,
        'close_kind', 'month_end',
        'period_key', to_char(now() at time zone 'utc','YYYY-MM'),
        'item_key', 'bank_rec',
        'item_label', 'Bank reconciliation',
        'status', 'open',
        'actor_id', p_actor_id,
        'detail', jsonb_build_object('source','refresh_finance_control_plane_phase55')
      )
    );
    perform public.record_finance_close_checklist_event_phase55(
      jsonb_build_object(
        'entity_id', v_entity,
        'close_kind', 'month_end',
        'period_key', to_char(now() at time zone 'utc','YYYY-MM'),
        'item_key', 'ap_aging',
        'item_label', 'AP aging review',
        'status', 'open',
        'actor_id', p_actor_id,
        'detail', jsonb_build_object('source','refresh_finance_control_plane_phase55')
      )
    );
    perform public.record_finance_close_checklist_event_phase55(
      jsonb_build_object(
        'entity_id', v_entity,
        'close_kind', 'month_end',
        'period_key', to_char(now() at time zone 'utc','YYYY-MM'),
        'item_key', 'ar_aging',
        'item_label', 'AR aging review',
        'status', 'open',
        'actor_id', p_actor_id,
        'detail', jsonb_build_object('source','refresh_finance_control_plane_phase55')
      )
    );
    perform public.record_finance_close_checklist_event_phase55(
      jsonb_build_object(
        'entity_id', v_entity,
        'close_kind', 'month_end',
        'period_key', to_char(now() at time zone 'utc','YYYY-MM'),
        'item_key', 'intercompany',
        'item_label', 'Intercompany tie-out',
        'status', 'open',
        'actor_id', p_actor_id,
        'detail', jsonb_build_object('source','refresh_finance_control_plane_phase55')
      )
    );
  end if;

  -- Recruit-first subsidiary visibility; ENT-INDA shown when evidence exists.
  v_sub_has := (v_has_ies or v_has_partial);

  if v_feed = 'missing' then
    insert into public.os_finance_anomaly_phase55_alerts (
      entity_id, anomaly_kind, severity, title, window_key,
      metrics_sha256, detail
    ) values (
      coalesce(v_entity, 'ENT-R619'), 'feed_gap', 'warning',
      'IES finance feed missing — KPI panels are stubs',
      left(
        'phase55:anom:feed_gap:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      public.os_sha256_hex('feed_gap|' || coalesce(v_entity,'firm')),
      jsonb_build_object(
        'contract_version','phase55-v1',
        'money_auto_approve',false,
        'todo','Wire IES feed tables/API'
      )
    ) on conflict (window_key) do nothing;
  end if;

  v_window := left(
    'phase55:kpi:' || coalesce(v_entity,'firm') || ':'
      || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24'),
    200
  );
  v_hash := public.os_sha256_hex(
    coalesce(v_entity,'firm') || '|' || coalesce(v_cash::text,'') || '|'
    || coalesce(v_ar::text,'') || '|' || coalesce(v_anomaly_count,0)::text
    || '|' || v_feed || '|' || v_window
  );

  insert into public.os_finance_kpi_phase55_snapshots (
    entity_id, window_key, cash_on_hand, ar_balance, ap_balance,
    burn_rate_monthly, close_pct_complete, open_anomaly_count,
    pending_writeback_count, feed_status, metrics_sha256, detail, actor_id
  ) values (
    v_entity, v_window, v_cash, v_ar, v_ap, v_burn, v_close_pct,
    coalesce(v_anomaly_count,0), coalesce(v_pending_wb,0), v_feed, v_hash,
    jsonb_build_object(
      'contract_version','phase55-v1',
      'source','refresh_finance_control_plane_phase55',
      'has_ies_feed', v_has_ies,
      'has_partial_kpi', v_has_partial,
      'subsidiary_hint','ENT-R619',
      'subsidiary_inda_probe', v_sub_has,
      'money_auto_approve', false,
      'ies_system_of_record', true
    ),
    p_actor_id
  )
  on conflict (window_key) do nothing
  returning snapshot_id into v_id;

  if v_id is null then
    select snapshot_id into v_id
    from public.os_finance_kpi_phase55_snapshots
    where window_key = v_window;
  end if;

  if v_feed = 'missing' then
    insert into public.os_finance_phase55_ops_alerts (
      entity_id, alert_kind, reference_id, window_key, severity,
      metrics_sha256, detail
    ) values (
      v_entity, 'feed_missing', v_id,
      left(
        'phase55:alert:feed_missing:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      'warning', v_hash,
      jsonb_build_object(
        'contract_version','phase55-v1',
        'money_auto_approve',false
      )
    ) on conflict (window_key) do nothing;
  end if;

  if v_feed = 'partial' then
    insert into public.os_finance_phase55_ops_alerts (
      entity_id, alert_kind, reference_id, window_key, severity,
      metrics_sha256, detail
    ) values (
      v_entity, 'feed_partial', v_id,
      left(
        'phase55:alert:feed_partial:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      'info', v_hash,
      jsonb_build_object(
        'contract_version','phase55-v1',
        'money_auto_approve',false
      )
    ) on conflict (window_key) do nothing;
  end if;

  if coalesce(v_pending_wb,0) > 0 then
    insert into public.os_finance_phase55_ops_alerts (
      entity_id, alert_kind, reference_id, window_key, severity,
      metrics_sha256, detail
    ) values (
      v_entity, 'writeback_pending', v_id,
      left(
        'phase55:alert:writeback_pending:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      'warning', v_hash,
      jsonb_build_object(
        'contract_version','phase55-v1',
        'pending_count', v_pending_wb,
        'money_auto_approve',false
      )
    ) on conflict (window_key) do nothing;
  end if;

  return jsonb_build_object(
    'snapshot_id', v_id,
    'entity_id', v_entity,
    'cash_on_hand', v_cash,
    'ar_balance', v_ar,
    'ap_balance', v_ap,
    'burn_rate_monthly', v_burn,
    'close_pct_complete', v_close_pct,
    'open_anomaly_count', coalesce(v_anomaly_count,0),
    'pending_writeback_count', coalesce(v_pending_wb,0),
    'feed_status', v_feed,
    'money_auto_approve', false,
    'ies_write_executed', false,
    'contract_version', 'phase55-v1'
  );
end $$;

create or replace function public.get_finance_control_plane_phase55_report(
  p_entity_id text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_entity text := nullif(trim(coalesce(p_entity_id,'')),'');
  v_latest public.os_finance_kpi_phase55_snapshots%rowtype;
  v_checklist jsonb := '[]'::jsonb;
  v_anomalies jsonb := '[]'::jsonb;
  v_proposals jsonb := '[]'::jsonb;
  v_alerts jsonb := '[]'::jsonb;
  v_subsidiaries jsonb := '[]'::jsonb;
  v_inda_exists boolean := false;
  v_period text := to_char(now() at time zone 'utc','YYYY-MM');
begin
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 55 finance report';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 55 finance report';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is null then
    raise exception 'Firm-wide access or entity filter required for Phase 55 finance report';
  end if;

  select * into v_latest
  from public.os_finance_kpi_phase55_snapshots s
  where (v_entity is null and s.entity_id is null)
     or (v_entity is not null and s.entity_id = v_entity)
  order by s.created_at desc
  limit 1;

  select coalesce(jsonb_agg(row_to_json(c)::jsonb order by c.created_at desc), '[]'::jsonb)
  into v_checklist
  from (
    select distinct on (e.item_key)
      e.event_id, e.entity_id, e.close_kind, e.period_key, e.item_key,
      e.item_label, e.status, e.created_at
    from public.os_finance_close_checklist_phase55_events e
    where e.close_kind = 'month_end'
      and e.period_key = v_period
      and (v_entity is null or e.entity_id = v_entity or e.entity_id is null)
    order by e.item_key, e.created_at desc
  ) c;

  select coalesce(jsonb_agg(row_to_json(a)::jsonb order by a.created_at desc), '[]'::jsonb)
  into v_anomalies
  from (
    select an.anomaly_id, an.entity_id, an.anomaly_kind, an.severity,
           an.title, an.created_at
    from public.os_finance_anomaly_phase55_alerts an
    where (v_entity is null or an.entity_id = v_entity)
    order by an.created_at desc
    limit 40
  ) a;

  select coalesce(jsonb_agg(row_to_json(p)::jsonb order by p.created_at desc), '[]'::jsonb)
  into v_proposals
  from (
    select pr.proposal_id, pr.entity_id, pr.action_kind, pr.summary,
           pr.proposed_by, pr.status, pr.created_at
    from public.os_finance_writeback_phase55_proposals pr
    where (v_entity is null or pr.entity_id = v_entity)
      and (
        (
          pr.status = 'pending'
          and pr.source_proposal_id is null
          and not exists (
            select 1
            from public.os_finance_writeback_phase55_proposals c
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

  select coalesce(jsonb_agg(row_to_json(al)::jsonb order by al.created_at desc), '[]'::jsonb)
  into v_alerts
  from (
    select o.alert_id, o.alert_kind, o.severity, o.entity_id, o.created_at
    from public.os_finance_phase55_ops_alerts o
    where (v_entity is null or o.entity_id = v_entity)
    order by o.created_at desc
    limit 12
  ) al;

  -- Subsidiary financial visibility: Recruit first; ENT-INDA if any evidence.
  select (
    exists (
      select 1 from public.os_finance_kpi_phase55_snapshots s
      where s.entity_id = 'ENT-INDA'
    )
    or exists (
      select 1 from public.os_finance_anomaly_phase55_alerts a
      where a.entity_id = 'ENT-INDA'
    )
  ) into v_inda_exists;

  v_subsidiaries := jsonb_build_array(
    jsonb_build_object(
      'entity_id', 'ENT-R619',
      'name', 'Recruit 619',
      'priority', 1,
      'feed_status', coalesce(v_latest.feed_status, 'missing'),
      'has_data', coalesce(v_latest.feed_status,'missing') in ('ok','partial'),
      'todo', 'IES feed pending — Recruit KPIs are orchestration stubs'
    )
  );

  if v_inda_exists then
    v_subsidiaries := v_subsidiaries || jsonb_build_array(
      jsonb_build_object(
        'entity_id', 'ENT-INDA',
        'name', 'Instant NDA',
        'priority', 2,
        'feed_status', 'partial',
        'has_data', true,
        'todo', null
      )
    );
  else
    v_subsidiaries := v_subsidiaries || jsonb_build_array(
      jsonb_build_object(
        'entity_id', 'ENT-INDA',
        'name', 'Instant NDA',
        'priority', 2,
        'feed_status', 'missing',
        'has_data', false,
        'todo', 'TODO: show ENT-INDA financials when IES/entity evidence exists'
      )
    );
  end if;

  if v_latest.snapshot_id is null then
    return jsonb_build_object(
      'entity_id', v_entity,
      'cash_on_hand', null,
      'ar_balance', null,
      'ap_balance', null,
      'burn_rate_monthly', null,
      'close_pct_complete', null,
      'open_anomaly_count', 0,
      'pending_writeback_count', 0,
      'feed_status', 'missing',
      'snapshot_id', null,
      'captured_at', null,
      'checklist', v_checklist,
      'anomalies', v_anomalies,
      'writeback_proposals', v_proposals,
      'recent_alerts', v_alerts,
      'subsidiaries', v_subsidiaries,
      'entity_filter_hint', 'ENT-R619',
      'todo', 'Refresh finance board; wire IES feed when available',
      'money_auto_approve', false,
      'ies_write_executed', false,
      'ies_system_of_record', true,
      'contract_version', 'phase55-v1'
    );
  end if;

  return jsonb_build_object(
    'entity_id', v_entity,
    'cash_on_hand', v_latest.cash_on_hand,
    'ar_balance', v_latest.ar_balance,
    'ap_balance', v_latest.ap_balance,
    'burn_rate_monthly', v_latest.burn_rate_monthly,
    'close_pct_complete', v_latest.close_pct_complete,
    'open_anomaly_count', v_latest.open_anomaly_count,
    'pending_writeback_count', v_latest.pending_writeback_count,
    'feed_status', v_latest.feed_status,
    'snapshot_id', v_latest.snapshot_id,
    'captured_at', v_latest.created_at,
    'checklist', v_checklist,
    'anomalies', v_anomalies,
    'writeback_proposals', v_proposals,
    'recent_alerts', v_alerts,
    'subsidiaries', v_subsidiaries,
    'entity_filter_hint', 'ENT-R619',
    'todo', 'IES remains system of record; dual-approve write-backs before operator executes in IES',
    'money_auto_approve', false,
    'ies_write_executed', false,
    'ies_system_of_record', true,
    'contract_version', 'phase55-v1'
  );
end $$;

revoke all on function public.record_finance_close_checklist_event_phase55(jsonb)
  from public, anon, authenticated;
revoke all on function public.propose_finance_writeback_phase55(jsonb)
  from public, anon, authenticated;
revoke all on function public.approve_finance_writeback_phase55(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.refresh_finance_control_plane_phase55(uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_finance_control_plane_phase55_report(text)
  from public, anon, authenticated;

grant execute on function public.record_finance_close_checklist_event_phase55(jsonb)
  to authenticated, service_role;
grant execute on function public.propose_finance_writeback_phase55(jsonb)
  to authenticated, service_role;
grant execute on function public.approve_finance_writeback_phase55(uuid, uuid, text, jsonb)
  to authenticated, service_role;
grant execute on function public.refresh_finance_control_plane_phase55(uuid, text)
  to authenticated, service_role;
grant execute on function public.get_finance_control_plane_phase55_report(text)
  to authenticated, service_role;
