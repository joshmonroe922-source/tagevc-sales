-- Phase 71: Live Look, Visionary audit log, notification inbox enhancements.
-- Additive. Safe to re-run. Does not touch os_store_snapshots.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Live Look sessions (observation only — audited start/stop)
-- ---------------------------------------------------------------------------
create table if not exists public.os_live_look_sessions (
  session_id uuid primary key default gen_random_uuid(),
  viewer_profile_id uuid not null,
  viewer_email text,
  target_profile_id uuid not null,
  target_email text,
  target_name text,
  target_entity_id text
    check (target_entity_id is null or target_entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text
    check (end_reason is null or end_reason in ('exit', 'sign_out', 'expire', 'replaced')),
  detail jsonb not null default '{}'::jsonb,
  constraint os_live_look_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

create index if not exists os_live_look_viewer_started_idx
  on public.os_live_look_sessions (viewer_profile_id, started_at desc);
create index if not exists os_live_look_target_started_idx
  on public.os_live_look_sessions (target_profile_id, started_at desc);

alter table public.os_live_look_sessions enable row level security;

drop policy if exists os_live_look_sessions_select on public.os_live_look_sessions;
create policy os_live_look_sessions_select
  on public.os_live_look_sessions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'visionary' and p.active = true
    )
  );

-- ---------------------------------------------------------------------------
-- Global append-only audit log (Visionary-only visibility)
-- ---------------------------------------------------------------------------
create table if not exists public.os_audit_events (
  audit_id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  actor_profile_id uuid,
  actor_email text,
  actor_name text,
  actor_role text,
  real_role text,
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  action text not null
    check (action ~ '^[a-z][a-z0-9_.-]{1,64}$'),
  object_type text
    check (object_type is null or object_type ~ '^[A-Za-z0-9._-]{1,64}$'),
  object_id text
    check (object_id is null or char_length(object_id) <= 128),
  title text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_audit_metadata_check
    check (
      jsonb_typeof(metadata)='object'
      and pg_column_size(metadata)<=8192
    )
);

create index if not exists os_audit_events_created_idx
  on public.os_audit_events (created_at desc);
create index if not exists os_audit_events_actor_idx
  on public.os_audit_events (actor_profile_id, created_at desc);
create index if not exists os_audit_events_entity_idx
  on public.os_audit_events (entity_id, created_at desc);
create index if not exists os_audit_events_action_idx
  on public.os_audit_events (action, created_at desc);

create or replace function public.reject_os_audit_events_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'os_audit_events is append-only';
end;
$$;

drop trigger if exists trg_os_audit_events_no_update on public.os_audit_events;
create trigger trg_os_audit_events_no_update
  before update or delete or truncate on public.os_audit_events
  for each statement execute function public.reject_os_audit_events_mutation();

alter table public.os_audit_events enable row level security;

drop policy if exists os_audit_events_select on public.os_audit_events;
create policy os_audit_events_select
  on public.os_audit_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'visionary' and p.active = true
    )
  );

-- Inserts via service role / authenticated with visionary (app uses persist client).
-- No update/delete grants.

revoke all on public.os_live_look_sessions from public, anon;
revoke all on public.os_audit_events from public, anon;
grant select on public.os_live_look_sessions to authenticated;
grant select on public.os_audit_events to authenticated;

-- ---------------------------------------------------------------------------
-- Notification inbox: completed_at (removes from default active list)
-- ---------------------------------------------------------------------------
alter table public.app_notifications
  add column if not exists completed_at timestamptz;

create index if not exists app_notifications_user_active_idx
  on public.app_notifications (user_id, created_at desc)
  where completed_at is null;

-- Desktop alert prefs (per user)
create table if not exists public.os_notification_desktop_prefs (
  profile_id uuid primary key,
  desktop_enabled boolean not null default false,
  sound_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.os_notification_desktop_prefs enable row level security;

drop policy if exists os_notification_desktop_prefs_select on public.os_notification_desktop_prefs;
create policy os_notification_desktop_prefs_select
  on public.os_notification_desktop_prefs
  for select
  to authenticated
  using (profile_id = auth.uid());

drop policy if exists os_notification_desktop_prefs_upsert on public.os_notification_desktop_prefs;
create policy os_notification_desktop_prefs_upsert
  on public.os_notification_desktop_prefs
  for all
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

grant select, insert, update on public.os_notification_desktop_prefs to authenticated;

-- ---------------------------------------------------------------------------
-- HRIS: Visionary mailbox FullAccess step on r619-onboarding-v1
-- ---------------------------------------------------------------------------
insert into public.os_hris_process_template_steps (
  template_id, step_key, title, category, sort_order, owner_role,
  timing_anchor, offset_days, evidence_required, automation, destructive,
  optional_for_audience, system_hook
)
select
  t.id,
  'bs.visionary_mailbox_access',
  'Grant Visionary (Josh) Read and manage mailbox permissions',
  'Before Start Date',
  165,
  'IT',
  'start_date',
  -4,
  true,
  'assist',
  false,
  false,
  'it_provision'
from public.os_hris_process_templates t
where t.slug = 'r619-onboarding-v1'
  and not exists (
    select 1 from public.os_hris_process_template_steps s
    where s.template_id = t.id and s.step_key = 'bs.visionary_mailbox_access'
  );
