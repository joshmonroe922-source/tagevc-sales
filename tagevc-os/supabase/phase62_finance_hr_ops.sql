-- Phase 62: Finance + HR operating depth (additive).
-- Apply after Phase 55 + Phase 57. Safe to re-run.
-- IES remains system of record. Never auto-approves money.
-- Never mutates snapshot retirement tables.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Optional IES finance feed (orchestration read surface).
-- Refresh already probes this table; creating it enables fail-soft reads.
-- ---------------------------------------------------------------------------
create table if not exists public.os_ies_finance_feed (
  feed_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  as_of date,
  cash_on_hand numeric(18,2),
  ar_balance numeric(18,2),
  ap_balance numeric(18,2),
  burn_rate_monthly numeric(18,2),
  close_pct_complete numeric(5,2)
    check (close_pct_complete is null or (
      close_pct_complete >= 0 and close_pct_complete <= 100
    )),
  source_system text not null default 'ies'
    check (source_system ~ '^[A-Za-z0-9._-]{2,64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_ies_fin_feed_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
    )
);

create index if not exists os_ies_finance_feed_entity_as_of_idx
  on public.os_ies_finance_feed (entity_id, as_of desc nulls last, created_at desc);

alter table public.os_ies_finance_feed enable row level security;

drop policy if exists os_ies_finance_feed_select on public.os_ies_finance_feed;
create policy os_ies_finance_feed_select
  on public.os_ies_finance_feed
  for select
  to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );

-- Seed empty Recruit placeholder so operators see the feed surface exists.
-- Values stay null until live IES sync; detail marks orchestration stub.
insert into public.os_ies_finance_feed (
  entity_id, as_of, source_system, detail
)
select
  'ENT-R619',
  (now() at time zone 'utc')::date,
  'ies',
  jsonb_build_object(
    'stub', true,
    'phase', 'phase62',
    'note', 'IES feed row reserved for Recruit 619 — values null until live sync'
  )
where not exists (
  select 1 from public.os_ies_finance_feed f
  where f.entity_id = 'ENT-R619'
);

-- ---------------------------------------------------------------------------
-- Year-end close checklist seed (orchestration only).
-- ---------------------------------------------------------------------------
create or replace function public.seed_finance_year_end_checklist_phase62(
  p_actor_id uuid default null,
  p_entity_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity text := nullif(trim(coalesce(p_entity_id,'')),'');
  v_period text := to_char(now() at time zone 'utc','YYYY');
  v_seeded integer := 0;
begin
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 62 year-end seed';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 62 year-end seed';
  end if;

  if not exists (
    select 1 from public.os_finance_close_checklist_phase55_events e
    where e.close_kind = 'year_end'
      and e.period_key = v_period
      and (v_entity is null and e.entity_id is null
           or v_entity is not null and e.entity_id = v_entity)
  ) then
    perform public.record_finance_close_checklist_event_phase55(
      jsonb_build_object(
        'entity_id', v_entity,
        'close_kind', 'year_end',
        'period_key', v_period,
        'item_key', 'year_end_accruals',
        'item_label', 'Year-end accruals review',
        'status', 'open',
        'actor_id', p_actor_id,
        'detail', jsonb_build_object('source','seed_finance_year_end_checklist_phase62')
      )
    );
    perform public.record_finance_close_checklist_event_phase55(
      jsonb_build_object(
        'entity_id', v_entity,
        'close_kind', 'year_end',
        'period_key', v_period,
        'item_key', 'year_end_tax_pack',
        'item_label', 'Tax pack readiness',
        'status', 'open',
        'actor_id', p_actor_id,
        'detail', jsonb_build_object('source','seed_finance_year_end_checklist_phase62')
      )
    );
    perform public.record_finance_close_checklist_event_phase55(
      jsonb_build_object(
        'entity_id', v_entity,
        'close_kind', 'year_end',
        'period_key', v_period,
        'item_key', 'year_end_audit_binders',
        'item_label', 'Audit binder completeness',
        'status', 'open',
        'actor_id', p_actor_id,
        'detail', jsonb_build_object('source','seed_finance_year_end_checklist_phase62')
      )
    );
    perform public.record_finance_close_checklist_event_phase55(
      jsonb_build_object(
        'entity_id', v_entity,
        'close_kind', 'year_end',
        'period_key', v_period,
        'item_key', 'year_end_board_pack',
        'item_label', 'Board financial pack',
        'status', 'open',
        'actor_id', p_actor_id,
        'detail', jsonb_build_object('source','seed_finance_year_end_checklist_phase62')
      )
    );
    v_seeded := 4;
  end if;

  return jsonb_build_object(
    'ok', true,
    'seeded', v_seeded,
    'period_key', v_period,
    'entity_id', v_entity,
    'money_auto_approve', false,
    'ies_write_executed', false,
    'contract_version', 'phase62-v1'
  );
end;
$$;

revoke all on function public.seed_finance_year_end_checklist_phase62(uuid, text)
  from public, anon, authenticated;
grant execute on function public.seed_finance_year_end_checklist_phase62(uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Finance / HR request template catalog (orchestration metadata).
-- ---------------------------------------------------------------------------
create table if not exists public.os_ss_request_templates_phase62 (
  template_id text primary key
    check (template_id ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{2,63}$'),
  service text not null
    check (service in ('Finance','HR','IT','Legal','Marketing')),
  title text not null check (char_length(title) between 2 and 160),
  description text not null check (char_length(description) between 2 and 800),
  default_priority text not null default 'P2'
    check (default_priority in ('P0','P1','P2','P3')),
  entity_scope text not null default 'any'
    check (entity_scope in ('any','firm','subsidiary')),
  active boolean not null default true,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_ss_req_tpl_p62_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=2048)
);

alter table public.os_ss_request_templates_phase62 enable row level security;

drop policy if exists os_ss_req_tpl_p62_select on public.os_ss_request_templates_phase62;
create policy os_ss_req_tpl_p62_select
  on public.os_ss_request_templates_phase62
  for select
  to authenticated
  using (true);

insert into public.os_ss_request_templates_phase62
  (template_id, service, title, description, default_priority, entity_scope, detail)
values
  (
    'fin_close_help',
    'Finance',
    'Help with month-end close item',
    'Need support completing a close checklist item (bank rec, AP/AR, intercompany).',
    'P2',
    'any',
    jsonb_build_object('phase','phase62','kind','close')
  ),
  (
    'fin_anomaly_review',
    'Finance',
    'Review finance exception',
    'Flagged anomaly or variance needs human review before any IES change.',
    'P1',
    'any',
    jsonb_build_object('phase','phase62','kind','anomaly')
  ),
  (
    'fin_writeback_request',
    'Finance',
    'Request IES write-back review',
    'Propose an accounting note or adjustment for dual-approve — operator executes in IES.',
    'P1',
    'any',
    jsonb_build_object('phase','phase62','kind','writeback')
  ),
  (
    'hr_new_hire',
    'HR',
    'New hire onboarding',
    'Start joiner checklist: profile, access, IT hardware/license, and company assignment.',
    'P1',
    'any',
    jsonb_build_object('phase','phase62','kind','joiner')
  ),
  (
    'hr_role_change',
    'HR',
    'Role or company change',
    'Mover flow: update company/role and re-scope messaging and ticketing access.',
    'P2',
    'any',
    jsonb_build_object('phase','phase62','kind','mover')
  ),
  (
    'hr_offboard',
    'HR',
    'Offboarding / access revoke',
    'Leaver flow: revoke access first, then IT return and evidence pack.',
    'P0',
    'any',
    jsonb_build_object('phase','phase62','kind','leaver')
  )
on conflict (template_id) do update
set
  title = excluded.title,
  description = excluded.description,
  default_priority = excluded.default_priority,
  entity_scope = excluded.entity_scope,
  active = true,
  detail = excluded.detail;
