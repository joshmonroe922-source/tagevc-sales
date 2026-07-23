-- Think Tank (Grok advisor) — shared across Tage / Recruit 619 / Instant NDA portals
-- One personal conversation per (portal_key, profile_id) on Tage UDL.

create table if not exists public.os_think_tank_conversations (
  id uuid primary key default gen_random_uuid(),
  portal_key text not null
    check (portal_key in ('tage', 'r619', 'inda')),
  entity_id text,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'Think Tank',
  role_hint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (portal_key, profile_id)
);

create index if not exists os_think_tank_conversations_profile_idx
  on public.os_think_tank_conversations (profile_id, updated_at desc);

create table if not exists public.os_think_tank_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.os_think_tank_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  model text,
  context_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists os_think_tank_messages_conv_idx
  on public.os_think_tank_messages (conversation_id, created_at asc);

alter table public.os_think_tank_conversations enable row level security;
alter table public.os_think_tank_messages enable row level security;

drop policy if exists os_tt_conversations_own on public.os_think_tank_conversations;
create policy os_tt_conversations_own on public.os_think_tank_conversations
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

drop policy if exists os_tt_messages_own on public.os_think_tank_messages;
create policy os_tt_messages_own on public.os_think_tank_messages
  for all to authenticated
  using (
    exists (
      select 1 from public.os_think_tank_conversations c
      where c.id = conversation_id and c.profile_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.os_think_tank_conversations c
      where c.id = conversation_id and c.profile_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.os_think_tank_conversations to authenticated;
grant select, insert, update, delete on public.os_think_tank_messages to authenticated;
