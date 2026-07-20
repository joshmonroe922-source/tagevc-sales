-- Phase 9: Normalized Leads + Tickets (dual-write alongside os_store_snapshots)
-- Apply in Supabase SQL editor for tagevc-os after phase7_production.sql

-- VC Pipeline leads (LD-###)
create table if not exists public.os_leads (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null unique,
  company_name text not null,
  website text,
  sector text,
  source text,
  source_detail text,
  stage text not null,
  priority text not null default 'P2',
  owner text,
  next_action text,
  next_action_date date,
  thesis_fit text,
  score numeric,
  raise_stage text,
  check_size_k numeric,
  location text,
  path text,
  notes text,
  outcome text,
  deal_id text,
  related_entity_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists os_leads_stage_idx on public.os_leads (stage);
create index if not exists os_leads_updated_at_idx on public.os_leads (updated_at desc);
create index if not exists os_leads_related_entity_idx on public.os_leads (related_entity_id);

alter table public.os_leads enable row level security;

drop policy if exists "os_leads_authenticated_select" on public.os_leads;
create policy "os_leads_authenticated_select"
  on public.os_leads for select to authenticated using (true);

drop policy if exists "os_leads_authenticated_write" on public.os_leads;
create policy "os_leads_authenticated_write"
  on public.os_leads for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.os_leads to authenticated;

-- Lead tasks (LT-###)
create table if not exists public.os_lead_tasks (
  id uuid primary key default gen_random_uuid(),
  task_id text not null unique,
  lead_id text not null references public.os_leads (lead_id) on delete cascade,
  company_name text not null,
  process_stage text not null,
  title text not null,
  priority text not null default 'P2',
  status text not null default 'Open',
  owner text,
  due_date date,
  notes text,
  lib_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists os_lead_tasks_lead_id_idx on public.os_lead_tasks (lead_id);
create index if not exists os_lead_tasks_status_idx on public.os_lead_tasks (status);

alter table public.os_lead_tasks enable row level security;

drop policy if exists "os_lead_tasks_authenticated_select" on public.os_lead_tasks;
create policy "os_lead_tasks_authenticated_select"
  on public.os_lead_tasks for select to authenticated using (true);

drop policy if exists "os_lead_tasks_authenticated_write" on public.os_lead_tasks;
create policy "os_lead_tasks_authenticated_write"
  on public.os_lead_tasks for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.os_lead_tasks to authenticated;

-- Shared Services tickets (TK-###)
create table if not exists public.os_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_id text not null unique,
  title text not null,
  description text,
  desired_outcome text,
  service text not null,
  priority text not null,
  status text not null,
  requester_name text,
  assignee_name text,
  entity_id text,
  company_name text,
  links text,
  sla_due_at timestamptz,
  autonomy_band text not null,
  confidence int not null default 0,
  diagnose_reasoning text not null default '',
  proposed_action text,
  forbid_hits jsonb not null default '[]'::jsonb,
  on_allow_list boolean not null default false,
  draft_approval text not null default 'n/a',
  recommendation text,
  policy_version text not null default 'v1',
  ai_generated boolean not null default false,
  source_doc_id text,
  ai_suggestion_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists os_tickets_status_idx on public.os_tickets (status);
create index if not exists os_tickets_band_idx on public.os_tickets (autonomy_band);
create index if not exists os_tickets_updated_at_idx on public.os_tickets (updated_at desc);
create index if not exists os_tickets_entity_idx on public.os_tickets (entity_id);

alter table public.os_tickets enable row level security;

drop policy if exists "os_tickets_authenticated_select" on public.os_tickets;
create policy "os_tickets_authenticated_select"
  on public.os_tickets for select to authenticated using (true);

drop policy if exists "os_tickets_authenticated_write" on public.os_tickets;
create policy "os_tickets_authenticated_write"
  on public.os_tickets for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.os_tickets to authenticated;

-- Optional: extend activity_events with impersonation context (safe if columns exist)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'activity_events'
      and column_name = 'impersonating_as'
  ) then
    alter table public.activity_events
      add column impersonating_as text,
      add column real_role text;
  end if;
end $$;
