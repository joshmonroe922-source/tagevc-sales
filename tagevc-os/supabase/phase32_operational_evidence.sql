-- Phase 32: durable soak observations and operational evidence.
-- Safe to re-run. Does not rename or drop os_store_snapshots.

create table if not exists public.os_snapshot_soak_observations (
  id uuid primary key default gen_random_uuid(),
  healthy boolean not null,
  issues jsonb not null default '[]'::jsonb,
  stage text not null,
  sync_failure_count integer not null default 0,
  fk_orphan_total integer not null default 0,
  stage4_ready boolean not null default false,
  drill_summary text,
  source text not null,
  retired_table_name text,
  observed_at timestamptz not null default now(),
  constraint os_snapshot_soak_source_check
    check (source in ('cron', 'admin', 'manual')),
  constraint os_snapshot_soak_retired_name_check
    check (
      retired_table_name is null
      or retired_table_name ~ '^os_store_snapshots_retired_[0-9]{8}$'
    )
);

create index if not exists os_snapshot_soak_observed_idx
  on public.os_snapshot_soak_observations (observed_at desc);
create index if not exists os_snapshot_soak_retired_idx
  on public.os_snapshot_soak_observations
  (retired_table_name, observed_at desc);

alter table public.os_snapshot_soak_observations enable row level security;

drop policy if exists "os_snapshot_soak_select"
  on public.os_snapshot_soak_observations;
drop policy if exists "os_snapshot_soak_write"
  on public.os_snapshot_soak_observations;
create policy "os_snapshot_soak_select"
  on public.os_snapshot_soak_observations for select to authenticated
  using (public.is_firm_wide_access());
create policy "os_snapshot_soak_write"
  on public.os_snapshot_soak_observations for insert to authenticated
  with check (public.is_firm_wide_access());

grant select, insert on public.os_snapshot_soak_observations to authenticated;
