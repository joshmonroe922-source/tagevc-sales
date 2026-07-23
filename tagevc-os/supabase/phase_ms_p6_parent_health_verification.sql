-- Multi-subsidiary readiness P6: Parent health + verification evidence.
-- Ticket volume/SLA by entity, messaging provision failures, lifecycle success/fail.
-- Apply after phase_ms_p5. Safe to re-run. Additive only.
-- Never auto-approves money. Never mutates snapshot retirement tables.

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

create or replace function public.phase_ms_p6_safe_detail(p_detail jsonb)
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

create table if not exists public.os_multi_sub_health_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  ticket_volume_by_entity jsonb not null default '{}'::jsonb,
  ticket_sla_by_entity jsonb not null default '{}'::jsonb,
  messaging_provision_failures integer not null default 0
    check (messaging_provision_failures >= 0),
  lifecycle_success integer not null default 0 check (lifecycle_success >= 0),
  lifecycle_failure integer not null default 0 check (lifecycle_failure >= 0),
  feed_status text not null default 'unknown'
    check (feed_status in ('ok','partial','missing','unknown')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_ms_health_vol_check
    check (
      jsonb_typeof(ticket_volume_by_entity)='object'
      and public.phase_ms_p6_safe_detail(ticket_volume_by_entity)
    ),
  constraint os_ms_health_sla_check
    check (
      jsonb_typeof(ticket_sla_by_entity)='object'
      and public.phase_ms_p6_safe_detail(ticket_sla_by_entity)
    ),
  constraint os_ms_health_detail_check
    check (
      jsonb_typeof(detail)='object'
      and public.phase_ms_p6_safe_detail(detail)
    ),
  constraint os_ms_health_no_money_approve_check
    check (coalesce((detail->>'money_auto_approve')::boolean,false)=false)
);

create index if not exists os_ms_health_created_idx
  on public.os_multi_sub_health_snapshots(created_at desc);

alter table public.os_multi_sub_health_snapshots enable row level security;
drop policy if exists "os_ms_health_select"
  on public.os_multi_sub_health_snapshots;
create policy "os_ms_health_select"
  on public.os_multi_sub_health_snapshots for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_multi_sub_health_snapshots
  from public, anon, authenticated;
grant select on public.os_multi_sub_health_snapshots to authenticated;

create or replace function public.reject_os_ms_health_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Multi-sub health snapshots are append-only';
end;
$$;

drop trigger if exists os_ms_health_immutable
  on public.os_multi_sub_health_snapshots;
create trigger os_ms_health_immutable
  before update or delete on public.os_multi_sub_health_snapshots
  for each row execute function public.reject_os_ms_health_mutation();
drop trigger if exists os_ms_health_no_truncate
  on public.os_multi_sub_health_snapshots;
create trigger os_ms_health_no_truncate
  before truncate on public.os_multi_sub_health_snapshots
  for each statement execute function public.reject_os_ms_health_mutation();

-- Dual-sub verification checklist evidence (append-only run results).
create table if not exists public.os_multi_sub_verification_runs (
  verification_id uuid primary key default gen_random_uuid(),
  scenario_key text not null
    check (scenario_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  result text not null
    check (result in ('pass','fail','skip','todo')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_ms_verify_detail_check
    check (
      jsonb_typeof(detail)='object'
      and public.phase_ms_p6_safe_detail(detail)
    ),
  constraint os_ms_verify_no_money_approve_check
    check (coalesce((detail->>'money_auto_approve')::boolean,false)=false)
);

create index if not exists os_ms_verify_created_idx
  on public.os_multi_sub_verification_runs(created_at desc);
create index if not exists os_ms_verify_scenario_idx
  on public.os_multi_sub_verification_runs(scenario_key, created_at desc);

alter table public.os_multi_sub_verification_runs enable row level security;
drop policy if exists "os_ms_verify_select"
  on public.os_multi_sub_verification_runs;
create policy "os_ms_verify_select"
  on public.os_multi_sub_verification_runs for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_multi_sub_verification_runs
  from public, anon, authenticated;
grant select on public.os_multi_sub_verification_runs to authenticated;

create or replace function public.reject_os_ms_verify_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Multi-sub verification runs are append-only';
end;
$$;

drop trigger if exists os_ms_verify_immutable
  on public.os_multi_sub_verification_runs;
create trigger os_ms_verify_immutable
  before update or delete on public.os_multi_sub_verification_runs
  for each row execute function public.reject_os_ms_verify_mutation();
drop trigger if exists os_ms_verify_no_truncate
  on public.os_multi_sub_verification_runs;
create trigger os_ms_verify_no_truncate
  before truncate on public.os_multi_sub_verification_runs
  for each statement execute function public.reject_os_ms_verify_mutation();

create or replace function public.get_multi_sub_health_ms_p6()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_has_tickets boolean;
  v_has_life boolean;
  v_has_msg boolean;
  v_volume jsonb := '{}'::jsonb;
  v_sla jsonb := '{}'::jsonb;
  v_msg_fail integer := 0;
  v_life_ok integer := 0;
  v_life_fail integer := 0;
  v_feed text := 'missing';
  v_partial boolean := false;
begin
  if auth.role() <> 'service_role' and not public.is_firm_wide_access() then
    raise exception 'not authorized';
  end if;

  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_tickets'
  ) into v_has_tickets;
  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_identity_lifecycle_runs'
  ) into v_has_life;
  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_messaging_entity_memberships'
  ) into v_has_msg;

  if v_has_tickets then
    v_feed := 'ok';
    select coalesce(jsonb_object_agg(coalesce(ent,'ENT-FIRM'), cnt), '{}'::jsonb)
    into v_volume
    from (
      select
        public.resolve_canonical_entity_id(entity_id) as ent,
        count(*)::int as cnt
      from public.os_tickets
      where status not in ('Closed','Resolved')
      group by 1
    ) t;

    select coalesce(jsonb_object_agg(coalesce(ent,'ENT-FIRM'), sla_obj), '{}'::jsonb)
    into v_sla
    from (
      select
        public.resolve_canonical_entity_id(entity_id) as ent,
        jsonb_build_object(
          'open', count(*)::int,
          'breached', count(*) filter (
            where sla_due_at is not null and sla_due_at < now()
          )::int,
          'p0', count(*) filter (where priority = 'P0')::int
        ) as sla_obj
      from public.os_tickets
      where status not in ('Closed','Resolved')
      group by 1
    ) s;
  else
    v_partial := true;
  end if;

  if v_has_life then
    select
      count(*) filter (where status = 'completed'),
      count(*) filter (where status in ('failed','needs_retry'))
    into v_life_ok, v_life_fail
    from public.os_identity_lifecycle_runs;
  else
    v_partial := true;
    -- TODO: lifecycle feed absent until phase_ms_p5 applied
  end if;

  if v_has_msg then
    -- Provision failures approximated as missing home membership for active profiles
    -- with entity_id set (fail-soft heuristic).
    begin
      select count(*)::int into v_msg_fail
      from public.profiles p
      where p.active = true
        and p.entity_id is not null
        and not exists (
          select 1 from public.os_messaging_entity_memberships m
          where m.user_id = p.id
            and m.deprovisioned_at is null
            and m.is_home
        );
    exception when others then
      v_msg_fail := 0;
      v_partial := true;
    end;
  else
    v_partial := true;
    -- TODO: messaging membership feed absent until phase_ms_p3 applied
  end if;

  if v_partial and v_feed = 'ok' then
    v_feed := 'partial';
  elsif not v_has_tickets then
    v_feed := 'missing';
  end if;

  return jsonb_build_object(
    'contract_version','ms-p6-v1',
    'money_auto_approve',false,
    'ticket_volume_by_entity',v_volume,
    'ticket_sla_by_entity',v_sla,
    'messaging_provision_failures',v_msg_fail,
    'lifecycle_success',v_life_ok,
    'lifecycle_failure',v_life_fail,
    'feed_status',v_feed,
    'entities_tracked', jsonb_build_array('ENT-R619','ENT-INDA','ENT-FIRM'),
    'todo', case
      when v_feed = 'ok' then null
      else 'TODO: apply phase_ms_p1..p5 and refresh health when live feeds partial'
    end
  );
end;
$$;

revoke all on function public.get_multi_sub_health_ms_p6()
  from public, anon;
grant execute on function public.get_multi_sub_health_ms_p6()
  to authenticated, service_role;

create or replace function public.refresh_multi_sub_health_ms_p6(
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_report jsonb;
  v_window text;
  v_hash text;
begin
  if auth.role() <> 'service_role' and not public.is_firm_wide_access() then
    raise exception 'not authorized';
  end if;

  v_report := public.get_multi_sub_health_ms_p6();
  v_window := 'ms-p6:' || to_char(now() at time zone 'utc', 'YYYYMMDDHH24MI');
  v_hash := public.os_sha256_hex(v_report::text);

  insert into public.os_multi_sub_health_snapshots (
    window_key, ticket_volume_by_entity, ticket_sla_by_entity,
    messaging_provision_failures, lifecycle_success, lifecycle_failure,
    feed_status, metrics_sha256, detail, actor_id
  ) values (
    v_window,
    coalesce(v_report->'ticket_volume_by_entity','{}'::jsonb),
    coalesce(v_report->'ticket_sla_by_entity','{}'::jsonb),
    coalesce((v_report->>'messaging_provision_failures')::int,0),
    coalesce((v_report->>'lifecycle_success')::int,0),
    coalesce((v_report->>'lifecycle_failure')::int,0),
    coalesce(v_report->>'feed_status','unknown'),
    v_hash,
    jsonb_build_object('money_auto_approve',false,'contract_version','ms-p6-v1'),
    p_actor_id
  )
  on conflict (window_key) do nothing;

  return v_report || jsonb_build_object('window_key', v_window, 'metrics_sha256', v_hash);
end;
$$;

revoke all on function public.refresh_multi_sub_health_ms_p6(uuid)
  from public, anon;
grant execute on function public.refresh_multi_sub_health_ms_p6(uuid)
  to authenticated, service_role;

create or replace function public.record_multi_sub_verification_ms_p6(
  p_scenario_key text,
  p_result text,
  p_entity_id text default null,
  p_detail jsonb default '{}'::jsonb,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := gen_random_uuid();
  v_result text := lower(trim(p_result));
  v_entity text := public.resolve_canonical_entity_id(p_entity_id);
  v_safe jsonb;
begin
  if auth.role() <> 'service_role' and not public.is_firm_wide_access() then
    raise exception 'not authorized';
  end if;
  if nullif(trim(p_scenario_key),'') is null then
    raise exception 'scenario_key required';
  end if;
  if v_result not in ('pass','fail','skip','todo') then
    raise exception 'invalid result';
  end if;

  v_safe := coalesce(p_detail,'{}'::jsonb)
    || jsonb_build_object('money_auto_approve',false,'contract_version','ms-p6-v1');

  insert into public.os_multi_sub_verification_runs (
    verification_id, scenario_key, entity_id, result, metrics_sha256, detail, actor_id
  ) values (
    v_id,
    trim(p_scenario_key),
    v_entity,
    v_result,
    public.os_sha256_hex(trim(p_scenario_key) || ':' || v_result || ':' || coalesce(v_entity,'')),
    v_safe,
    p_actor_id
  );

  return jsonb_build_object(
    'ok',true,
    'verification_id',v_id,
    'scenario_key',trim(p_scenario_key),
    'result',v_result,
    'money_auto_approve',false,
    'contract_version','ms-p6-v1'
  );
end;
$$;

revoke all on function public.record_multi_sub_verification_ms_p6(
  text, text, text, jsonb, uuid
) from public, anon;
grant execute on function public.record_multi_sub_verification_ms_p6(
  text, text, text, jsonb, uuid
) to authenticated, service_role;
