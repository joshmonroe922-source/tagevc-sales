-- Phase 79: AI C-Suite (Visionary executive intelligence)
-- Additive. Visionary-only RLS. Does NOT touch os_store_snapshots.
-- Human gates remain on money / legal send / secrets — draft actions only.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Reuse is_visionary_role() from phase73/74 when present; create if missing.
create or replace function public.is_visionary_role()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.role = 'visionary'
  );
$$;

grant execute on function public.is_visionary_role() to authenticated;

-- ---------------------------------------------------------------------------
-- Briefings
-- ---------------------------------------------------------------------------
create table if not exists public.os_csuite_briefings (
  id uuid primary key default gen_random_uuid(),
  role text not null
    check (role in ('cfo', 'cto', 'cmo', 'chro', 'clo', 'hq')),
  period_type text not null default 'on_demand'
    check (period_type in ('on_demand', 'daily', 'weekly')),
  as_of timestamptz not null default now(),
  scope text not null default 'consolidated',
  health_status text not null default 'watch'
    check (health_status in ('green', 'watch', 'red')),
  what_matters jsonb not null default '[]'::jsonb
    check (jsonb_typeof(what_matters) = 'array'),
  top_risk text not null default '',
  primary_action text not null default '',
  body_md text not null default '',
  body_json jsonb not null default '{}'::jsonb
    check (jsonb_typeof(body_json) = 'object'),
  context_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(context_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

create index if not exists os_csuite_briefings_role_as_of_idx
  on public.os_csuite_briefings (role, as_of desc);

-- ---------------------------------------------------------------------------
-- Threads + messages
-- ---------------------------------------------------------------------------
create table if not exists public.os_csuite_threads (
  id uuid primary key default gen_random_uuid(),
  role text not null
    check (role in ('cfo', 'cto', 'cmo', 'chro', 'clo', 'hq')),
  visionary_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'C-Suite thread',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (role, visionary_id)
);

create index if not exists os_csuite_threads_visionary_idx
  on public.os_csuite_threads (visionary_id, updated_at desc);

create table if not exists public.os_csuite_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null
    references public.os_csuite_threads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  model text,
  context_meta jsonb not null default '{}'::jsonb
    check (jsonb_typeof(context_meta) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists os_csuite_messages_thread_idx
  on public.os_csuite_messages (thread_id, created_at asc);

-- ---------------------------------------------------------------------------
-- Draft-only actions (human confirm)
-- ---------------------------------------------------------------------------
create table if not exists public.os_csuite_actions (
  id uuid primary key default gen_random_uuid(),
  role text not null
    check (role in ('cfo', 'cto', 'cmo', 'chro', 'clo', 'hq')),
  action_type text not null
    check (action_type in ('ticket', 'checklist_note', 'task')),
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'rejected', 'executed')),
  title text not null default '',
  body text not null default '',
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  briefing_id uuid references public.os_csuite_briefings(id) on delete set null,
  thread_id uuid references public.os_csuite_threads(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists os_csuite_actions_status_idx
  on public.os_csuite_actions (status, role, created_at desc);

-- ---------------------------------------------------------------------------
-- Weekly reports archive (Visionary-only storage path)
-- ---------------------------------------------------------------------------
create table if not exists public.os_csuite_reports (
  id uuid primary key default gen_random_uuid(),
  role text not null
    check (role in ('cfo', 'cto', 'cmo', 'chro', 'clo', 'hq')),
  week_key text not null,
  visionary_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null default '',
  body_md text not null default '',
  health_status text
    check (health_status is null or health_status in ('green', 'watch', 'red')),
  created_at timestamptz not null default now(),
  unique (role, week_key, visionary_id)
);

create index if not exists os_csuite_reports_visionary_idx
  on public.os_csuite_reports (visionary_id, week_key desc);

-- ---------------------------------------------------------------------------
-- RLS — Visionary only
-- ---------------------------------------------------------------------------
alter table public.os_csuite_briefings enable row level security;
alter table public.os_csuite_threads enable row level security;
alter table public.os_csuite_messages enable row level security;
alter table public.os_csuite_actions enable row level security;
alter table public.os_csuite_reports enable row level security;

drop policy if exists os_csuite_briefings_visionary on public.os_csuite_briefings;
create policy os_csuite_briefings_visionary on public.os_csuite_briefings
  for all to authenticated
  using (public.is_visionary_role())
  with check (public.is_visionary_role());

drop policy if exists os_csuite_threads_visionary on public.os_csuite_threads;
create policy os_csuite_threads_visionary on public.os_csuite_threads
  for all to authenticated
  using (public.is_visionary_role() and visionary_id = auth.uid())
  with check (public.is_visionary_role() and visionary_id = auth.uid());

drop policy if exists os_csuite_messages_visionary on public.os_csuite_messages;
create policy os_csuite_messages_visionary on public.os_csuite_messages
  for all to authenticated
  using (
    public.is_visionary_role()
    and exists (
      select 1 from public.os_csuite_threads t
      where t.id = thread_id and t.visionary_id = auth.uid()
    )
  )
  with check (
    public.is_visionary_role()
    and exists (
      select 1 from public.os_csuite_threads t
      where t.id = thread_id and t.visionary_id = auth.uid()
    )
  );

drop policy if exists os_csuite_actions_visionary on public.os_csuite_actions;
create policy os_csuite_actions_visionary on public.os_csuite_actions
  for all to authenticated
  using (public.is_visionary_role())
  with check (public.is_visionary_role());

drop policy if exists os_csuite_reports_visionary on public.os_csuite_reports;
create policy os_csuite_reports_visionary on public.os_csuite_reports
  for all to authenticated
  using (public.is_visionary_role() and visionary_id = auth.uid())
  with check (public.is_visionary_role() and visionary_id = auth.uid());

grant select, insert, update, delete on public.os_csuite_briefings to authenticated;
grant select, insert, update, delete on public.os_csuite_threads to authenticated;
grant select, insert, update, delete on public.os_csuite_messages to authenticated;
grant select, insert, update, delete on public.os_csuite_actions to authenticated;
grant select, insert, update, delete on public.os_csuite_reports to authenticated;

grant select, insert, update, delete on public.os_csuite_briefings to service_role;
grant select, insert, update, delete on public.os_csuite_threads to service_role;
grant select, insert, update, delete on public.os_csuite_messages to service_role;
grant select, insert, update, delete on public.os_csuite_actions to service_role;
grant select, insert, update, delete on public.os_csuite_reports to service_role;

-- Private storage folder for weekly reports (Visionary-only).
-- Path convention: csuite-private/{visionary_id}/weekly/{role}/{week}.md.pdf
insert into storage.buckets (id, name, public)
values ('csuite-private', 'csuite-private', false)
on conflict (id) do nothing;

drop policy if exists csuite_private_select on storage.objects;
create policy csuite_private_select on storage.objects
  for select to authenticated
  using (bucket_id = 'csuite-private' and public.is_visionary_role());

drop policy if exists csuite_private_insert on storage.objects;
create policy csuite_private_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'csuite-private' and public.is_visionary_role());
