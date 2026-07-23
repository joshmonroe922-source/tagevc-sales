-- Multi-subsidiary readiness P4: Shared Services operator UX support tables.
-- Views by service line / entity / priority-SLA; assignment + escalation context.
-- Apply after phase_ms_p3. Safe to re-run. Additive only.
-- Never auto-approves money. Never mutates snapshot retirement tables.
-- Builds on Phase 54 unified inbox (does not replace it).

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

create or replace function public.phase_ms_p4_safe_detail(p_detail jsonb)
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

-- Entity-aware assignment preferences / escalation chains (visibility + routing hints).
create table if not exists public.os_ss_entity_assignment_rules (
  rule_id uuid primary key default gen_random_uuid(),
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  service text not null
    check (service in ('Finance','Legal','HR','IT','Marketing')),
  priority text
    check (priority is null or priority in ('P0','P1','P2','P3')),
  default_assignee_name text,
  escalate_to_name text,
  sla_hours integer check (sla_hours is null or sla_hours > 0),
  active boolean not null default true,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_ss_ent_assign_detail_check
    check (
      jsonb_typeof(detail)='object'
      and public.phase_ms_p4_safe_detail(detail)
    ),
  constraint os_ss_ent_assign_no_money_approve_check
    check (coalesce((detail->>'money_auto_approve')::boolean,false)=false),
  unique (entity_id, service, priority)
);

create index if not exists os_ss_ent_assign_entity_idx
  on public.os_ss_entity_assignment_rules(entity_id, service);

alter table public.os_ss_entity_assignment_rules enable row level security;
drop policy if exists "os_ss_ent_assign_select"
  on public.os_ss_entity_assignment_rules;
create policy "os_ss_ent_assign_select"
  on public.os_ss_entity_assignment_rules for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_ss_entity_assignment_rules
  from public, anon, authenticated;
grant select on public.os_ss_entity_assignment_rules to authenticated;

insert into public.os_ss_entity_assignment_rules
  (entity_id, service, priority, default_assignee_name, escalate_to_name, sla_hours, detail)
values
  ('ENT-R619','IT','P0','IT Shared Services','COO — Ops Lead',4,
    jsonb_build_object('money_auto_approve',false,'contract_version','ms-p4-v1')),
  ('ENT-R619','IT','P1','IT Shared Services','Service Lead',8,
    jsonb_build_object('money_auto_approve',false,'contract_version','ms-p4-v1')),
  ('ENT-R619','HR','P1','HR Shared Services','Service Lead',24,
    jsonb_build_object('money_auto_approve',false,'contract_version','ms-p4-v1')),
  ('ENT-INDA','IT','P0','IT Shared Services','COO — Ops Lead',4,
    jsonb_build_object('money_auto_approve',false,'contract_version','ms-p4-v1','legacy_alias','ENT-002')),
  ('ENT-INDA','Legal','P1','Legal Shared Services','Counsel Ops',12,
    jsonb_build_object('money_auto_approve',false,'contract_version','ms-p4-v1')),
  ('ENT-INDA','Marketing','P2','Marketing Shared Services','Service Lead',48,
    jsonb_build_object('money_auto_approve',false,'contract_version','ms-p4-v1')),
  ('ENT-FIRM','Finance','P0','Finance Shared Services','COO — Ops Lead',2,
    jsonb_build_object('money_auto_approve',false,'contract_version','ms-p4-v1'))
on conflict (entity_id, service, priority) do update set
  default_assignee_name = excluded.default_assignee_name,
  escalate_to_name = excluded.escalate_to_name,
  sla_hours = excluded.sla_hours,
  active = true,
  detail = excluded.detail,
  updated_at = now();

-- Operator board snapshot (append-only) — parent vs subsidiary context.
create table if not exists public.os_ss_operator_board_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  by_service jsonb not null default '{}'::jsonb,
  by_entity jsonb not null default '{}'::jsonb,
  by_priority jsonb not null default '{}'::jsonb,
  by_sla jsonb not null default '{}'::jsonb,
  parent_open integer not null default 0 check (parent_open >= 0),
  subsidiary_open integer not null default 0 check (subsidiary_open >= 0),
  feed_status text not null default 'unknown'
    check (feed_status in ('ok','partial','missing','unknown')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_ss_op_board_detail_check
    check (
      jsonb_typeof(detail)='object'
      and public.phase_ms_p4_safe_detail(detail)
    ),
  constraint os_ss_op_board_no_money_approve_check
    check (coalesce((detail->>'money_auto_approve')::boolean,false)=false)
);

create index if not exists os_ss_op_board_created_idx
  on public.os_ss_operator_board_snapshots(created_at desc);

alter table public.os_ss_operator_board_snapshots enable row level security;
drop policy if exists "os_ss_op_board_select"
  on public.os_ss_operator_board_snapshots;
create policy "os_ss_op_board_select"
  on public.os_ss_operator_board_snapshots for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_ss_operator_board_snapshots
  from public, anon, authenticated;
grant select on public.os_ss_operator_board_snapshots to authenticated;

create or replace function public.reject_os_ss_op_board_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'SS operator board snapshots are append-only';
end;
$$;

drop trigger if exists os_ss_op_board_immutable
  on public.os_ss_operator_board_snapshots;
create trigger os_ss_op_board_immutable
  before update or delete on public.os_ss_operator_board_snapshots
  for each row execute function public.reject_os_ss_op_board_mutation();
drop trigger if exists os_ss_op_board_no_truncate
  on public.os_ss_operator_board_snapshots;
create trigger os_ss_op_board_no_truncate
  before truncate on public.os_ss_operator_board_snapshots
  for each statement execute function public.reject_os_ss_op_board_mutation();

create or replace function public.get_ss_operator_board_ms_p4(
  p_entity_id text default null,
  p_service text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := public.resolve_canonical_entity_id(p_entity_id);
  v_has boolean;
  v_by_service jsonb := '{}'::jsonb;
  v_by_entity jsonb := '{}'::jsonb;
  v_by_priority jsonb := '{}'::jsonb;
  v_parent integer := 0;
  v_sub integer := 0;
  v_feed text := 'missing';
  v_rules jsonb := '[]'::jsonb;
begin
  if auth.role() <> 'service_role' and not public.is_firm_wide_access() then
    if v_entity is null or not public.can_access_entity(v_entity) then
      raise exception 'not authorized';
    end if;
  end if;

  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_tickets'
  ) into v_has;

  if v_has then
    v_feed := 'ok';
    select coalesce(jsonb_object_agg(service, cnt), '{}'::jsonb)
    into v_by_service
    from (
      select service, count(*)::int as cnt
      from public.os_tickets
      where status not in ('Closed','Resolved')
        and (v_entity is null or public.entity_ids_equivalent(entity_id, v_entity))
        and (p_service is null or service = p_service)
      group by service
    ) s;

    select coalesce(jsonb_object_agg(coalesce(entity_id,'ENT-FIRM'), cnt), '{}'::jsonb)
    into v_by_entity
    from (
      select
        public.resolve_canonical_entity_id(entity_id) as entity_id,
        count(*)::int as cnt
      from public.os_tickets
      where status not in ('Closed','Resolved')
        and (v_entity is null or public.entity_ids_equivalent(entity_id, v_entity))
        and (p_service is null or service = p_service)
      group by 1
    ) e;

    select coalesce(jsonb_object_agg(priority, cnt), '{}'::jsonb)
    into v_by_priority
    from (
      select priority, count(*)::int as cnt
      from public.os_tickets
      where status not in ('Closed','Resolved')
        and (v_entity is null or public.entity_ids_equivalent(entity_id, v_entity))
        and (p_service is null or service = p_service)
      group by priority
    ) p;

    select
      count(*) filter (
        where public.resolve_canonical_entity_id(entity_id) in ('ENT-FIRM', null)
           or entity_id is null
      )::int,
      count(*) filter (
        where public.resolve_canonical_entity_id(entity_id) not in ('ENT-FIRM')
          and entity_id is not null
      )::int
    into v_parent, v_sub
    from public.os_tickets
    where status not in ('Closed','Resolved')
      and (v_entity is null or public.entity_ids_equivalent(entity_id, v_entity))
      and (p_service is null or service = p_service);
  end if;

  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
  into v_rules
  from public.os_ss_entity_assignment_rules r
  where r.active
    and (v_entity is null or r.entity_id = v_entity)
    and (p_service is null or r.service = p_service);

  return jsonb_build_object(
    'contract_version','ms-p4-v1',
    'money_auto_approve',false,
    'entity_id',v_entity,
    'service_filter',p_service,
    'by_service',v_by_service,
    'by_entity',v_by_entity,
    'by_priority',v_by_priority,
    'parent_open',v_parent,
    'subsidiary_open',v_sub,
    'assignment_rules',v_rules,
    'feed_status',v_feed,
    'context_labels', jsonb_build_object(
      'parent','Tage (parent)',
      'subsidiary_r619','Recruit 619',
      'subsidiary_inda','Instant NDA'
    )
  );
end;
$$;

revoke all on function public.get_ss_operator_board_ms_p4(text, text)
  from public, anon;
grant execute on function public.get_ss_operator_board_ms_p4(text, text)
  to authenticated, service_role;

create or replace function public.refresh_ss_operator_board_ms_p4(
  p_actor_id uuid default null,
  p_entity_id text default null
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

  v_report := public.get_ss_operator_board_ms_p4(p_entity_id, null);
  v_window := 'ms-p4:' || coalesce(public.resolve_canonical_entity_id(p_entity_id),'ALL')
    || ':' || to_char(now() at time zone 'utc', 'YYYYMMDDHH24MI');
  v_hash := public.os_sha256_hex(v_report::text);

  insert into public.os_ss_operator_board_snapshots (
    window_key, by_service, by_entity, by_priority, by_sla,
    parent_open, subsidiary_open, feed_status, metrics_sha256, detail, actor_id
  ) values (
    v_window,
    coalesce(v_report->'by_service','{}'::jsonb),
    coalesce(v_report->'by_entity','{}'::jsonb),
    coalesce(v_report->'by_priority','{}'::jsonb),
    '{}'::jsonb,
    coalesce((v_report->>'parent_open')::int,0),
    coalesce((v_report->>'subsidiary_open')::int,0),
    coalesce(v_report->>'feed_status','unknown'),
    v_hash,
    jsonb_build_object(
      'money_auto_approve',false,
      'contract_version','ms-p4-v1'
    ),
    p_actor_id
  )
  on conflict (window_key) do nothing;

  return v_report || jsonb_build_object('window_key', v_window, 'metrics_sha256', v_hash);
end;
$$;

revoke all on function public.refresh_ss_operator_board_ms_p4(uuid, text)
  from public, anon;
grant execute on function public.refresh_ss_operator_board_ms_p4(uuid, text)
  to authenticated, service_role;
