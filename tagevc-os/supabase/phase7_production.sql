-- Phase 7: Production persistence + activity
-- Apply in Supabase SQL editor for tagevc-os

-- Firm-wide store snapshots (JSONB) so in-app modules survive redeploys
create table if not exists public.os_store_snapshots (
  collection text primary key,
  payload jsonb not null,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

alter table public.os_store_snapshots enable row level security;

drop policy if exists "os_snapshots_authenticated_select" on public.os_store_snapshots;
create policy "os_snapshots_authenticated_select"
  on public.os_store_snapshots for select
  to authenticated
  using (true);

drop policy if exists "os_snapshots_authenticated_write" on public.os_store_snapshots;
create policy "os_snapshots_authenticated_write"
  on public.os_store_snapshots for all
  to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.os_store_snapshots to authenticated;

-- Cross-module activity feed
create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  module text not null,
  action text not null,
  title text not null,
  detail text,
  entity_id text,
  ref_type text,
  ref_id text,
  actor_email text,
  actor_name text,
  created_at timestamptz not null default now()
);

create index if not exists activity_events_created_at_idx
  on public.activity_events (created_at desc);

alter table public.activity_events enable row level security;

drop policy if exists "activity_authenticated_select" on public.activity_events;
create policy "activity_authenticated_select"
  on public.activity_events for select
  to authenticated
  using (true);

drop policy if exists "activity_authenticated_insert" on public.activity_events;
create policy "activity_authenticated_insert"
  on public.activity_events for insert
  to authenticated
  with check (true);

grant select, insert on public.activity_events to authenticated;

-- Lightweight in-app notifications
create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  notification_id text not null unique,
  user_id uuid references auth.users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists app_notifications_user_created_idx
  on public.app_notifications (user_id, created_at desc);

alter table public.app_notifications enable row level security;

drop policy if exists "notifications_own_select" on public.app_notifications;
create policy "notifications_own_select"
  on public.app_notifications for select
  to authenticated
  using (user_id = auth.uid() or user_id is null);

drop policy if exists "notifications_own_update" on public.app_notifications;
create policy "notifications_own_update"
  on public.app_notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "notifications_insert_authenticated" on public.app_notifications;
create policy "notifications_insert_authenticated"
  on public.app_notifications for insert
  to authenticated
  with check (true);

grant select, insert, update on public.app_notifications to authenticated;
