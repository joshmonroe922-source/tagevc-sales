-- Tage VC OS Phase 55 — Recruit inbound Shared Services + rollup ingest (additive)

create table if not exists public.os_recruit_inbound_tickets (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null default 'ENT-R619',
  recruit_ticket_id text not null,
  tage_ticket_id text,
  kind text not null,
  subject text not null,
  resource_type text,
  resource_id text,
  portal_url text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received',
  created_at timestamptz not null default now(),
  unique (entity_id, recruit_ticket_id)
);

create table if not exists public.os_recruit_feed_metrics (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null default 'ENT-R619',
  as_of timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  source text not null default 'recruit_portal',
  created_at timestamptz not null default now()
);

create index if not exists os_recruit_feed_metrics_as_of_idx
  on public.os_recruit_feed_metrics (entity_id, as_of desc);

alter table public.os_recruit_inbound_tickets enable row level security;
alter table public.os_recruit_feed_metrics enable row level security;

drop policy if exists "os_recruit_inbound_tickets_firm" on public.os_recruit_inbound_tickets;
create policy "os_recruit_inbound_tickets_firm" on public.os_recruit_inbound_tickets for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (entity_id = 'ENT-R619');

drop policy if exists "os_recruit_feed_metrics_firm" on public.os_recruit_feed_metrics;
create policy "os_recruit_feed_metrics_firm" on public.os_recruit_feed_metrics for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (entity_id = 'ENT-R619');

grant select, insert, update, delete on public.os_recruit_inbound_tickets to authenticated;
grant select, insert, update, delete on public.os_recruit_feed_metrics to authenticated;
grant select, insert, update, delete on public.os_recruit_inbound_tickets to service_role;
grant select, insert, update, delete on public.os_recruit_feed_metrics to service_role;
