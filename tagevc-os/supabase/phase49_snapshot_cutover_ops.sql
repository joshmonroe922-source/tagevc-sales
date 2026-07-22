-- Phase 49: require CI offline_script dual acceptance on every cutover for
-- protected branches, with enforcement visibility. Stage 4e soak continues.
-- Apply after phase48_snapshot_cutover_ops.sql.
-- Public-key metadata / branch names only — never store private keys.
-- qualification_eligible / attestation_eligible / production_relation_mutated
-- remain false always. This file NEVER references the retired snapshot
-- store table — protected-branch enforcement is scoped to ed25519 key
-- cutover rotations only.

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

create or replace function public.phase49_snapshot_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body|private_key)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

-- ---------------------------------------------------------------------------
-- Protected-branch policies (append-only, grow-only allowlist of branches
-- that always require CI offline_script dual acceptance before cutover).
-- ---------------------------------------------------------------------------
create table if not exists public.os_snapshot_phase49_protected_branch_policies (
  policy_id uuid primary key default gen_random_uuid(),
  branch_pattern text not null unique,
  ci_required boolean not null default true,
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint os_snapshot_p49_branch_policy_pattern_check
    check (branch_pattern ~ '^[a-z0-9][a-z0-9._/-]{0,119}$'),
  constraint os_snapshot_p49_branch_policy_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

insert into public.os_snapshot_phase49_protected_branch_policies(
  branch_pattern,ci_required,detail
) values
  ('main',true,jsonb_build_object('contract_version','phase49-v1','seeded',true)),
  ('production',true,jsonb_build_object('contract_version','phase49-v1','seeded',true))
on conflict (branch_pattern) do nothing;

create or replace function public.prevent_snapshot_phase49_immutable_change()
returns trigger language plpgsql as $$
begin raise exception '% is append-only',tg_table_name; end $$;

drop trigger if exists os_snapshot_p49_branch_policy_immutable
  on public.os_snapshot_phase49_protected_branch_policies;
create trigger os_snapshot_p49_branch_policy_immutable
  before update or delete or truncate
  on public.os_snapshot_phase49_protected_branch_policies for each statement
  execute function public.prevent_snapshot_phase49_immutable_change();

-- Case-insensitive protected-branch check. Fails closed: if no policy rows
-- exist (e.g. table wiped), 'main' and 'production' are still protected.
create or replace function public.snapshot_branch_is_protected_phase49(
  p_branch text
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select bool_or(p.ci_required)
      from public.os_snapshot_phase49_protected_branch_policies p
      where lower(p.branch_pattern)=lower(coalesce(p_branch,''))
    ),
    lower(coalesce(p_branch,'')) in ('main','production')
  );
$$;

-- ---------------------------------------------------------------------------
-- Cutover enforcement events (append-only) — every completion attempt is
-- recorded with its branch context and allow/block decision.
-- ---------------------------------------------------------------------------
create table if not exists public.os_snapshot_phase49_cutover_enforcement_events (
  event_id uuid primary key default gen_random_uuid(),
  rotation_id uuid not null
    references public.os_snapshot_ed25519_key_rotations(rotation_id),
  branch text not null,
  protected_branch boolean not null,
  ci_required boolean not null,
  ci_dual_acceptance_ready boolean not null,
  decision text not null,
  window_key text not null unique,
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id),
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint os_snapshot_p49_enforce_branch_check
    check (branch ~ '^[a-z0-9][a-z0-9._/-]{0,119}$'),
  constraint os_snapshot_p49_enforce_decision_check
    check (decision in ('allowed','blocked')),
  constraint os_snapshot_p49_enforce_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_snapshot_p49_enforce_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_p49_enforce_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_p49_enforce_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);

create index if not exists os_snapshot_p49_enforce_rotation_idx
  on public.os_snapshot_phase49_cutover_enforcement_events(rotation_id,created_at desc);
create index if not exists os_snapshot_p49_enforce_decision_idx
  on public.os_snapshot_phase49_cutover_enforcement_events(decision,created_at desc);

drop trigger if exists os_snapshot_p49_enforce_immutable
  on public.os_snapshot_phase49_cutover_enforcement_events;
create trigger os_snapshot_p49_enforce_immutable
  before update or delete or truncate
  on public.os_snapshot_phase49_cutover_enforcement_events for each statement
  execute function public.prevent_snapshot_phase49_immutable_change();

create table if not exists public.os_snapshot_phase49_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  alert_kind text not null,
  rotation_id uuid,
  window_key text not null unique,
  severity text not null default 'warning',
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint os_snapshot_p49_alert_kind_check
    check (alert_kind in ('protected_branch_cutover_blocked')),
  constraint os_snapshot_p49_alert_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_snapshot_p49_alert_severity_check
    check (severity in ('warning','critical')),
  constraint os_snapshot_p49_alert_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_p49_alert_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_p49_alert_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);

drop trigger if exists os_snapshot_p49_ops_alert_immutable
  on public.os_snapshot_phase49_ops_alerts;
create trigger os_snapshot_p49_ops_alert_immutable
  before update or delete or truncate
  on public.os_snapshot_phase49_ops_alerts for each statement
  execute function public.prevent_snapshot_phase49_immutable_change();

-- Enforcement gate: for protected branches, CI offline_script dual
-- acceptance (Phase 48 evidence) is mandatory before cutover completes.
-- Non-protected branches keep the Phase 47 dual-acceptance path (still
-- requires 2 distinct verifier kinds, just not CI-specific).
create or replace function public.complete_snapshot_ed25519_cutover_phase49(
  p_actor_id uuid,
  p_rotation_id uuid,
  p_branch text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text:=lower(trim(coalesce(p_branch,'')));
  v_protected boolean;
  v_ci_required boolean;
  v_ci_ready boolean;
  v_decision text;
  v_window text;
  v_hash text;
  v_complete jsonb;
  v_rot public.os_snapshot_ed25519_key_rotations%rowtype;
begin
  if not public.phase40_snapshot_actor_authorized(p_actor_id,null) then
    raise exception 'Phase 49 ed25519 cutover authorization failed';
  end if;
  if v_branch !~ '^[a-z0-9][a-z0-9._/-]{0,119}$' then
    raise exception 'Invalid branch name for Phase 49 cutover enforcement';
  end if;

  select * into v_rot from public.os_snapshot_ed25519_key_rotations
    where rotation_id=p_rotation_id;
  if not found then
    raise exception 'Ed25519 rotation was not found';
  end if;

  v_protected:=public.snapshot_branch_is_protected_phase49(v_branch);
  v_ci_required:=v_protected;
  v_ci_ready:=public.snapshot_cutover_ci_offline_script_dual_acceptance_phase48(
    p_rotation_id
  );
  v_decision:=case
    when v_ci_required and not v_ci_ready then 'blocked'
    else 'allowed'
  end;

  v_window:='phase49:cutover_enforce:'||p_rotation_id::text||':'||v_decision||':'||
    to_char(now() at time zone 'utc','YYYY-MM-DD');
  if not exists (
    select 1 from public.os_snapshot_phase49_cutover_enforcement_events e
    where e.window_key=v_window
  ) then
    v_hash:=public.os_sha256_hex(jsonb_build_object(
      'branch',v_branch,
      'ci_dual_acceptance_ready',v_ci_ready,
      'ci_required',v_ci_required,
      'contract_version','phase49-v1',
      'decision',v_decision,
      'protected_branch',v_protected,
      'rotation_id',p_rotation_id,
      'window_key',v_window
    )::text);
    insert into public.os_snapshot_phase49_cutover_enforcement_events(
      rotation_id,branch,protected_branch,ci_required,ci_dual_acceptance_ready,
      decision,window_key,metrics_sha256,detail,actor_id,
      qualification_eligible,attestation_eligible,production_relation_mutated
    ) values (
      p_rotation_id,v_branch,v_protected,v_ci_required,v_ci_ready,
      v_decision,v_window,v_hash,
      jsonb_build_object(
        'contract_version','phase49-v1',
        'source','complete_snapshot_ed25519_cutover_phase49'
      ),
      p_actor_id,false,false,false
    );

    if v_decision='blocked' then
      insert into public.os_snapshot_phase49_ops_alerts(
        alert_kind,rotation_id,window_key,severity,metrics_sha256,detail,
        qualification_eligible,attestation_eligible,production_relation_mutated
      ) values (
        'protected_branch_cutover_blocked',p_rotation_id,
        'phase49:alert:'||v_window,'critical',v_hash,
        jsonb_build_object(
          'contract_version','phase49-v1',
          'branch',v_branch,
          'source','complete_snapshot_ed25519_cutover_phase49'
        ),
        false,false,false
      ) on conflict (window_key) do nothing;
    end if;
  end if;

  if v_decision='blocked' then
    raise exception
      'CI offline_script dual acceptance is required before cutover on protected branch %',
      v_branch;
  end if;

  if v_protected then
    v_complete:=public.complete_snapshot_ed25519_cutover_phase48(
      p_actor_id, p_rotation_id
    );
  else
    v_complete:=public.complete_snapshot_ed25519_cutover_phase47(
      p_actor_id, p_rotation_id
    );
  end if;

  return coalesce(v_complete,'{}'::jsonb)||jsonb_build_object(
    'branch',v_branch,
    'protected_branch',v_protected,
    'ci_required',v_ci_required,
    'ci_dual_acceptance_ready',v_ci_ready,
    'enforcement_decision',v_decision,
    'contract_version','phase49-v1',
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false
  );
end $$;

-- Visibility windows for blocked protected-branch cutover attempts.
create or replace function public.list_snapshot_phase49_critical_windows(
  p_window_hours integer default 24
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'pending',coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc),'[]'::jsonb)
  )
  from (
    select
      e.event_id,
      e.rotation_id,
      e.branch,
      e.decision,
      e.window_key,
      e.created_at
    from public.os_snapshot_phase49_cutover_enforcement_events e
    where e.decision='blocked'
      and e.created_at>=now()-((least(greatest(coalesce(p_window_hours,24),1),168))||' hours')::interval
    order by e.created_at desc
    limit 100
  ) t;
$$;

create or replace function public.get_snapshot_phase49_ops_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_recent jsonb:='[]'::jsonb;
begin
  if not public.is_firm_wide_access()
     and auth.role() is distinct from 'service_role' then
    raise exception 'Firm-wide access required for Snapshot Phase 49 ops report';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc),'[]'::jsonb)
    into v_recent
  from (
    select
      e.event_id,
      e.rotation_id,
      e.branch,
      e.protected_branch,
      e.ci_required,
      e.ci_dual_acceptance_ready,
      e.decision,
      e.created_at
    from public.os_snapshot_phase49_cutover_enforcement_events e
    where e.created_at>=now()-interval '365 days'
    order by e.created_at desc
    limit 40
  ) t;

  return jsonb_build_object(
    'protected_branch_policies_count',
      (select count(*) from public.os_snapshot_phase49_protected_branch_policies
        where ci_required),
    'cutover_enforcement_events_365d',
      (select count(*) from public.os_snapshot_phase49_cutover_enforcement_events
        where created_at>=now()-interval '365 days'),
    'cutover_enforcement_allowed_365d',
      (select count(*) from public.os_snapshot_phase49_cutover_enforcement_events
        where created_at>=now()-interval '365 days' and decision='allowed'),
    'cutover_enforcement_blocked_365d',
      (select count(*) from public.os_snapshot_phase49_cutover_enforcement_events
        where created_at>=now()-interval '365 days' and decision='blocked'),
    'ops_alerts_30d',
      (select count(*) from public.os_snapshot_phase49_ops_alerts
        where created_at>=now()-interval '30 days'),
    'recent_enforcement_events',v_recent,
    'ci_dual_acceptance_required_for_protected_branches',true,
    'offline_script_required',true,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false,
    'contract_version','phase49-v1'
  );
end $$;

alter table public.os_snapshot_phase49_protected_branch_policies enable row level security;
alter table public.os_snapshot_phase49_cutover_enforcement_events enable row level security;
alter table public.os_snapshot_phase49_ops_alerts enable row level security;

drop policy if exists "os_snapshot_p49_branch_policy_select"
  on public.os_snapshot_phase49_protected_branch_policies;
create policy "os_snapshot_p49_branch_policy_select"
  on public.os_snapshot_phase49_protected_branch_policies for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_p49_enforce_select"
  on public.os_snapshot_phase49_cutover_enforcement_events;
create policy "os_snapshot_p49_enforce_select"
  on public.os_snapshot_phase49_cutover_enforcement_events for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_p49_ops_alert_select"
  on public.os_snapshot_phase49_ops_alerts;
create policy "os_snapshot_p49_ops_alert_select"
  on public.os_snapshot_phase49_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_snapshot_phase49_protected_branch_policies,
  public.os_snapshot_phase49_cutover_enforcement_events,
  public.os_snapshot_phase49_ops_alerts
  to authenticated, service_role;
revoke insert,update,delete,truncate on
  public.os_snapshot_phase49_protected_branch_policies,
  public.os_snapshot_phase49_cutover_enforcement_events,
  public.os_snapshot_phase49_ops_alerts
  from public,authenticated,service_role;

revoke all on function public.prevent_snapshot_phase49_immutable_change()
  from public,authenticated,service_role;
revoke all on function public.complete_snapshot_ed25519_cutover_phase49(uuid,uuid,text)
  from public,authenticated;
revoke all on function public.snapshot_branch_is_protected_phase49(text)
  from public,anon;
revoke all on function public.list_snapshot_phase49_critical_windows(integer)
  from public,anon;
revoke all on function public.get_snapshot_phase49_ops_report()
  from public,anon;

grant execute on function public.phase49_snapshot_safe_detail(jsonb),
  public.snapshot_branch_is_protected_phase49(text),
  public.list_snapshot_phase49_critical_windows(integer),
  public.get_snapshot_phase49_ops_report(),
  public.os_sha256_hex(text)
  to authenticated, service_role;
grant execute on function public.complete_snapshot_ed25519_cutover_phase49(uuid,uuid,text)
  to service_role;
