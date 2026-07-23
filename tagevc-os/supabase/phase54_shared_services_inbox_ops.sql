-- Phase 54: Shared Services Inbox Unification (service leads first).
-- Append-only SLA / escalation evidence + inbox board snapshots.
-- Apply after Phase 53. Safe to re-run.
-- Fail-soft when ticket tables are missing or partial.
-- Never auto-approves money. Never mutates snapshot retirement tables.
-- Dual-approve gates remain untouched.

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

create or replace function public.phase54_ss_inbox_safe_detail(p_detail jsonb)
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

-- ---------------------------------------------------------------------------
-- Append-only Shared Services inbox board snapshots (entity-scoped optional).
-- ---------------------------------------------------------------------------
create table if not exists public.os_ss_inbox_phase54_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  open_total integer not null default 0 check (open_total >= 0),
  by_service jsonb not null default '{}'::jsonb,
  by_sla_status jsonb not null default '{}'::jsonb,
  by_entity jsonb not null default '{}'::jsonb,
  escalated_count integer not null default 0 check (escalated_count >= 0),
  breached_count integer not null default 0 check (breached_count >= 0),
  due_soon_count integer not null default 0 check (due_soon_count >= 0),
  unassigned_count integer not null default 0 check (unassigned_count >= 0),
  feed_status text not null default 'unknown'
    check (feed_status in ('ok','partial','missing','unknown')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_ss_inbox_p54_by_service_check
    check (
      jsonb_typeof(by_service)='object'
      and pg_column_size(by_service)<=4096
      and public.phase54_ss_inbox_safe_detail(by_service)
    ),
  constraint os_ss_inbox_p54_by_sla_check
    check (
      jsonb_typeof(by_sla_status)='object'
      and pg_column_size(by_sla_status)<=4096
      and public.phase54_ss_inbox_safe_detail(by_sla_status)
    ),
  constraint os_ss_inbox_p54_by_entity_check
    check (
      jsonb_typeof(by_entity)='object'
      and pg_column_size(by_entity)<=4096
      and public.phase54_ss_inbox_safe_detail(by_entity)
    ),
  constraint os_ss_inbox_p54_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=8192
      and public.phase54_ss_inbox_safe_detail(detail)
    ),
  constraint os_ss_inbox_p54_no_money_approve_check
    check (coalesce((detail->>'money_auto_approve')::boolean,false)=false)
);

create index if not exists os_ss_inbox_p54_entity_created_idx
  on public.os_ss_inbox_phase54_snapshots(entity_id, created_at desc);
create index if not exists os_ss_inbox_p54_created_idx
  on public.os_ss_inbox_phase54_snapshots(created_at desc);

alter table public.os_ss_inbox_phase54_snapshots enable row level security;
drop policy if exists "os_ss_inbox_p54_select"
  on public.os_ss_inbox_phase54_snapshots;
create policy "os_ss_inbox_p54_select"
  on public.os_ss_inbox_phase54_snapshots for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_ss_inbox_phase54_snapshots
  from public, anon, authenticated;
grant select on public.os_ss_inbox_phase54_snapshots
  to authenticated;

create or replace function public.reject_ss_inbox_phase54_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Shared Services inbox Phase 54 evidence is append-only';
end;
$$;

drop trigger if exists os_ss_inbox_p54_immutable
  on public.os_ss_inbox_phase54_snapshots;
create trigger os_ss_inbox_p54_immutable
  before update or delete on public.os_ss_inbox_phase54_snapshots
  for each row execute function public.reject_ss_inbox_phase54_mutation();
drop trigger if exists os_ss_inbox_p54_no_truncate
  on public.os_ss_inbox_phase54_snapshots;
create trigger os_ss_inbox_p54_no_truncate
  before truncate on public.os_ss_inbox_phase54_snapshots
  for each statement execute function public.reject_ss_inbox_phase54_mutation();

-- Append-only SLA escalation evidence (visibility only — never auto-approves).
create table if not exists public.os_ss_inbox_phase54_escalations (
  escalation_id uuid primary key default gen_random_uuid(),
  ticket_id text not null
    check (ticket_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$'),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  service text not null
    check (service in ('Finance','Legal','HR','IT','Marketing')),
  priority text
    check (priority is null or priority in ('P0','P1','P2','P3')),
  sla_status text not null
    check (sla_status in ('breached','due_soon','escalated')),
  owner_name text,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null default 'warning'
    check (severity in ('info','warning','critical')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_ss_inbox_p54_esc_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase54_ss_inbox_safe_detail(detail)
    ),
  constraint os_ss_inbox_p54_esc_no_money_approve_check
    check (coalesce((detail->>'money_auto_approve')::boolean,false)=false)
);

create index if not exists os_ss_inbox_p54_esc_created_idx
  on public.os_ss_inbox_phase54_escalations(created_at desc);
create index if not exists os_ss_inbox_p54_esc_ticket_idx
  on public.os_ss_inbox_phase54_escalations(ticket_id, created_at desc);
create index if not exists os_ss_inbox_p54_esc_entity_idx
  on public.os_ss_inbox_phase54_escalations(entity_id, created_at desc);

alter table public.os_ss_inbox_phase54_escalations enable row level security;
drop policy if exists "os_ss_inbox_p54_esc_select"
  on public.os_ss_inbox_phase54_escalations;
create policy "os_ss_inbox_p54_esc_select"
  on public.os_ss_inbox_phase54_escalations for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_ss_inbox_phase54_escalations
  from public, anon, authenticated;
grant select on public.os_ss_inbox_phase54_escalations
  to authenticated;

drop trigger if exists os_ss_inbox_p54_esc_immutable
  on public.os_ss_inbox_phase54_escalations;
create trigger os_ss_inbox_p54_esc_immutable
  before update or delete on public.os_ss_inbox_phase54_escalations
  for each row execute function public.reject_ss_inbox_phase54_mutation();
drop trigger if exists os_ss_inbox_p54_esc_no_truncate
  on public.os_ss_inbox_phase54_escalations;
create trigger os_ss_inbox_p54_esc_no_truncate
  before truncate on public.os_ss_inbox_phase54_escalations
  for each statement execute function public.reject_ss_inbox_phase54_mutation();

-- Optional ops alerts (feed / refresh) — append-only visibility only.
create table if not exists public.os_ss_inbox_phase54_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  alert_kind text not null
    check (alert_kind in (
      'feed_missing','feed_partial','sla_board_stale','refresh_failed',
      'escalation_spike'
    )),
  reference_id uuid,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null default 'warning'
    check (severity in ('info','warning','critical')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_ss_inbox_p54_alert_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase54_ss_inbox_safe_detail(detail)
    )
);

create index if not exists os_ss_inbox_p54_alerts_created_idx
  on public.os_ss_inbox_phase54_ops_alerts(created_at desc);

alter table public.os_ss_inbox_phase54_ops_alerts enable row level security;
drop policy if exists "os_ss_inbox_p54_alerts_select"
  on public.os_ss_inbox_phase54_ops_alerts;
create policy "os_ss_inbox_p54_alerts_select"
  on public.os_ss_inbox_phase54_ops_alerts for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_ss_inbox_phase54_ops_alerts
  from public, anon, authenticated;
grant select on public.os_ss_inbox_phase54_ops_alerts
  to authenticated;

drop trigger if exists os_ss_inbox_p54_alerts_immutable
  on public.os_ss_inbox_phase54_ops_alerts;
create trigger os_ss_inbox_p54_alerts_immutable
  before update or delete on public.os_ss_inbox_phase54_ops_alerts
  for each row execute function public.reject_ss_inbox_phase54_mutation();
drop trigger if exists os_ss_inbox_p54_alerts_no_truncate
  on public.os_ss_inbox_phase54_ops_alerts;
create trigger os_ss_inbox_p54_alerts_no_truncate
  before truncate on public.os_ss_inbox_phase54_ops_alerts
  for each statement execute function public.reject_ss_inbox_phase54_mutation();

-- Refresh Shared Services inbox board from optional ticket tables (fail-soft).
-- Finance module page is live (Phase 55). TODO: HR dedicated page in Phase 57.
-- Dual-approve gates are never mutated here.
create or replace function public.refresh_shared_services_inbox_phase54(
  p_actor_id uuid default null,
  p_entity_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity text := nullif(trim(coalesce(p_entity_id,'')),'');
  v_has_os boolean := false;
  v_has_ss boolean := false;
  v_feed text := 'missing';
  v_open integer := 0;
  v_breached integer := 0;
  v_due_soon integer := 0;
  v_escalated integer := 0;
  v_unassigned integer := 0;
  v_by_service jsonb := '{}'::jsonb;
  v_by_sla jsonb := '{}'::jsonb;
  v_by_entity jsonb := '{}'::jsonb;
  v_window text;
  v_hash text;
  v_id uuid;
  v_esc_ticket text;
  v_esc_service text;
  v_esc_entity text;
  v_esc_priority text;
  v_esc_owner text;
  v_esc_band text;
  v_esc_due timestamptz;
  v_esc_status text;
  v_esc_sev text;
  v_esc_hash text;
  v_esc_window text;
  v_row record;
begin
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 54 Shared Services inbox refresh';
  end if;

  -- auth.role() null = direct DB / migrate path (no JWT); JWT callers still RBAC.
  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 54 Shared Services inbox refresh';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is null then
    raise exception 'Firm-wide access or entity filter required for Phase 54 inbox refresh';
  end if;

  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_tickets'
  ) into v_has_os;

  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='ss_tickets'
  ) into v_has_ss;

  if v_has_os then
    v_feed := 'ok';
  elsif v_has_ss then
    v_feed := 'partial';
  else
    v_feed := 'missing';
  end if;

  -- Prefer normalized os_tickets; fall back to ss_tickets; else empty board.
  if v_has_os then
    select
      count(*)::integer,
      count(*) filter (
        where t.sla_due_at is not null and t.sla_due_at < now()
      )::integer,
      count(*) filter (
        where t.sla_due_at is not null
          and t.sla_due_at >= now()
          and t.sla_due_at <= now() + interval '24 hours'
      )::integer,
      count(*) filter (
        where coalesce(nullif(trim(t.assignee_name),''),'') = ''
      )::integer,
      coalesce(
        (
          select jsonb_object_agg(svc, cnt)
          from (
            select t2.service as svc, count(*)::integer as cnt
            from public.os_tickets t2
            where t2.status not in ('Resolved','Closed')
              and (v_entity is null or t2.entity_id = v_entity)
              and t2.service in ('Finance','Legal','HR','IT','Marketing')
            group by t2.service
          ) s
        ),
        '{}'::jsonb
      ),
      coalesce(
        (
          select jsonb_object_agg(ent, cnt)
          from (
            select coalesce(t3.entity_id,'__firm__') as ent, count(*)::integer as cnt
            from public.os_tickets t3
            where t3.status not in ('Resolved','Closed')
              and (v_entity is null or t3.entity_id = v_entity)
            group by coalesce(t3.entity_id,'__firm__')
          ) e
        ),
        '{}'::jsonb
      )
    into
      v_open, v_breached, v_due_soon, v_unassigned, v_by_service, v_by_entity
    from public.os_tickets t
    where t.status not in ('Resolved','Closed')
      and (v_entity is null or t.entity_id = v_entity);

    v_by_sla := jsonb_build_object(
      'breached', coalesce(v_breached,0),
      'due_soon', coalesce(v_due_soon,0),
      'ok', greatest(
        coalesce(v_open,0) - coalesce(v_breached,0) - coalesce(v_due_soon,0),
        0
      )
    );

    -- Record escalations for breached / P0 / ESCALATE open tickets (idempotent day key).
    for v_row in
      select
        t.ticket_id,
        t.service,
        t.entity_id,
        t.priority,
        t.assignee_name,
        t.autonomy_band,
        t.sla_due_at
      from public.os_tickets t
      where t.status not in ('Resolved','Closed')
        and (v_entity is null or t.entity_id = v_entity)
        and t.service in ('Finance','Legal','HR','IT','Marketing')
        and (
          (t.sla_due_at is not null and t.sla_due_at < now())
          or t.priority = 'P0'
          or t.autonomy_band = 'ESCALATE'
        )
      order by t.updated_at desc
      limit 100
    loop
      v_esc_ticket := v_row.ticket_id;
      v_esc_service := v_row.service;
      v_esc_entity := v_row.entity_id;
      v_esc_priority := v_row.priority;
      v_esc_owner := v_row.assignee_name;
      v_esc_band := v_row.autonomy_band;
      v_esc_due := v_row.sla_due_at;

      if v_esc_due is not null and v_esc_due < now() then
        v_esc_status := 'breached';
        v_esc_sev := 'critical';
      elsif v_esc_priority = 'P0' or v_esc_band = 'ESCALATE' then
        v_esc_status := 'escalated';
        v_esc_sev := 'warning';
      else
        v_esc_status := 'due_soon';
        v_esc_sev := 'info';
      end if;

      v_esc_window := 'phase54:esc:' || v_esc_ticket || ':'
        || to_char(now() at time zone 'utc','YYYY-MM-DD');
      v_esc_hash := public.os_sha256_hex(
        v_esc_ticket || '|' || coalesce(v_esc_service,'') || '|'
        || coalesce(v_esc_status,'') || '|' || v_esc_window
      );

      insert into public.os_ss_inbox_phase54_escalations (
        ticket_id, entity_id, service, priority, sla_status, owner_name,
        window_key, severity, metrics_sha256, detail
      ) values (
        v_esc_ticket, v_esc_entity, v_esc_service, v_esc_priority, v_esc_status,
        v_esc_owner, v_esc_window, v_esc_sev, v_esc_hash,
        jsonb_build_object(
          'contract_version', 'phase54-v1',
          'source', 'refresh_shared_services_inbox_phase54',
          'autonomy_band', v_esc_band,
          'money_auto_approve', false
        )
      ) on conflict (window_key) do nothing;

      v_escalated := v_escalated + 1;
    end loop;
  elsif v_has_ss then
    -- Partial feed: ss_tickets present but normalized os_tickets missing.
    select count(*)::integer
    into v_open
    from public.ss_tickets t
    where t.status not in ('Resolved','Closed')
      and (v_entity is null or t.entity_id = v_entity);
    v_by_sla := jsonb_build_object('breached', 0, 'due_soon', 0, 'ok', coalesce(v_open,0));
    v_feed := 'partial';
  else
    -- TODO: wire ticket feed when tables absent (empty board, feed_status=missing).
    v_open := 0;
    v_feed := 'missing';
    v_by_sla := jsonb_build_object('breached', 0, 'due_soon', 0, 'ok', 0);
  end if;

  v_window := 'phase54:inbox:'
    || coalesce(v_entity,'firm') || ':'
    || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24');
  v_hash := public.os_sha256_hex(
    coalesce(v_entity,'firm') || '|' || coalesce(v_open,0)::text || '|'
    || coalesce(v_breached,0)::text || '|' || coalesce(v_escalated,0)::text
    || '|' || v_by_service::text || '|' || v_window
  );

  insert into public.os_ss_inbox_phase54_snapshots (
    entity_id, window_key, open_total, by_service, by_sla_status, by_entity,
    escalated_count, breached_count, due_soon_count, unassigned_count,
    feed_status, metrics_sha256, detail, actor_id
  ) values (
    v_entity, v_window, coalesce(v_open,0), coalesce(v_by_service,'{}'::jsonb),
    coalesce(v_by_sla,'{}'::jsonb), coalesce(v_by_entity,'{}'::jsonb),
    coalesce(v_escalated,0), coalesce(v_breached,0), coalesce(v_due_soon,0),
    coalesce(v_unassigned,0), v_feed, v_hash,
    jsonb_build_object(
      'contract_version', 'phase54-v1',
      'source', 'refresh_shared_services_inbox_phase54',
      'has_os_tickets', v_has_os,
      'has_ss_tickets', v_has_ss,
      'todo_hr_page', true,
      'finance_page_live', true,
      'money_auto_approve', false
    ),
    p_actor_id
  )
  on conflict (window_key) do nothing
  returning snapshot_id into v_id;

  if v_id is null then
    select snapshot_id into v_id
    from public.os_ss_inbox_phase54_snapshots
    where window_key = v_window;
  end if;

  if v_feed = 'missing' then
    insert into public.os_ss_inbox_phase54_ops_alerts (
      entity_id, alert_kind, reference_id, window_key, severity,
      metrics_sha256, detail
    ) values (
      v_entity, 'feed_missing', v_id,
      'phase54:alert:feed_missing:' || coalesce(v_entity,'firm') || ':'
        || to_char(now() at time zone 'utc','YYYY-MM-DD'),
      'warning', v_hash,
      jsonb_build_object(
        'contract_version', 'phase54-v1',
        'source', 'refresh_shared_services_inbox_phase54',
        'money_auto_approve', false
      )
    ) on conflict (window_key) do nothing;
  end if;

  if v_feed = 'partial' then
    insert into public.os_ss_inbox_phase54_ops_alerts (
      entity_id, alert_kind, reference_id, window_key, severity,
      metrics_sha256, detail
    ) values (
      v_entity, 'feed_partial', v_id,
      'phase54:alert:feed_partial:' || coalesce(v_entity,'firm') || ':'
        || to_char(now() at time zone 'utc','YYYY-MM-DD'),
      'info', v_hash,
      jsonb_build_object(
        'contract_version', 'phase54-v1',
        'source', 'refresh_shared_services_inbox_phase54',
        'money_auto_approve', false
      )
    ) on conflict (window_key) do nothing;
  end if;

  return jsonb_build_object(
    'snapshot_id', v_id,
    'entity_id', v_entity,
    'open_total', coalesce(v_open,0),
    'by_service', coalesce(v_by_service,'{}'::jsonb),
    'by_sla_status', coalesce(v_by_sla,'{}'::jsonb),
    'by_entity', coalesce(v_by_entity,'{}'::jsonb),
    'escalated_count', coalesce(v_escalated,0),
    'breached_count', coalesce(v_breached,0),
    'due_soon_count', coalesce(v_due_soon,0),
    'unassigned_count', coalesce(v_unassigned,0),
    'feed_status', v_feed,
    'money_auto_approve', false,
    'contract_version', 'phase54-v1'
  );
end $$;

create or replace function public.get_shared_services_inbox_phase54_report(
  p_entity_id text default null,
  p_service text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_entity text := nullif(trim(coalesce(p_entity_id,'')),'');
  v_service text := nullif(trim(coalesce(p_service,'')),'');
  v_latest public.os_ss_inbox_phase54_snapshots%rowtype;
  v_escalations jsonb := '[]'::jsonb;
  v_alerts jsonb := '[]'::jsonb;
  v_module_stubs jsonb;
begin
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 54 Shared Services inbox report';
  end if;

  if v_service is not null
     and v_service not in ('Finance','Legal','HR','IT','Marketing') then
    raise exception 'Invalid service for Phase 54 Shared Services inbox report';
  end if;

  -- auth.role() null = direct DB / migrate path (no JWT); JWT callers still RBAC.
  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 54 Shared Services inbox report';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is null then
    raise exception 'Firm-wide access or entity filter required for Phase 54 inbox report';
  end if;

  select * into v_latest
  from public.os_ss_inbox_phase54_snapshots s
  where (v_entity is null and s.entity_id is null)
     or (v_entity is not null and s.entity_id = v_entity)
  order by s.created_at desc
  limit 1;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc), '[]'::jsonb)
  into v_escalations
  from (
    select
      e.escalation_id, e.ticket_id, e.entity_id, e.service, e.priority,
      e.sla_status, e.owner_name, e.severity, e.created_at
    from public.os_ss_inbox_phase54_escalations e
    where (v_entity is null or e.entity_id = v_entity)
      and (v_service is null or e.service = v_service)
    order by e.created_at desc
    limit 40
  ) t;

  select coalesce(jsonb_agg(row_to_json(a)::jsonb order by a.created_at desc), '[]'::jsonb)
  into v_alerts
  from (
    select al.alert_id, al.alert_kind, al.severity, al.entity_id, al.created_at
    from public.os_ss_inbox_phase54_ops_alerts al
    where (v_entity is null or al.entity_id = v_entity)
    order by al.created_at desc
    limit 12
  ) a;

  -- Fail-soft stubs: Finance live (Phase 55); HR still planned (Phase 57).
  v_module_stubs := jsonb_build_array(
    jsonb_build_object(
      'service', 'Finance',
      'href', '/shared-services/finance',
      'status', 'live',
      'todo', null
    ),
    jsonb_build_object(
      'service', 'HR',
      'href', '/shared-services?service=HR',
      'status', 'planned',
      'todo', 'Phase 57 HR production hardening — dedicated HR page not yet live'
    ),
    jsonb_build_object(
      'service', 'Legal',
      'href', '/shared-services/legal/docusign',
      'status', 'live',
      'todo', null
    ),
    jsonb_build_object(
      'service', 'IT',
      'href', '/shared-services/it/assets',
      'status', 'live',
      'todo', null
    ),
    jsonb_build_object(
      'service', 'Marketing',
      'href', '/shared-services/marketing',
      'status', 'foundation',
      'todo', null
    )
  );

  if v_latest.snapshot_id is null then
    return jsonb_build_object(
      'entity_id', v_entity,
      'service_filter', v_service,
      'open_total', 0,
      'by_service', '{}'::jsonb,
      'by_sla_status', jsonb_build_object('breached',0,'due_soon',0,'ok',0),
      'by_entity', '{}'::jsonb,
      'escalated_count', 0,
      'breached_count', 0,
      'due_soon_count', 0,
      'unassigned_count', 0,
      'feed_status', 'missing',
      'snapshot_id', null,
      'captured_at', null,
      'recent_escalations', v_escalations,
      'recent_alerts', v_alerts,
      'module_stubs', v_module_stubs,
      'entity_filter_hint', 'ENT-R619',
      'todo', 'Refresh inbox board from os_tickets; HR module page is a stub until Phase 57',
      'money_auto_approve', false,
      'contract_version', 'phase54-v1'
    );
  end if;

  return jsonb_build_object(
    'entity_id', v_entity,
    'service_filter', v_service,
    'open_total', v_latest.open_total,
    'by_service', coalesce(v_latest.by_service,'{}'::jsonb),
    'by_sla_status', coalesce(v_latest.by_sla_status,'{}'::jsonb),
    'by_entity', coalesce(v_latest.by_entity,'{}'::jsonb),
    'escalated_count', v_latest.escalated_count,
    'breached_count', v_latest.breached_count,
    'due_soon_count', v_latest.due_soon_count,
    'unassigned_count', v_latest.unassigned_count,
    'feed_status', v_latest.feed_status,
    'snapshot_id', v_latest.snapshot_id,
    'captured_at', v_latest.created_at,
    'recent_escalations', v_escalations,
    'recent_alerts', v_alerts,
    'module_stubs', v_module_stubs,
    'entity_filter_hint', 'ENT-R619',
    'todo', 'Finance control plane live (Phase 55); HR dedicated page pending Phase 57',
    'money_auto_approve', false,
    'contract_version', 'phase54-v1'
  );
end $$;

revoke all on function public.refresh_shared_services_inbox_phase54(uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_shared_services_inbox_phase54_report(text, text)
  from public, anon, authenticated;
grant execute on function public.refresh_shared_services_inbox_phase54(uuid, text)
  to authenticated, service_role;
grant execute on function public.get_shared_services_inbox_phase54_report(text, text)
  to authenticated, service_role;
