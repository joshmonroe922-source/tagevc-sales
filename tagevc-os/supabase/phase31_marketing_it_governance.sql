-- Phase 31: Marketing ROI, IT lifecycle audit, snapshot retirement evidence.
-- Safe to re-run. Does NOT rename or drop os_store_snapshots.

alter table public.os_marketing_campaigns
  add column if not exists attributed_revenue_k numeric;

create index if not exists os_mkt_campaigns_external_idx
  on public.os_marketing_campaigns (ad_platform, external_campaign_id)
  where external_campaign_id is not null;

create table if not exists public.os_it_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  run_id text,
  item_id text not null,
  target_id text,
  entity_id text references public.entities(entity_id),
  actor_id uuid,
  status text not null,
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists os_it_lifecycle_run_idx
  on public.os_it_lifecycle_events (run_id, occurred_at desc);
create index if not exists os_it_lifecycle_entity_idx
  on public.os_it_lifecycle_events (entity_id, occurred_at desc);

create table if not exists public.os_snapshot_retirement_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  stage text not null,
  retired_table_name text,
  approved_by text not null,
  detail text,
  occurred_at timestamptz not null default now(),
  constraint os_snapshot_retirement_stage_check
    check (stage in ('rename_approved', 'renamed', 'rename_verified', 'rollback', 'drop_approved')),
  constraint os_snapshot_retired_name_check
    check (
      retired_table_name is null
      or retired_table_name ~ '^os_store_snapshots_retired_[0-9]{8}$'
    )
);

alter table public.os_it_lifecycle_events enable row level security;
alter table public.os_snapshot_retirement_events enable row level security;

drop policy if exists "os_it_lifecycle_select" on public.os_it_lifecycle_events;
drop policy if exists "os_it_lifecycle_write" on public.os_it_lifecycle_events;
create policy "os_it_lifecycle_select"
  on public.os_it_lifecycle_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
create policy "os_it_lifecycle_write"
  on public.os_it_lifecycle_events for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (public.is_firm_wide_access() or public.can_access_entity(entity_id));

drop policy if exists "os_snapshot_retirement_select"
  on public.os_snapshot_retirement_events;
drop policy if exists "os_snapshot_retirement_write"
  on public.os_snapshot_retirement_events;
create policy "os_snapshot_retirement_select"
  on public.os_snapshot_retirement_events for select to authenticated
  using (public.is_firm_wide_access());
create policy "os_snapshot_retirement_write"
  on public.os_snapshot_retirement_events for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

grant select, insert on public.os_it_lifecycle_events to authenticated;
grant select, insert on public.os_snapshot_retirement_events to authenticated;
