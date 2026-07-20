-- Phase 15: Handoffs + audit trails (enable safe snapshot write cutover)
-- Apply after phase14_portfolio_entity.sql
-- Nested JSONB payloads in os_store_snapshots move to first-class tables.

-- ---------------------------------------------------------------------------
-- Portfolio handoff packs (PH-###) — shared across VC / MA / RE
-- ---------------------------------------------------------------------------
create table if not exists public.os_handoffs (
  id uuid primary key default gen_random_uuid(),
  handoff_id text not null unique,
  track text not null,
  source_id text not null,
  company_name text not null,
  entity_id text,
  portfolio_id text,
  status text not null,
  path text,
  close_date date,
  thesis text,
  checklist_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_handoffs_track_idx on public.os_handoffs (track);
create index if not exists os_handoffs_source_id_idx on public.os_handoffs (source_id);
create index if not exists os_handoffs_status_idx on public.os_handoffs (status);
create index if not exists os_handoffs_updated_at_idx on public.os_handoffs (updated_at desc);

alter table public.os_handoffs enable row level security;

drop policy if exists "os_handoffs_authenticated_select" on public.os_handoffs;
create policy "os_handoffs_authenticated_select"
  on public.os_handoffs for select to authenticated using (true);

drop policy if exists "os_handoffs_authenticated_write" on public.os_handoffs;
create policy "os_handoffs_authenticated_write"
  on public.os_handoffs for all to authenticated
  using (true) with check (true);

grant select, insert, update, delete on public.os_handoffs to authenticated;

-- ---------------------------------------------------------------------------
-- IC decision audits (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_ic_audits (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  ic_id text not null,
  deal_id text not null,
  action text not null,
  decision text,
  detail text not null default '',
  actor text not null,
  created_at timestamptz not null default now()
);

create index if not exists os_ic_audits_deal_id_idx on public.os_ic_audits (deal_id);
create index if not exists os_ic_audits_ic_id_idx on public.os_ic_audits (ic_id);
create index if not exists os_ic_audits_created_at_idx on public.os_ic_audits (created_at desc);

alter table public.os_ic_audits enable row level security;

drop policy if exists "os_ic_audits_authenticated_select" on public.os_ic_audits;
create policy "os_ic_audits_authenticated_select"
  on public.os_ic_audits for select to authenticated using (true);

drop policy if exists "os_ic_audits_authenticated_write" on public.os_ic_audits;
create policy "os_ic_audits_authenticated_write"
  on public.os_ic_audits for all to authenticated
  using (true) with check (true);

grant select, insert, update, delete on public.os_ic_audits to authenticated;

-- ---------------------------------------------------------------------------
-- Ticket agent audits
-- ---------------------------------------------------------------------------
create table if not exists public.os_ticket_audits (
  id uuid primary key default gen_random_uuid(),
  audit_id text not null unique,
  ticket_id text not null,
  band text not null,
  confidence numeric not null default 0,
  action text not null,
  reasoning text not null default '',
  forbid_hits jsonb not null default '[]'::jsonb,
  approval text,
  payload_hash text,
  actor text not null,
  created_at timestamptz not null default now()
);

create index if not exists os_ticket_audits_ticket_id_idx on public.os_ticket_audits (ticket_id);
create index if not exists os_ticket_audits_created_at_idx on public.os_ticket_audits (created_at desc);

alter table public.os_ticket_audits enable row level security;

drop policy if exists "os_ticket_audits_authenticated_select" on public.os_ticket_audits;
create policy "os_ticket_audits_authenticated_select"
  on public.os_ticket_audits for select to authenticated using (true);

drop policy if exists "os_ticket_audits_authenticated_write" on public.os_ticket_audits;
create policy "os_ticket_audits_authenticated_write"
  on public.os_ticket_audits for all to authenticated
  using (true) with check (true);

grant select, insert, update, delete on public.os_ticket_audits to authenticated;

-- ---------------------------------------------------------------------------
-- Document audit events
-- ---------------------------------------------------------------------------
create table if not exists public.os_doc_audits (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  doc_id text not null,
  action text not null,
  actor text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists os_doc_audits_doc_id_idx on public.os_doc_audits (doc_id);
create index if not exists os_doc_audits_created_at_idx on public.os_doc_audits (created_at desc);

alter table public.os_doc_audits enable row level security;

drop policy if exists "os_doc_audits_authenticated_select" on public.os_doc_audits;
create policy "os_doc_audits_authenticated_select"
  on public.os_doc_audits for select to authenticated using (true);

drop policy if exists "os_doc_audits_authenticated_write" on public.os_doc_audits;
create policy "os_doc_audits_authenticated_write"
  on public.os_doc_audits for all to authenticated
  using (true) with check (true);

grant select, insert, update, delete on public.os_doc_audits to authenticated;

-- Refresh soak counts view (includes new tables)
create or replace view public.os_normalization_counts as
select 'entities'::text as domain, count(*)::bigint as row_count from public.entities
union all
select 'portfolio_companies', count(*) from public.portfolio_companies
union all
select 'entity_month_pnl', count(*) from public.entity_month_pnl
union all
select 'entity_month_kpi', count(*) from public.entity_month_kpi
union all
select 'entity_month_kpi_flex', count(*) from public.entity_month_kpi_flex
union all
select 'os_leads', count(*) from public.os_leads
union all
select 'os_lead_tasks', count(*) from public.os_lead_tasks
union all
select 'os_tickets', count(*) from public.os_tickets
union all
select 'os_deals', count(*) from public.os_deals
union all
select 'os_deal_tasks', count(*) from public.os_deal_tasks
union all
select 'os_documents', count(*) from public.os_documents
union all
select 'os_ic_reviews', count(*) from public.os_ic_reviews
union all
select 'os_ma_targets', count(*) from public.os_ma_targets
union all
select 'os_ma_tasks', count(*) from public.os_ma_tasks
union all
select 'os_re_deals', count(*) from public.os_re_deals
union all
select 'os_re_tasks', count(*) from public.os_re_tasks
union all
select 'os_handoffs', count(*) from public.os_handoffs
union all
select 'os_ic_audits', count(*) from public.os_ic_audits
union all
select 'os_ticket_audits', count(*) from public.os_ticket_audits
union all
select 'os_doc_audits', count(*) from public.os_doc_audits
union all
select 'os_store_snapshots', count(*) from public.os_store_snapshots;

grant select on public.os_normalization_counts to authenticated;
