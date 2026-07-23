-- Phase 51: escalation when a protected_branch_cutover_blocked PAGE RECEIPT
-- itself fails delivery, evidence that the CI path-guard is configured as a
-- REQUIRED status check for cutover-adjacent PRs, and continued Stage 4e
-- soak trend rollups. Apply after phase50_snapshot_cutover_ops.sql.
-- Public-key metadata / branch / path / GitHub check-context names only —
-- never store private keys or tokens.
-- qualification_eligible / attestation_eligible / production_relation_mutated
-- remain false always. This file NEVER references the retired snapshot
-- store table.

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

create or replace function public.phase50_snapshot_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body|private_key|webhook_url)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

create or replace function public.phase51_snapshot_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select public.phase50_snapshot_safe_detail(p_detail);
$$;

-- ---------------------------------------------------------------------------
-- Append-only escalation receipts raised when a Phase 50
-- protected_branch_cutover_blocked page receipt itself has delivery_status
-- ='failed' and no later 'sent' receipt exists for the same alert. Purely
-- additive visibility — never mutates the Phase 49/50 alert or receipt rows.
-- ---------------------------------------------------------------------------
create table if not exists public.os_snapshot_phase51_page_failure_escalations (
  escalation_id uuid primary key default gen_random_uuid(),
  alert_id uuid not null
    references public.os_snapshot_phase49_ops_alerts(alert_id),
  failed_receipt_id uuid not null
    references public.os_snapshot_phase50_page_receipts(receipt_id),
  window_key text not null unique,
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id),
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint os_snapshot_p51_pagefail_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_snapshot_p51_pagefail_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_p51_pagefail_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_p51_pagefail_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);

create index if not exists os_snapshot_p51_pagefail_alert_idx
  on public.os_snapshot_phase51_page_failure_escalations(alert_id,created_at desc);

-- ---------------------------------------------------------------------------
-- Append-only evidence that the CI path-guard is (or is not) configured as
-- a REQUIRED status check for cutover-adjacent PRs on the protected branch.
-- Recorded by a small verification script (service_role) that reads GitHub
-- branch-protection required-status-check contexts — this table stores only
-- the branch name, the check context name, and a boolean; never a token.
-- ---------------------------------------------------------------------------
create table if not exists public.os_snapshot_phase51_required_check_verifications (
  verification_id uuid primary key default gen_random_uuid(),
  branch_name text not null,
  check_context text not null,
  required boolean not null,
  window_key text not null unique,
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id),
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint os_snapshot_p51_reqcheck_branch_check
    check (branch_name ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$'),
  constraint os_snapshot_p51_reqcheck_context_check
    check (check_context ~ '^[A-Za-z0-9][A-Za-z0-9 ._/:-]{0,199}$'),
  constraint os_snapshot_p51_reqcheck_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_snapshot_p51_reqcheck_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_p51_reqcheck_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_p51_reqcheck_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);

create index if not exists os_snapshot_p51_reqcheck_required_idx
  on public.os_snapshot_phase51_required_check_verifications(required,created_at desc);

-- ---------------------------------------------------------------------------
-- Append-only Stage 4e soak TREND rollups over the last few Phase 50 soak
-- status snapshots — continues the soak observation with a trend direction
-- rather than a single point-in-time health value.
-- ---------------------------------------------------------------------------
create table if not exists public.os_snapshot_phase51_soak_trend_snapshots (
  trend_id uuid primary key default gen_random_uuid(),
  window_key text not null unique,
  snapshots_compared integer not null default 0 check (snapshots_compared >= 0),
  latest_blocked_rate numeric(6,4),
  prior_blocked_rate numeric(6,4),
  trend_direction text not null default 'unknown'
    check (trend_direction in ('improving','stable','declining','unknown')),
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_snapshot_p51_soaktrend_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_snapshot_p51_soaktrend_rate_check
    check (
      (latest_blocked_rate is null or (latest_blocked_rate>=0 and latest_blocked_rate<=1))
      and (prior_blocked_rate is null or (prior_blocked_rate>=0 and prior_blocked_rate<=1))
    ),
  constraint os_snapshot_p51_soaktrend_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_p51_soaktrend_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

create table if not exists public.os_snapshot_phase51_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  alert_kind text not null,
  reference_id uuid,
  window_key text not null unique,
  severity text not null default 'warning',
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint os_snapshot_p51_alert_kind_check
    check (alert_kind in (
      'page_delivery_escalated',
      'required_check_missing',
      'soak_trend_declining'
    )),
  constraint os_snapshot_p51_alert_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_snapshot_p51_alert_severity_check
    check (severity in ('warning','critical')),
  constraint os_snapshot_p51_alert_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_p51_alert_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_p51_alert_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);

create or replace function public.prevent_snapshot_phase51_append_only()
returns trigger language plpgsql as $$
begin raise exception '% is append-only',tg_table_name; end $$;

drop trigger if exists os_snapshot_p51_pagefail_immutable
  on public.os_snapshot_phase51_page_failure_escalations;
create trigger os_snapshot_p51_pagefail_immutable
  before update or delete or truncate
  on public.os_snapshot_phase51_page_failure_escalations for each statement
  execute function public.prevent_snapshot_phase51_append_only();

drop trigger if exists os_snapshot_p51_reqcheck_immutable
  on public.os_snapshot_phase51_required_check_verifications;
create trigger os_snapshot_p51_reqcheck_immutable
  before update or delete or truncate
  on public.os_snapshot_phase51_required_check_verifications for each statement
  execute function public.prevent_snapshot_phase51_append_only();

drop trigger if exists os_snapshot_p51_soaktrend_immutable
  on public.os_snapshot_phase51_soak_trend_snapshots;
create trigger os_snapshot_p51_soaktrend_immutable
  before update or delete or truncate
  on public.os_snapshot_phase51_soak_trend_snapshots for each statement
  execute function public.prevent_snapshot_phase51_append_only();

drop trigger if exists os_snapshot_p51_ops_alert_immutable
  on public.os_snapshot_phase51_ops_alerts;
create trigger os_snapshot_p51_ops_alert_immutable
  before update or delete or truncate
  on public.os_snapshot_phase51_ops_alerts for each statement
  execute function public.prevent_snapshot_phase51_append_only();

-- Escalate any Phase 50 protected_branch_cutover_blocked page receipt whose
-- delivery itself failed and has no later 'sent' receipt for the same
-- alert. Read + append-only — never retries delivery itself (that remains
-- the TS worker's job) and never mutates the Phase 49/50 rows.
create or replace function public.escalate_snapshot_phase51_page_delivery_failures(
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_window text;
  v_hash text;
  v_id uuid;
  v_escalated integer := 0;
begin
  if p_actor_id is not null
     and not public.phase40_snapshot_actor_authorized(p_actor_id,null)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Phase 51 page-failure escalation authorization failed';
  end if;

  for v_row in
    select distinct on (r.alert_id)
      r.alert_id, r.receipt_id, r.delivery_status, r.created_at
    from public.os_snapshot_phase50_page_receipts r
    order by r.alert_id, r.created_at desc
  loop
    if v_row.delivery_status <> 'failed' then
      continue;
    end if;

    v_window := 'phase51:pagefail:' || v_row.receipt_id::text;
    if exists (
      select 1 from public.os_snapshot_phase51_page_failure_escalations e
      where e.window_key=v_window
    ) then
      continue;
    end if;

    v_hash := public.os_sha256_hex(jsonb_build_object(
      'alert_id',v_row.alert_id,
      'contract_version','phase51-v1',
      'failed_receipt_id',v_row.receipt_id,
      'window_key',v_window
    )::text);

    insert into public.os_snapshot_phase51_page_failure_escalations(
      alert_id,failed_receipt_id,window_key,metrics_sha256,detail,actor_id
    ) values (
      v_row.alert_id,v_row.receipt_id,v_window,v_hash,
      jsonb_build_object(
        'contract_version','phase51-v1',
        'source','escalate_snapshot_phase51_page_delivery_failures'
      ),
      p_actor_id
    )
    on conflict (window_key) do nothing
    returning escalation_id into v_id;

    if v_id is not null then
      v_escalated := v_escalated + 1;
      insert into public.os_snapshot_phase51_ops_alerts(
        alert_kind,reference_id,window_key,severity,metrics_sha256,detail,
        qualification_eligible,attestation_eligible,production_relation_mutated
      ) values (
        'page_delivery_escalated',v_id,'phase51:alert:'||v_window,'critical',
        v_hash,
        jsonb_build_object(
          'contract_version','phase51-v1',
          'source','escalate_snapshot_phase51_page_delivery_failures'
        ),
        false,false,false
      ) on conflict (window_key) do nothing;
    end if;
  end loop;

  return jsonb_build_object(
    'escalated',v_escalated,
    'contract_version','phase51-v1',
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false
  );
end $$;

-- Record evidence (service-role / firm-wide only) of whether the CI
-- path-guard is configured as a REQUIRED status check on the protected
-- branch. Never mutates GitHub branch-protection settings itself — this is
-- read-only evidence recording. Raises a critical alert when required=false.
create or replace function public.record_snapshot_phase51_required_check_verification(
  p_actor_id uuid,
  p_branch_name text,
  p_check_context text,
  p_required boolean,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window text;
  v_hash text;
  v_id uuid;
  v_safe_detail jsonb := coalesce(p_detail,'{}'::jsonb);
begin
  if auth.role() is distinct from 'service_role'
     and not public.phase40_snapshot_actor_authorized(p_actor_id,null) then
    raise exception 'Phase 51 required-check verification recording is service-role/firm-wide only';
  end if;
  if p_branch_name !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$'
     or p_check_context !~ '^[A-Za-z0-9][A-Za-z0-9 ._/:-]{0,199}$' then
    raise exception 'Phase 51 required-check verification requires a valid branch and check context';
  end if;
  if not public.phase51_snapshot_safe_detail(v_safe_detail) then
    raise exception 'Phase 51 required-check verification detail failed safe-metadata checks';
  end if;

  v_window := 'phase51:reqcheck:' || p_branch_name || ':' || p_check_context || ':' ||
    to_char(now() at time zone 'utc','YYYY-MM-DD');
  if exists (
    select 1 from public.os_snapshot_phase51_required_check_verifications v
    where v.window_key=v_window
  ) then
    select verification_id into v_id
    from public.os_snapshot_phase51_required_check_verifications
    where window_key=v_window;
    return jsonb_build_object(
      'verification_id',v_id,
      'already_recorded_today',true,
      'contract_version','phase51-v1'
    );
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'branch_name',p_branch_name,
    'check_context',p_check_context,
    'contract_version','phase51-v1',
    'required',p_required,
    'window_key',v_window
  )::text);

  insert into public.os_snapshot_phase51_required_check_verifications(
    branch_name,check_context,required,window_key,metrics_sha256,detail,actor_id
  ) values (
    p_branch_name,p_check_context,p_required,v_window,v_hash,
    jsonb_build_object(
      'contract_version','phase51-v1',
      'source','record_snapshot_phase51_required_check_verification'
    ) || v_safe_detail,
    p_actor_id
  ) returning verification_id into v_id;

  if not p_required then
    insert into public.os_snapshot_phase51_ops_alerts(
      alert_kind,reference_id,window_key,severity,metrics_sha256,detail,
      qualification_eligible,attestation_eligible,production_relation_mutated
    ) values (
      'required_check_missing',v_id,'phase51:alert:'||v_window,'critical',v_hash,
      jsonb_build_object(
        'contract_version','phase51-v1',
        'branch_name',p_branch_name,
        'check_context',p_check_context,
        'source','record_snapshot_phase51_required_check_verification'
      ),
      false,false,false
    ) on conflict (window_key) do nothing;
  end if;

  return jsonb_build_object(
    'verification_id',v_id,
    'branch_name',p_branch_name,
    'check_context',p_check_context,
    'required',p_required,
    'contract_version','phase51-v1',
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false
  );
end $$;

-- Continue Stage 4e soak observation: roll up the last few Phase 50 soak
-- status snapshots into a trend direction (improving/stable/declining).
-- Read + append-only — never mutates enforcement or production evaluation.
create or replace function public.record_snapshot_phase51_soak_trend(
  p_actor_id uuid default null,
  p_snapshots integer default 4
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshots integer := least(greatest(coalesce(p_snapshots,4),2),14);
  v_latest numeric;
  v_prior numeric;
  v_direction text;
  v_compared integer := 0;
  v_window text;
  v_hash text;
  v_id uuid;
begin
  if p_actor_id is not null
     and not public.phase40_snapshot_actor_authorized(p_actor_id,null)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Phase 51 soak trend recording authorization failed';
  end if;

  select count(*) into v_compared
  from (
    select blocked_rate from public.os_snapshot_phase50_soak_status_snapshots
    order by created_at desc
    limit v_snapshots
  ) s;

  select blocked_rate into v_latest
  from public.os_snapshot_phase50_soak_status_snapshots
  order by created_at desc
  limit 1;

  select blocked_rate into v_prior
  from public.os_snapshot_phase50_soak_status_snapshots
  order by created_at desc
  offset least(v_compared-1,1)
  limit 1;

  if v_latest is null or v_prior is null or v_compared < 2 then
    v_direction := 'unknown';
  elsif v_latest < v_prior - 0.0100 then
    v_direction := 'improving';
  elsif v_latest > v_prior + 0.0100 then
    v_direction := 'declining';
  else
    v_direction := 'stable';
  end if;

  v_window := 'phase51:soaktrend:' || to_char(now() at time zone 'utc','YYYY-MM-DD');
  if exists (
    select 1 from public.os_snapshot_phase51_soak_trend_snapshots t
    where t.window_key=v_window
  ) then
    select trend_id into v_id from public.os_snapshot_phase51_soak_trend_snapshots
      where window_key=v_window;
    return jsonb_build_object(
      'trend_id',v_id,
      'already_recorded_today',true,
      'contract_version','phase51-v1'
    );
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'contract_version','phase51-v1',
    'latest_blocked_rate',v_latest,
    'prior_blocked_rate',v_prior,
    'snapshots_compared',v_compared,
    'trend_direction',v_direction,
    'window_key',v_window
  )::text);

  insert into public.os_snapshot_phase51_soak_trend_snapshots(
    window_key,snapshots_compared,latest_blocked_rate,prior_blocked_rate,
    trend_direction,metrics_sha256,detail
  ) values (
    v_window,v_compared,v_latest,v_prior,v_direction,v_hash,
    jsonb_build_object(
      'contract_version','phase51-v1',
      'stage','4e',
      'source','record_snapshot_phase51_soak_trend'
    )
  ) returning trend_id into v_id;

  if v_direction = 'declining' then
    insert into public.os_snapshot_phase51_ops_alerts(
      alert_kind,reference_id,window_key,severity,metrics_sha256,detail,
      qualification_eligible,attestation_eligible,production_relation_mutated
    ) values (
      'soak_trend_declining',v_id,'phase51:alert:'||v_window,'warning',v_hash,
      jsonb_build_object(
        'contract_version','phase51-v1',
        'source','record_snapshot_phase51_soak_trend'
      ),
      false,false,false
    ) on conflict (window_key) do nothing;
  end if;

  return jsonb_build_object(
    'trend_id',v_id,
    'snapshots_compared',v_compared,
    'latest_blocked_rate',v_latest,
    'prior_blocked_rate',v_prior,
    'trend_direction',v_direction,
    'stage','4e',
    'contract_version','phase51-v1'
  );
end $$;

-- Visibility: recent Phase 51 ops alerts + unescalated page-delivery
-- failures + latest required-check verification state.
create or replace function public.list_snapshot_phase51_critical_windows(
  p_window_hours integer default 24
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'recent_phase51_alerts',
    coalesce((
      select jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc)
      from (
        select b.alert_id, b.alert_kind, b.reference_id, b.severity, b.created_at
        from public.os_snapshot_phase51_ops_alerts b
        where b.created_at>=now()-((least(greatest(coalesce(p_window_hours,24),1),168))||' hours')::interval
        order by b.created_at desc
        limit 100
      ) t
    ),'[]'::jsonb)
  );
$$;

create or replace function public.record_snapshot_phase51_ops_alert(
  p_actor_id uuid,
  p_alert_kind text,
  p_reference_id uuid,
  p_severity text,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window text;
  v_hash text;
  v_id uuid;
  v_safe_detail jsonb := coalesce(p_detail,'{}'::jsonb);
begin
  if auth.role() is distinct from 'service_role'
     and not public.phase40_snapshot_actor_authorized(p_actor_id,null) then
    raise exception 'Phase 51 ops alert recording is service-role/firm-wide only';
  end if;
  if p_alert_kind not in (
      'page_delivery_escalated','required_check_missing','soak_trend_declining')
    or p_severity not in ('warning','critical') then
    raise exception 'Phase 51 ops alert contract is invalid';
  end if;
  if not public.phase51_snapshot_safe_detail(v_safe_detail) then
    raise exception 'Phase 51 ops alert detail failed safe-metadata checks';
  end if;

  v_window := 'phase51:manual:' || p_alert_kind || ':' ||
    coalesce(p_reference_id::text, gen_random_uuid()::text) || ':' ||
    to_char(now() at time zone 'utc','YYYY-MM-DD-HH24-MI-SS');
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'alert_kind',p_alert_kind,
    'contract_version','phase51-v1',
    'reference_id',p_reference_id,
    'severity',p_severity,
    'window_key',v_window
  )::text);

  insert into public.os_snapshot_phase51_ops_alerts(
    alert_kind,reference_id,window_key,severity,metrics_sha256,detail,
    qualification_eligible,attestation_eligible,production_relation_mutated
  ) values (
    p_alert_kind,p_reference_id,v_window,p_severity,v_hash,
    jsonb_build_object(
      'contract_version','phase51-v1',
      'source','record_snapshot_phase51_ops_alert'
    ) || v_safe_detail,
    false,false,false
  ) on conflict (window_key) do nothing
  returning alert_id into v_id;

  return jsonb_build_object(
    'alert_id',v_id,
    'window_key',v_window,
    'contract_version','phase51-v1',
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false
  );
end $$;

create or replace function public.get_snapshot_phase51_ops_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_recent_escalations jsonb:='[]'::jsonb;
  v_recent_verifications jsonb:='[]'::jsonb;
  v_recent_soak_trend jsonb:='[]'::jsonb;
  v_latest_verification public.os_snapshot_phase51_required_check_verifications%rowtype;
begin
  if not public.is_firm_wide_access()
     and auth.role() is distinct from 'service_role' then
    raise exception 'Firm-wide access required for Snapshot Phase 51 ops report';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc),'[]'::jsonb)
    into v_recent_escalations
  from (
    select escalation_id, alert_id, failed_receipt_id, created_at
    from public.os_snapshot_phase51_page_failure_escalations
    order by created_at desc
    limit 20
  ) t;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc),'[]'::jsonb)
    into v_recent_verifications
  from (
    select verification_id, branch_name, check_context, required, created_at
    from public.os_snapshot_phase51_required_check_verifications
    order by created_at desc
    limit 20
  ) t;

  select * into v_latest_verification
  from public.os_snapshot_phase51_required_check_verifications
  order by created_at desc
  limit 1;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc),'[]'::jsonb)
    into v_recent_soak_trend
  from (
    select trend_id, snapshots_compared, latest_blocked_rate, prior_blocked_rate,
      trend_direction, created_at
    from public.os_snapshot_phase51_soak_trend_snapshots
    order by created_at desc
    limit 14
  ) t;

  return jsonb_build_object(
    'page_delivery_escalations_30d',
      (select count(*) from public.os_snapshot_phase51_page_failure_escalations
        where created_at>=now()-interval '30 days'),
    'required_check_currently_configured',
      coalesce(v_latest_verification.required,false),
    'required_check_last_verified_at',v_latest_verification.created_at,
    'recent_page_delivery_escalations',v_recent_escalations,
    'recent_required_check_verifications',v_recent_verifications,
    'recent_soak_trend_snapshots',v_recent_soak_trend,
    'stage','4e',
    'ops_alerts_30d',
      (select count(*) from public.os_snapshot_phase51_ops_alerts
        where created_at>=now()-interval '30 days'),
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false,
    'contract_version','phase51-v1'
  );
end $$;

alter table public.os_snapshot_phase51_page_failure_escalations enable row level security;
alter table public.os_snapshot_phase51_required_check_verifications enable row level security;
alter table public.os_snapshot_phase51_soak_trend_snapshots enable row level security;
alter table public.os_snapshot_phase51_ops_alerts enable row level security;

drop policy if exists "os_snapshot_p51_pagefail_select"
  on public.os_snapshot_phase51_page_failure_escalations;
create policy "os_snapshot_p51_pagefail_select"
  on public.os_snapshot_phase51_page_failure_escalations for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_p51_reqcheck_select"
  on public.os_snapshot_phase51_required_check_verifications;
create policy "os_snapshot_p51_reqcheck_select"
  on public.os_snapshot_phase51_required_check_verifications for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_p51_soaktrend_select"
  on public.os_snapshot_phase51_soak_trend_snapshots;
create policy "os_snapshot_p51_soaktrend_select"
  on public.os_snapshot_phase51_soak_trend_snapshots for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_p51_ops_alert_select"
  on public.os_snapshot_phase51_ops_alerts;
create policy "os_snapshot_p51_ops_alert_select"
  on public.os_snapshot_phase51_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_snapshot_phase51_page_failure_escalations,
  public.os_snapshot_phase51_required_check_verifications,
  public.os_snapshot_phase51_soak_trend_snapshots,
  public.os_snapshot_phase51_ops_alerts
  to authenticated, service_role;
revoke insert,update,delete,truncate on
  public.os_snapshot_phase51_page_failure_escalations,
  public.os_snapshot_phase51_required_check_verifications,
  public.os_snapshot_phase51_soak_trend_snapshots,
  public.os_snapshot_phase51_ops_alerts
  from public,authenticated,service_role;

revoke all on function public.prevent_snapshot_phase51_append_only()
  from public,authenticated,service_role;
revoke all on function public.escalate_snapshot_phase51_page_delivery_failures(uuid)
  from public,authenticated;
revoke all on function public.record_snapshot_phase51_required_check_verification(
  uuid,text,text,boolean,jsonb
) from public,authenticated;
revoke all on function public.record_snapshot_phase51_soak_trend(uuid,integer)
  from public,authenticated;
revoke all on function public.list_snapshot_phase51_critical_windows(integer)
  from public,anon;
revoke all on function public.record_snapshot_phase51_ops_alert(uuid,text,uuid,text,jsonb)
  from public,authenticated;
revoke all on function public.get_snapshot_phase51_ops_report()
  from public,anon;

grant execute on function public.phase51_snapshot_safe_detail(jsonb),
  public.list_snapshot_phase51_critical_windows(integer),
  public.get_snapshot_phase51_ops_report()
  to authenticated, service_role;
grant execute on function public.escalate_snapshot_phase51_page_delivery_failures(uuid)
  to authenticated, service_role;
grant execute on function public.record_snapshot_phase51_required_check_verification(
  uuid,text,text,boolean,jsonb
) to service_role;
grant execute on function public.record_snapshot_phase51_soak_trend(uuid,integer)
  to authenticated, service_role;
grant execute on function public.record_snapshot_phase51_ops_alert(uuid,text,uuid,text,jsonb)
  to authenticated, service_role;
