-- Phase 10: Internal Messaging Foundation
-- Apply in Supabase SQL editor for tagevc-os (project opdqybaatfbwkokbzwli)
-- after phase9_normalized.sql
--
-- Architecture notes (see docs/OS_PHASE10.md):
-- - Conversations are dm | group (channel reserved for later)
-- - entity_id scopes chats to a subsidiary later
-- - linked_ref_type / linked_ref_id attach chats to leads/deals/entities/tasks later
-- - parent_id on messages reserves threading without enabling it in UI yet

-- Directory visibility so any authenticated user can pick DM recipients
drop policy if exists "profiles_select_active_directory" on public.profiles;
create policy "profiles_select_active_directory"
  on public.profiles for select
  to authenticated
  using (active = true);

-- Conversations ------------------------------------------------------------
create table if not exists public.os_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dm', 'group', 'channel')),
  title text,
  -- Stable key for 1:1 DMs: sorted "userA:userB" — unique when kind = dm
  dm_key text,
  -- Future: subsidiary / Entity OS scope (null = firm-wide)
  entity_id text,
  -- Future: attach conversation to a domain object
  linked_ref_type text,
  linked_ref_id text,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  last_message_preview text,
  archived_at timestamptz
);

create unique index if not exists os_conversations_dm_key_uidx
  on public.os_conversations (dm_key)
  where dm_key is not null;

create index if not exists os_conversations_last_message_idx
  on public.os_conversations (last_message_at desc nulls last);

create index if not exists os_conversations_entity_idx
  on public.os_conversations (entity_id)
  where entity_id is not null;

create index if not exists os_conversations_linked_ref_idx
  on public.os_conversations (linked_ref_type, linked_ref_id)
  where linked_ref_type is not null;

alter table public.os_conversations enable row level security;

-- Members ------------------------------------------------------------------
create table if not exists public.os_conversation_members (
  conversation_id uuid not null references public.os_conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  member_role text not null default 'member' check (member_role in ('owner', 'member')),
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (conversation_id, user_id)
);

create index if not exists os_conversation_members_user_idx
  on public.os_conversation_members (user_id)
  where left_at is null;

alter table public.os_conversation_members enable row level security;

-- Messages -----------------------------------------------------------------
create table if not exists public.os_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.os_conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete restrict,
  body text not null check (char_length(body) > 0 and char_length(body) <= 8000),
  -- Future threading
  parent_id uuid references public.os_messages (id) on delete set null,
  -- Future: entity mention / deep link payload
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index if not exists os_messages_conversation_created_idx
  on public.os_messages (conversation_id, created_at);

create index if not exists os_messages_parent_idx
  on public.os_messages (parent_id)
  where parent_id is not null;

alter table public.os_messages enable row level security;

-- Helpers ------------------------------------------------------------------
create or replace function public.is_conversation_member(cid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.os_conversation_members m
    where m.conversation_id = cid
      and m.user_id = auth.uid()
      and m.left_at is null
  );
$$;

create or replace function public.dm_pair_key(a uuid, b uuid)
returns text
language sql
immutable
as $$
  select case
    when a::text < b::text then a::text || ':' || b::text
    else b::text || ':' || a::text
  end;
$$;

-- Keep conversation preview in sync on insert
create or replace function public.os_messages_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.os_conversations
  set
    last_message_at = new.created_at,
    last_message_preview = left(new.body, 160),
    updated_at = now()
  where id = new.conversation_id;

  update public.os_conversation_members
  set last_read_at = new.created_at
  where conversation_id = new.conversation_id
    and user_id = new.sender_id
    and left_at is null;

  return new;
end;
$$;

drop trigger if exists os_messages_after_insert on public.os_messages;
create trigger os_messages_after_insert
  after insert on public.os_messages
  for each row execute function public.os_messages_after_insert();

-- RPC: create or return existing DM
create or replace function public.create_or_get_dm(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  key text;
  cid uuid;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;
  if other_user_id is null or other_user_id = me then
    raise exception 'Invalid recipient';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = other_user_id and p.active = true
  ) then
    raise exception 'Recipient not found';
  end if;

  key := public.dm_pair_key(me, other_user_id);

  select id into cid
  from public.os_conversations
  where dm_key = key and kind = 'dm'
  limit 1;

  if cid is not null then
    -- Re-activate membership if previously left
    update public.os_conversation_members
    set left_at = null, joined_at = coalesce(joined_at, now())
    where conversation_id = cid
      and user_id in (me, other_user_id)
      and left_at is not null;
    return cid;
  end if;

  insert into public.os_conversations (kind, dm_key, created_by)
  values ('dm', key, me)
  returning id into cid;

  insert into public.os_conversation_members (conversation_id, user_id, member_role)
  values
    (cid, me, 'owner'),
    (cid, other_user_id, 'member');

  return cid;
end;
$$;

-- RPC: create small group (2–12 members excluding creator is ok; total <= 13)
create or replace function public.create_group_chat(p_title text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cid uuid;
  cleaned uuid[];
  uid uuid;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;
  if p_title is null or length(trim(p_title)) < 1 then
    raise exception 'Title required';
  end if;

  select array_agg(distinct x)
  into cleaned
  from unnest(coalesce(p_member_ids, '{}'::uuid[])) as x
  where x is not null and x <> me;

  if cleaned is null or cardinality(cleaned) < 1 then
    raise exception 'Add at least one other member';
  end if;
  if cardinality(cleaned) > 11 then
    raise exception 'Group chats are limited to 12 people including you';
  end if;

  if exists (
    select 1
    from unnest(cleaned) as mid
    where not exists (
      select 1 from public.profiles p
      where p.id = mid and p.active = true
    )
  ) then
    raise exception 'One or more members are inactive or missing';
  end if;

  insert into public.os_conversations (kind, title, created_by)
  values ('group', trim(p_title), me)
  returning id into cid;

  insert into public.os_conversation_members (conversation_id, user_id, member_role)
  values (cid, me, 'owner');

  foreach uid in array cleaned loop
    insert into public.os_conversation_members (conversation_id, user_id, member_role)
    values (cid, uid, 'member');
  end loop;

  return cid;
end;
$$;

create or replace function public.mark_conversation_read(cid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_conversation_member(cid) then
    raise exception 'Forbidden';
  end if;

  update public.os_conversation_members
  set last_read_at = now()
  where conversation_id = cid
    and user_id = auth.uid()
    and left_at is null;
end;
$$;

grant execute on function public.create_or_get_dm(uuid) to authenticated;
grant execute on function public.create_group_chat(text, uuid[]) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.is_conversation_member(uuid) to authenticated;
grant execute on function public.dm_pair_key(uuid, uuid) to authenticated;

-- RLS policies -------------------------------------------------------------
drop policy if exists "os_conversations_select_member" on public.os_conversations;
create policy "os_conversations_select_member"
  on public.os_conversations for select
  to authenticated
  using (public.is_conversation_member(id));

-- Inserts go through security definer RPCs; block direct inserts
drop policy if exists "os_conversations_no_direct_insert" on public.os_conversations;
create policy "os_conversations_no_direct_insert"
  on public.os_conversations for insert
  to authenticated
  with check (false);

drop policy if exists "os_conversations_update_member" on public.os_conversations;
create policy "os_conversations_update_member"
  on public.os_conversations for update
  to authenticated
  using (public.is_conversation_member(id))
  with check (public.is_conversation_member(id));

drop policy if exists "os_members_select_peer" on public.os_conversation_members;
create policy "os_members_select_peer"
  on public.os_conversation_members for select
  to authenticated
  using (public.is_conversation_member(conversation_id));

drop policy if exists "os_members_no_direct_insert" on public.os_conversation_members;
create policy "os_members_no_direct_insert"
  on public.os_conversation_members for insert
  to authenticated
  with check (false);

drop policy if exists "os_members_update_own" on public.os_conversation_members;
create policy "os_members_update_own"
  on public.os_conversation_members for update
  to authenticated
  using (user_id = auth.uid() and public.is_conversation_member(conversation_id))
  with check (user_id = auth.uid());

drop policy if exists "os_messages_select_member" on public.os_messages;
create policy "os_messages_select_member"
  on public.os_messages for select
  to authenticated
  using (public.is_conversation_member(conversation_id));

drop policy if exists "os_messages_insert_member" on public.os_messages;
create policy "os_messages_insert_member"
  on public.os_messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id)
    and deleted_at is null
  );

drop policy if exists "os_messages_update_own" on public.os_messages;
create policy "os_messages_update_own"
  on public.os_messages for update
  to authenticated
  using (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id)
  )
  with check (sender_id = auth.uid());

grant select, update on public.os_conversations to authenticated;
grant select, update on public.os_conversation_members to authenticated;
grant select, insert, update on public.os_messages to authenticated;

-- Realtime -----------------------------------------------------------------
-- Idempotent-ish: ignore if already added
do $$
begin
  begin
    alter publication supabase_realtime add table public.os_messages;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.os_conversations;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.os_conversation_members;
  exception when duplicate_object then null;
  end;
end $$;

-- Smoke helpers (optional)
-- select public.create_or_get_dm('<other-uuid>');
-- select public.create_group_chat('Deal desk', array['<uuid>']::uuid[]);
