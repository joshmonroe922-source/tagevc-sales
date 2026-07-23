-- Multi-subsidiary readiness P2: Ticketing multi-entity.
-- Required entity_id (fail-closed on new creates), context links, subsidiary APIs.
-- Apply after phase_ms_p1. Safe to re-run. Additive only.
-- Never auto-approves money. Never mutates snapshot retirement tables.
-- Preserve diagnose/approve/escalate + forbid-list safety (app-layer).

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

create or replace function public.phase_ms_p2_safe_detail(p_detail jsonb)
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

-- Context link vocabulary for subsidiary records.
create table if not exists public.os_ticket_context_link_types (
  link_type text primary key
    check (link_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  entity_code text not null
    check (entity_code ~ '^ENT-[A-Z0-9-]{1,32}$'),
  label text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.os_ticket_context_link_types enable row level security;
drop policy if exists "os_ticket_ctx_link_types_select"
  on public.os_ticket_context_link_types;
create policy "os_ticket_ctx_link_types_select"
  on public.os_ticket_context_link_types for select to authenticated
  using (true);
revoke all on public.os_ticket_context_link_types
  from public, anon, authenticated;
grant select on public.os_ticket_context_link_types to authenticated;

insert into public.os_ticket_context_link_types
  (link_type, entity_code, label, description)
values
  ('r619_account','ENT-R619','Recruit account','Recruit 619 company/account'),
  ('r619_person','ENT-R619','Recruit person','Candidate or contact person'),
  ('r619_job','ENT-R619','Recruit job','Open requisition / job'),
  ('r619_placement','ENT-R619','Recruit placement','Placement record'),
  ('r619_application','ENT-R619','Recruit application','Application / pipeline stage'),
  ('r619_offer','ENT-R619','Recruit offer','Offer letter / package'),
  ('inda_customer','ENT-INDA','Instant NDA customer','Customer account'),
  ('inda_subscription','ENT-INDA','Instant NDA subscription','Subscription / plan'),
  ('inda_lead','ENT-INDA','Instant NDA lead','Sales lead'),
  ('inda_support_case','ENT-INDA','Instant NDA support case','Support case'),
  ('inda_usage_event','ENT-INDA','Instant NDA usage event','Usage / metering event')
on conflict (link_type) do update set
  entity_code = excluded.entity_code,
  label = excluded.label,
  description = excluded.description,
  active = true;

create table if not exists public.os_ticket_context_links (
  link_id uuid primary key default gen_random_uuid(),
  ticket_id text not null
    check (ticket_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$'),
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  link_type text not null
    references public.os_ticket_context_link_types(link_type),
  external_ref text not null
    check (char_length(external_ref) between 1 and 200),
  label text,
  href text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_ticket_ctx_links_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase_ms_p2_safe_detail(detail)
    ),
  constraint os_ticket_ctx_links_no_money_approve_check
    check (coalesce((detail->>'money_auto_approve')::boolean,false)=false),
  unique (ticket_id, link_type, external_ref)
);

create index if not exists os_ticket_ctx_links_ticket_idx
  on public.os_ticket_context_links(ticket_id);
create index if not exists os_ticket_ctx_links_entity_idx
  on public.os_ticket_context_links(entity_id, created_at desc);

alter table public.os_ticket_context_links enable row level security;
drop policy if exists "os_ticket_ctx_links_select"
  on public.os_ticket_context_links;
create policy "os_ticket_ctx_links_select"
  on public.os_ticket_context_links for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_ticket_context_links from public, anon, authenticated;
grant select on public.os_ticket_context_links to authenticated;

-- Append-only create/backfill evidence (fail-closed creates logged here too).
create table if not exists public.os_ticket_entity_backfill_audits (
  audit_id uuid primary key default gen_random_uuid(),
  ticket_id text not null,
  previous_entity_id text,
  new_entity_id text,
  change_kind text not null
    check (change_kind in (
      'backfill_unknown','normalize_alias','reject_create','create_ok'
    )),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_ticket_entity_bf_detail_check
    check (
      jsonb_typeof(detail)='object'
      and public.phase_ms_p2_safe_detail(detail)
    ),
  constraint os_ticket_entity_bf_no_money_approve_check
    check (coalesce((detail->>'money_auto_approve')::boolean,false)=false)
);

create index if not exists os_ticket_entity_bf_created_idx
  on public.os_ticket_entity_backfill_audits(created_at desc);

alter table public.os_ticket_entity_backfill_audits enable row level security;
drop policy if exists "os_ticket_entity_bf_select"
  on public.os_ticket_entity_backfill_audits;
create policy "os_ticket_entity_bf_select"
  on public.os_ticket_entity_backfill_audits for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_ticket_entity_backfill_audits
  from public, anon, authenticated;
grant select on public.os_ticket_entity_backfill_audits to authenticated;

create or replace function public.reject_os_ticket_entity_bf_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Ticket entity backfill audits are append-only';
end;
$$;

drop trigger if exists os_ticket_entity_bf_immutable
  on public.os_ticket_entity_backfill_audits;
create trigger os_ticket_entity_bf_immutable
  before update or delete on public.os_ticket_entity_backfill_audits
  for each row execute function public.reject_os_ticket_entity_bf_mutation();
drop trigger if exists os_ticket_entity_bf_no_truncate
  on public.os_ticket_entity_backfill_audits;
create trigger os_ticket_entity_bf_no_truncate
  before truncate on public.os_ticket_entity_backfill_audits
  for each statement execute function public.reject_os_ticket_entity_bf_mutation();

-- Careful backfill: unknown/null tickets → ENT-FIRM (parent catch-all), not deleted.
-- Alias ENT-002 → store note only; app normalizes to ENT-INDA on new writes.
do $$
declare
  v_has_os boolean;
  v_has_ss boolean;
  r record;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_tickets'
  ) into v_has_os;
  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='ss_tickets'
  ) into v_has_ss;

  if v_has_os then
    for r in
      select ticket_id, entity_id
      from public.os_tickets
      where entity_id is null or btrim(entity_id) = ''
    loop
      update public.os_tickets
      set entity_id = 'ENT-FIRM',
          updated_at = now()
      where ticket_id = r.ticket_id
        and (entity_id is null or btrim(entity_id) = '');
      insert into public.os_ticket_entity_backfill_audits (
        ticket_id, previous_entity_id, new_entity_id, change_kind,
        metrics_sha256, detail
      ) values (
        r.ticket_id,
        r.entity_id,
        'ENT-FIRM',
        'backfill_unknown',
        public.os_sha256_hex('bf:' || r.ticket_id || ':ENT-FIRM'),
        jsonb_build_object(
          'money_auto_approve',false,
          'contract_version','ms-p2-v1',
          'note','Unknown entity backfilled to ENT-FIRM (fail-soft parent)'
        )
      );
    end loop;
  end if;

  -- ss_tickets fail-soft probe only (structure may differ).
  if v_has_ss then
    null; -- TODO: align ss_tickets.entity_id when column present in env
  end if;
end;
$$;

-- Subsidiary token allowlist (least privilege; secrets live in env, not here).
create table if not exists public.os_subsidiary_api_clients (
  client_id text primary key
    check (client_id ~ '^[a-z][a-z0-9_-]{2,63}$'),
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  display_name text not null,
  scopes text[] not null default array['tickets:read','tickets:write']::text[],
  active boolean not null default true,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_sub_api_clients_detail_check
    check (
      jsonb_typeof(detail)='object'
      and public.phase_ms_p2_safe_detail(detail)
    ),
  constraint os_sub_api_clients_no_money_approve_check
    check (coalesce((detail->>'money_auto_approve')::boolean,false)=false)
);

alter table public.os_subsidiary_api_clients enable row level security;
drop policy if exists "os_sub_api_clients_select"
  on public.os_subsidiary_api_clients;
create policy "os_sub_api_clients_select"
  on public.os_subsidiary_api_clients for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_subsidiary_api_clients
  from public, anon, authenticated;
grant select on public.os_subsidiary_api_clients to authenticated;

insert into public.os_subsidiary_api_clients
  (client_id, entity_id, display_name, scopes, detail)
values
  (
    'recruit619_portal',
    'ENT-R619',
    'Recruit 619 portal',
    array['tickets:read','tickets:write']::text[],
    jsonb_build_object(
      'portal','https://portal.recruit619.com',
      'money_auto_approve',false,
      'contract_version','ms-p2-v1'
    )
  ),
  (
    'instantnda_portal',
    'ENT-INDA',
    'Instant NDA portal',
    array['tickets:read','tickets:write']::text[],
    jsonb_build_object(
      'portal_todo','TODO: Instant NDA portal URL',
      'legacy_alias','ENT-002',
      'money_auto_approve',false,
      'contract_version','ms-p2-v1'
    )
  )
on conflict (client_id) do update set
  entity_id = excluded.entity_id,
  display_name = excluded.display_name,
  scopes = excluded.scopes,
  detail = excluded.detail,
  active = true;

create table if not exists public.os_subsidiary_ticket_api_audits (
  audit_id uuid primary key default gen_random_uuid(),
  client_id text,
  entity_id text,
  action text not null
    check (action in (
      'create','get_status','list_mine','list_entity','auth_reject'
    )),
  ticket_id text,
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_sub_ticket_api_detail_check
    check (
      jsonb_typeof(detail)='object'
      and public.phase_ms_p2_safe_detail(detail)
    ),
  constraint os_sub_ticket_api_no_money_approve_check
    check (coalesce((detail->>'money_auto_approve')::boolean,false)=false)
);

create index if not exists os_sub_ticket_api_audits_created_idx
  on public.os_subsidiary_ticket_api_audits(created_at desc);

alter table public.os_subsidiary_ticket_api_audits enable row level security;
drop policy if exists "os_sub_ticket_api_audits_select"
  on public.os_subsidiary_ticket_api_audits;
create policy "os_sub_ticket_api_audits_select"
  on public.os_subsidiary_ticket_api_audits for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_subsidiary_ticket_api_audits
  from public, anon, authenticated;
grant select on public.os_subsidiary_ticket_api_audits to authenticated;

create or replace function public.reject_os_sub_ticket_api_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Subsidiary ticket API audits are append-only';
end;
$$;

drop trigger if exists os_sub_ticket_api_immutable
  on public.os_subsidiary_ticket_api_audits;
create trigger os_sub_ticket_api_immutable
  before update or delete on public.os_subsidiary_ticket_api_audits
  for each row execute function public.reject_os_sub_ticket_api_mutation();
drop trigger if exists os_sub_ticket_api_no_truncate
  on public.os_subsidiary_ticket_api_audits;
create trigger os_sub_ticket_api_no_truncate
  before truncate on public.os_subsidiary_ticket_api_audits
  for each statement execute function public.reject_os_sub_ticket_api_mutation();

-- Read helpers for subsidiary portals (service_role / authenticated with scope).
create or replace function public.list_entity_tickets_ms_p2(
  p_entity_id text,
  p_service text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := public.resolve_canonical_entity_id(p_entity_id);
  v_limit integer := greatest(1, least(coalesce(p_limit,50), 200));
  v_has boolean;
  v_rows jsonb := '[]'::jsonb;
begin
  if v_entity is null then
    raise exception 'entity_id required';
  end if;
  if auth.role() <> 'service_role'
     and not public.is_firm_wide_access()
     and not public.can_access_entity(v_entity)
     and not public.can_access_entity(p_entity_id) then
    raise exception 'not authorized for entity %', v_entity;
  end if;

  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_tickets'
  ) into v_has;

  if not v_has then
    return jsonb_build_object(
      'contract_version','ms-p2-v1',
      'money_auto_approve',false,
      'feed_status','missing',
      'entity_id',v_entity,
      'tickets','[]'::jsonb,
      'todo','os_tickets table missing'
    );
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  into v_rows
  from (
    select
      ticket_id, title, status, service, priority, entity_id,
      assignee_name, requester_name, created_at, updated_at, sla_due_at,
      autonomy_band, draft_approval
    from public.os_tickets
    where (
      public.entity_ids_equivalent(entity_id, v_entity)
      or public.entity_ids_equivalent(entity_id, p_entity_id)
    )
      and (p_service is null or service = p_service)
    order by created_at desc
    limit v_limit
  ) t;

  return jsonb_build_object(
    'contract_version','ms-p2-v1',
    'money_auto_approve',false,
    'feed_status','ok',
    'entity_id',v_entity,
    'tickets',v_rows
  );
end;
$$;

revoke all on function public.list_entity_tickets_ms_p2(text, text, integer)
  from public, anon;
grant execute on function public.list_entity_tickets_ms_p2(text, text, integer)
  to authenticated, service_role;

create or replace function public.get_ticket_status_ms_p2(p_ticket_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_row record;
  v_has boolean;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_tickets'
  ) into v_has;
  if not v_has then
    return jsonb_build_object(
      'contract_version','ms-p2-v1',
      'money_auto_approve',false,
      'found',false,
      'feed_status','missing'
    );
  end if;

  select * into v_row
  from public.os_tickets
  where ticket_id = p_ticket_id
  limit 1;

  if not found then
    return jsonb_build_object(
      'contract_version','ms-p2-v1',
      'money_auto_approve',false,
      'found',false
    );
  end if;

  if auth.role() <> 'service_role'
     and not public.is_firm_wide_access()
     and v_row.entity_id is not null
     and not public.can_access_entity(v_row.entity_id) then
    raise exception 'not authorized';
  end if;

  return jsonb_build_object(
    'contract_version','ms-p2-v1',
    'money_auto_approve',false,
    'found',true,
    'ticket_id',v_row.ticket_id,
    'status',v_row.status,
    'service',v_row.service,
    'priority',v_row.priority,
    'entity_id',v_row.entity_id,
    'autonomy_band',v_row.autonomy_band,
    'draft_approval',v_row.draft_approval,
    'updated_at',v_row.updated_at
  );
end;
$$;

revoke all on function public.get_ticket_status_ms_p2(text)
  from public, anon;
grant execute on function public.get_ticket_status_ms_p2(text)
  to authenticated, service_role;
