-- Phase 52: configurable third→fourth approver escalation CHAIN for
-- unanswered approval reminders, plus escalation state/aging visibility.
-- Apply after phase51_docusign_archive_ops.sql. Safe to re-run.
-- Never create/void/resend envelopes. Evidence = digests/metadata only.
-- Never mutates snapshot retirement tables. Escalations are notifications
-- only — this file NEVER calls approve_docusign_budget_revision_proposal_phase49
-- and never auto-activates a budget revision.

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

create or replace function public.phase51_docusign_ops_safe_metadata(p_detail jsonb)
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

create or replace function public.phase52_docusign_ops_safe_metadata(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select public.phase51_docusign_ops_safe_metadata(p_detail);
$$;

-- ---------------------------------------------------------------------------
-- Configurable escalation chain (third → fourth). Singleton-ish config rows
-- keyed by chain_key; latest active row wins. Never activates envelopes.
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_phase52_escalation_chain_config (
  config_id uuid primary key default gen_random_uuid(),
  chain_key text not null unique
    check (chain_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  third_to_fourth_threshold_days integer not null default 3
    check (third_to_fourth_threshold_days between 1 and 30),
  active boolean not null default true,
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_p52_chain_cfg_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase52_docusign_ops_safe_metadata(metadata)
    ),
  constraint os_docusign_archive_p52_chain_cfg_no_activate_check
    check (coalesce((metadata->>'never_activates')::boolean,true) = true)
);

create index if not exists os_docusign_archive_p52_chain_cfg_created_idx
  on public.os_docusign_archive_phase52_escalation_chain_config(created_at desc);

alter table public.os_docusign_archive_phase52_escalation_chain_config
  enable row level security;
drop policy if exists "os_docusign_archive_p52_chain_cfg_select"
  on public.os_docusign_archive_phase52_escalation_chain_config;
create policy "os_docusign_archive_p52_chain_cfg_select"
  on public.os_docusign_archive_phase52_escalation_chain_config for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_phase52_escalation_chain_config
  from public, anon, authenticated;
grant select on public.os_docusign_archive_phase52_escalation_chain_config
  to authenticated;

-- ---------------------------------------------------------------------------
-- Append-only fourth-approver escalation chain events (third→fourth).
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_fourth_approver_escalations (
  escalation_id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null
    references public.os_docusign_archive_budget_revision_proposals(proposal_id),
  source_third_escalation_id uuid
    references public.os_docusign_archive_third_approver_escalations(escalation_id),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  chain_step text not null default 'fourth'
    check (chain_step in ('fourth')),
  days_since_third_escalation integer not null check (days_since_third_escalation >= 0),
  threshold_days integer not null check (threshold_days between 1 and 30),
  destination_key text not null
    check (destination_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  delivery_status text not null
    check (delivery_status in
      ('delivered','skipped_no_webhook','failed','recorded')),
  response_code integer
    check (response_code is null or response_code between 100 and 599),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_p52_escalation_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase52_docusign_ops_safe_metadata(metadata)
    ),
  constraint os_docusign_archive_p52_escalation_no_activate_check
    check (coalesce((metadata->>'never_activates')::boolean,true) = true)
);

create index if not exists os_docusign_archive_p52_escalation_created_idx
  on public.os_docusign_archive_fourth_approver_escalations(created_at desc);
create index if not exists os_docusign_archive_p52_escalation_proposal_idx
  on public.os_docusign_archive_fourth_approver_escalations(proposal_id, created_at desc);

alter table public.os_docusign_archive_fourth_approver_escalations
  enable row level security;
drop policy if exists "os_docusign_archive_p52_escalation_select"
  on public.os_docusign_archive_fourth_approver_escalations;
create policy "os_docusign_archive_p52_escalation_select"
  on public.os_docusign_archive_fourth_approver_escalations for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_fourth_approver_escalations
  from public, anon, authenticated;
grant select on public.os_docusign_archive_fourth_approver_escalations
  to authenticated;

create table if not exists public.os_docusign_archive_phase52_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  alert_kind text not null,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null default 'warning'
    check (severity in ('warning','critical')),
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
  constraint os_docusign_archive_p52_alert_kind_check
    check (alert_kind in (
      'fourth_approver_escalation_raised',
      'escalation_chain_aging_critical'
    )),
  constraint os_docusign_archive_p52_alert_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase52_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_p52_alert_created_idx
  on public.os_docusign_archive_phase52_ops_alerts(created_at desc);

alter table public.os_docusign_archive_phase52_ops_alerts
  enable row level security;
drop policy if exists "os_docusign_archive_p52_alert_select"
  on public.os_docusign_archive_phase52_ops_alerts;
create policy "os_docusign_archive_p52_alert_select"
  on public.os_docusign_archive_phase52_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_phase52_ops_alerts
  from public, anon, authenticated;
grant select on public.os_docusign_archive_phase52_ops_alerts
  to authenticated;

create or replace function public.reject_docusign_phase52_ops_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Phase 52 DocuSign archive ops evidence is append-only';
end;
$$;

drop trigger if exists os_docusign_archive_p52_chain_cfg_immutable
  on public.os_docusign_archive_phase52_escalation_chain_config;
create trigger os_docusign_archive_p52_chain_cfg_immutable
  before update or delete on public.os_docusign_archive_phase52_escalation_chain_config
  for each row execute function public.reject_docusign_phase52_ops_mutation();
drop trigger if exists os_docusign_archive_p52_chain_cfg_no_truncate
  on public.os_docusign_archive_phase52_escalation_chain_config;
create trigger os_docusign_archive_p52_chain_cfg_no_truncate
  before truncate on public.os_docusign_archive_phase52_escalation_chain_config
  for each statement execute function public.reject_docusign_phase52_ops_mutation();

drop trigger if exists os_docusign_archive_p52_escalation_immutable
  on public.os_docusign_archive_fourth_approver_escalations;
create trigger os_docusign_archive_p52_escalation_immutable
  before update or delete on public.os_docusign_archive_fourth_approver_escalations
  for each row execute function public.reject_docusign_phase52_ops_mutation();
drop trigger if exists os_docusign_archive_p52_escalation_no_truncate
  on public.os_docusign_archive_fourth_approver_escalations;
create trigger os_docusign_archive_p52_escalation_no_truncate
  before truncate on public.os_docusign_archive_fourth_approver_escalations
  for each statement execute function public.reject_docusign_phase52_ops_mutation();

drop trigger if exists os_docusign_archive_p52_alert_immutable
  on public.os_docusign_archive_phase52_ops_alerts;
create trigger os_docusign_archive_p52_alert_immutable
  before update or delete on public.os_docusign_archive_phase52_ops_alerts
  for each row execute function public.reject_docusign_phase52_ops_mutation();
drop trigger if exists os_docusign_archive_p52_alert_no_truncate
  on public.os_docusign_archive_phase52_ops_alerts;
create trigger os_docusign_archive_p52_alert_no_truncate
  before truncate on public.os_docusign_archive_phase52_ops_alerts
  for each statement execute function public.reject_docusign_phase52_ops_mutation();

-- Ensure a default chain config exists (idempotent).
create or replace function public.ensure_docusign_escalation_chain_config_phase52(
  p_threshold_days integer default 3,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_threshold integer := least(greatest(coalesce(p_threshold_days, 3), 1), 30);
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_key text := 'escalationchain52:default';
  v_hash text;
  v_row public.os_docusign_archive_phase52_escalation_chain_config%rowtype;
begin
  if not public.phase52_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 52 escalation chain config metadata is invalid or unsafe';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase52-v1',
    'third_to_fourth_threshold_days',v_threshold,
    'chain_key',v_key
  )::text);

  insert into public.os_docusign_archive_phase52_escalation_chain_config(
    chain_key,third_to_fourth_threshold_days,active,metrics_sha256,metadata)
  values (
    v_key,v_threshold,true,v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase52-v1','never_activates',true))
  on conflict (chain_key) do nothing
  returning * into v_row;

  if v_row.config_id is null then
    select * into v_row
    from public.os_docusign_archive_phase52_escalation_chain_config
    where chain_key = v_key;
  end if;

  return jsonb_build_object(
    'version','phase52-v1',
    'config_id',v_row.config_id,
    'chain_key',v_row.chain_key,
    'third_to_fourth_threshold_days',v_row.third_to_fourth_threshold_days,
    'active',v_row.active,
    'never_activates',true
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Escalate third→fourth when a Phase 51 third-approver escalation remains
-- unanswered past the configured threshold and the proposal is still stuck
-- at exactly 1 distinct approver. Never activates or approves.
-- ---------------------------------------------------------------------------
create or replace function public.escalate_docusign_approval_chain_phase52(
  p_threshold_days integer default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_cfg public.os_docusign_archive_phase52_escalation_chain_config%rowtype;
  v_threshold integer;
  v_proposal record;
  v_key text;
  v_hash text;
  v_id uuid;
  v_raised integer := 0;
  v_days integer;
begin
  if not public.phase52_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 52 approval-chain escalation metadata is invalid or unsafe';
  end if;

  perform public.ensure_docusign_escalation_chain_config_phase52(
    coalesce(p_threshold_days, 3), v_meta);

  select * into v_cfg
  from public.os_docusign_archive_phase52_escalation_chain_config
  where active
  order by created_at desc
  limit 1;

  v_threshold := least(greatest(
    coalesce(p_threshold_days, v_cfg.third_to_fourth_threshold_days, 3), 1), 30);

  for v_proposal in
    select p.proposal_id, p.budget_key, t.escalation_id as third_escalation_id,
      t.created_at as third_escalated_at,
      count(distinct a.actor_id) filter (where a.decision='approve') as distinct_approvers
    from public.os_docusign_archive_budget_revision_proposals p
    join public.os_docusign_archive_third_approver_escalations t
      on t.proposal_id = p.proposal_id
    left join public.os_docusign_archive_budget_revision_approvals a
      on a.proposal_id = p.proposal_id
    where p.status = 'proposed'
      and not exists (
        select 1 from public.os_docusign_archive_budget_revision_proposals x
        where x.source_proposal_id = p.proposal_id
      )
      and not exists (
        select 1 from public.os_docusign_archive_fourth_approver_escalations f
        where f.proposal_id = p.proposal_id
      )
    group by p.proposal_id, p.budget_key, t.escalation_id, t.created_at
    having count(distinct a.actor_id) filter (where a.decision='approve') = 1
      and t.created_at <= now() - make_interval(days => v_threshold)
    order by t.created_at asc
    limit 25
  loop
    v_days := floor(extract(epoch from (now()-v_proposal.third_escalated_at))/86400)::integer;
    v_key := left(
      'fourthapprescalation52:' || v_proposal.proposal_id::text || ':' ||
        to_char(now(),'YYYYMMDD'),
      200);
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase52-v1',
      'proposal_id',v_proposal.proposal_id,
      'third_escalation_id',v_proposal.third_escalation_id,
      'days_since_third_escalation',v_days,
      'threshold_days',v_threshold
    )::text);

    insert into public.os_docusign_archive_fourth_approver_escalations(
      proposal_id,source_third_escalation_id,window_key,chain_step,
      days_since_third_escalation,threshold_days,destination_key,
      delivery_status,metrics_sha256,metadata)
    values (
      v_proposal.proposal_id,v_proposal.third_escalation_id,v_key,'fourth',
      v_days,v_threshold,'ops_alerts','recorded',v_hash,
      v_meta || jsonb_build_object(
        'contract_version','phase52-v1',
        'budget_key',v_proposal.budget_key,
        'never_activates',true))
    on conflict (window_key) do nothing
    returning escalation_id into v_id;

    if v_id is not null then
      v_raised := v_raised + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'version','phase52-v1',
    'escalations_raised',v_raised,
    'threshold_days',v_threshold,
    'never_activates',true,
    'never_creates_voids_or_resends_envelopes',true
  );
end;
$$;

create or replace function public.list_docusign_archive_phase52_critical_windows(
  p_window_hours integer default 24,
  p_aging_threshold_days integer default 7
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_hours integer := least(greatest(coalesce(p_window_hours, 24), 1), 168);
  v_aging_days integer := least(greatest(coalesce(p_aging_threshold_days, 7), 1), 60);
  v_bucket text;
  v_pending jsonb := '[]'::jsonb;
  v_esc public.os_docusign_archive_fourth_approver_escalations%rowtype;
  v_key text;
  v_aged record;
begin
  v_bucket := to_char(
    to_timestamp(
      (floor(extract(epoch from now()) / (v_hours * 3600.0))
        * (v_hours * 3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  for v_esc in
    select * from public.os_docusign_archive_fourth_approver_escalations
    where created_at >= now() - make_interval(hours => v_hours)
    order by created_at desc
    limit 25
  loop
    v_key := 'fourthapprescalationalert52:' || v_esc.escalation_id::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase52_ops_alerts a
      where a.window_key = v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','fourth_approver_escalation_raised',
        'window_key',v_key,
        'severity','critical',
        'proposal_id',v_esc.proposal_id,
        'escalation_id',v_esc.escalation_id,
        'days_since_third_escalation',v_esc.days_since_third_escalation,
        'metrics_sha256',v_esc.metrics_sha256
      ));
    end if;
  end loop;

  for v_aged in
    select f.escalation_id, f.proposal_id, f.created_at,
      floor(extract(epoch from (now()-f.created_at))/86400)::integer as age_days
    from public.os_docusign_archive_fourth_approver_escalations f
    join public.os_docusign_archive_budget_revision_proposals p
      on p.proposal_id = f.proposal_id
    where p.status = 'proposed'
      and f.created_at <= now() - make_interval(days => v_aging_days)
    order by f.created_at asc
    limit 25
  loop
    v_key := 'escalationaging52:' || v_aged.escalation_id::text || ':' || v_bucket;
    if not exists (
      select 1 from public.os_docusign_archive_phase52_ops_alerts a
      where a.window_key = v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','escalation_chain_aging_critical',
        'window_key',v_key,
        'severity','warning',
        'proposal_id',v_aged.proposal_id,
        'escalation_id',v_aged.escalation_id,
        'age_days',v_aged.age_days
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'version','phase52-v1',
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'aging_threshold_days',v_aging_days,
    'pending',v_pending
  );
end;
$$;

create or replace function public.record_docusign_archive_phase52_ops_alert(
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
  v_severity text;
  v_hash text;
  v_meta jsonb;
  v_id uuid;
  v_status text;
begin
  if jsonb_typeof(coalesce(p_alert,'{}'::jsonb)) <> 'object' then
    raise exception 'Phase 52 ops alert payload must be a JSON object';
  end if;

  v_kind := coalesce(p_alert->>'alert_kind','');
  v_window := coalesce(p_alert->>'window_key','');
  v_dest := coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery := coalesce(p_alert->>'delivery_status','recorded');
  v_code := nullif(p_alert->>'response_code','')::integer;
  v_severity := coalesce(nullif(p_alert->>'severity',''),'warning');
  v_meta := coalesce(p_alert->'metadata','{}'::jsonb);

  if v_kind not in ('fourth_approver_escalation_raised','escalation_chain_aging_critical')
     or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
     or v_dest ~* '://|^https?'
     or v_severity not in ('warning','critical')
     or v_delivery not in
       ('delivered','skipped_no_webhook','failed','recorded')
     or not public.phase52_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 52 ops alert contract is invalid or unsafe';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase52-v1',
    'alert_kind',v_kind,
    'window_key',v_window,
    'severity',v_severity,
    'destination_key',v_dest,
    'delivery_status',v_delivery,
    'response_code',v_code
  )::text);

  insert into public.os_docusign_archive_phase52_ops_alerts(
    alert_kind,window_key,severity,destination_key,
    delivery_status,response_code,metrics_sha256,metadata)
  values (
    v_kind,v_window,v_severity,v_dest,
    v_delivery,v_code,v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase52-v1','never_activates',true))
  on conflict (window_key) do nothing
  returning alert_id, delivery_status into v_id, v_status;

  if v_id is null then
    select alert_id, delivery_status into v_id, v_status
    from public.os_docusign_archive_phase52_ops_alerts
    where window_key = v_window;
    return jsonb_build_object(
      'version','phase52-v1',
      'alert_id',v_id,
      'window_key',v_window,
      'delivery_status',v_status,
      'inserted',false);
  end if;

  return jsonb_build_object(
    'version','phase52-v1',
    'alert_id',v_id,
    'window_key',v_window,
    'delivery_status',v_status,
    'inserted',true);
end;
$$;

create or replace function public.get_docusign_archive_phase52_ops_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cfg public.os_docusign_archive_phase52_escalation_chain_config%rowtype;
  v_fourth_7d integer := 0;
  v_pending_fourth integer := 0;
  v_escalations jsonb;
  v_alerts jsonb;
  v_avg_age numeric;
begin
  select * into v_cfg
  from public.os_docusign_archive_phase52_escalation_chain_config
  where active
  order by created_at desc
  limit 1;

  select count(*)::integer into v_fourth_7d
  from public.os_docusign_archive_fourth_approver_escalations
  where created_at >= now() - interval '7 days';

  select count(distinct f.proposal_id)::integer,
    avg(extract(epoch from (now()-f.created_at))/86400.0)
  into v_pending_fourth, v_avg_age
  from public.os_docusign_archive_fourth_approver_escalations f
  join public.os_docusign_archive_budget_revision_proposals p
    on p.proposal_id = f.proposal_id
  where p.status = 'proposed';

  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb)
  into v_escalations
  from (
    select escalation_id, proposal_id, source_third_escalation_id, chain_step,
      days_since_third_escalation, threshold_days, delivery_status,
      metrics_sha256, created_at
    from public.os_docusign_archive_fourth_approver_escalations
    order by created_at desc
    limit 25
  ) e;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
  into v_alerts
  from (
    select alert_id, alert_kind, window_key, severity, destination_key,
      delivery_status, response_code, metrics_sha256, created_at
    from public.os_docusign_archive_phase52_ops_alerts
    order by created_at desc
    limit 20
  ) a;

  return jsonb_build_object(
    'version','phase52-v1',
    'chain_threshold_days',coalesce(v_cfg.third_to_fourth_threshold_days,3),
    'chain_active',coalesce(v_cfg.active,false),
    'fourth_approver_escalations_7d',v_fourth_7d,
    'pending_fourth_approver_count',coalesce(v_pending_fourth,0),
    'avg_fourth_escalation_age_days',v_avg_age,
    'recent_fourth_escalations',coalesce(v_escalations,'[]'::jsonb),
    'alerts',coalesce(v_alerts,'[]'::jsonb),
    'destination_key','ops_alerts',
    'never_creates_voids_or_resends_envelopes',true,
    'never_auto_activates',true
  );
end;
$$;

revoke all on function public.phase52_docusign_ops_safe_metadata(jsonb)
  from public, anon, authenticated;
revoke all on function public.ensure_docusign_escalation_chain_config_phase52(integer,jsonb)
  from public, anon, authenticated;
revoke all on function public.escalate_docusign_approval_chain_phase52(integer,jsonb)
  from public, anon, authenticated;
revoke all on function public.list_docusign_archive_phase52_critical_windows(integer,integer)
  from public, anon;
revoke all on function public.record_docusign_archive_phase52_ops_alert(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_docusign_archive_phase52_ops_report()
  from public, anon;

grant execute on function public.phase52_docusign_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.list_docusign_archive_phase52_critical_windows(integer,integer)
  to authenticated, service_role;
grant execute on function public.get_docusign_archive_phase52_ops_report()
  to authenticated, service_role;

grant execute on function public.ensure_docusign_escalation_chain_config_phase52(integer,jsonb)
  to service_role;
grant execute on function public.escalate_docusign_approval_chain_phase52(integer,jsonb)
  to service_role;
grant execute on function public.record_docusign_archive_phase52_ops_alert(jsonb)
  to service_role;
grant execute on function public.os_sha256_hex(text)
  to authenticated, service_role;
