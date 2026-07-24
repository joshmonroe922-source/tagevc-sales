-- Phase 64: User availability (Available / DND), soft message alerts, mailbox TZ.
-- Apply on shared UDL after messaging foundation (phase10+).
-- Money/dual-approve untouched. Fail-soft if Graph calendar not configured.

create table if not exists public.os_user_availability (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  status text not null default 'available'
    check (status in ('available', 'dnd')),
  source text not null default 'manual'
    check (source in ('manual', 'calendar')),
  calendar_busy_until timestamptz,
  microsoft_timezone text,
  updated_at timestamptz not null default now()
);

alter table public.os_user_availability enable row level security;

drop policy if exists "os_user_availability_select_authenticated" on public.os_user_availability;
create policy "os_user_availability_select_authenticated"
  on public.os_user_availability for select
  to authenticated
  using (true);

drop policy if exists "os_user_availability_upsert_own" on public.os_user_availability;
create policy "os_user_availability_upsert_own"
  on public.os_user_availability for all
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create table if not exists public.os_message_soft_alerts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid not null references public.os_conversations (id) on delete cascade,
  message_id uuid references public.os_messages (id) on delete set null,
  kind text not null check (kind in ('new_message', 'urgent_dnd', 'queued_release')),
  title text not null,
  body text,
  priority text not null default 'normal' check (priority in ('normal', 'urgent')),
  deferred boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists os_message_soft_alerts_profile_unread_idx
  on public.os_message_soft_alerts (profile_id, created_at desc)
  where read_at is null;

alter table public.os_message_soft_alerts enable row level security;

drop policy if exists "os_message_soft_alerts_own" on public.os_message_soft_alerts;
create policy "os_message_soft_alerts_own"
  on public.os_message_soft_alerts for all
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

comment on table public.os_user_availability is
  'Phase 64: Available vs Do Not Disturb. Calendar may soft-set DND when Graph busy/focus.';
comment on table public.os_message_soft_alerts is
  'Phase 64: Non-spammy message alerts. deferred=true while DND (except urgent soft alerts).';
