-- Phase 12: Channels, mentions/reactions foundations, IC + MA normalization
-- Apply after phase11_chat_and_normalize.sql

-- ---------------------------------------------------------------------------
-- Channels
-- ---------------------------------------------------------------------------
create or replace function public.create_channel(
  p_title text,
  p_member_ids uuid[] default '{}'::uuid[],
  p_entity_id text default null,
  p_topic text default null
)
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
  topic text := nullif(trim(coalesce(p_topic, '')), '');
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;
  if p_title is null or length(trim(p_title)) < 1 then
    raise exception 'Channel name required';
  end if;

  select array_agg(distinct x)
  into cleaned
  from unnest(coalesce(p_member_ids, '{}'::uuid[])) as x
  where x is not null and x <> me;

  -- If no members specified, invite all other active profiles (firm channel)
  if cleaned is null then
    select array_agg(p.id)
    into cleaned
    from public.profiles p
    where p.active = true and p.id <> me;
  end if;

  insert into public.os_conversations (
    kind, title, created_by, entity_id, last_message_preview
  )
  values (
    'channel',
    trim(p_title),
    me,
    nullif(trim(coalesce(p_entity_id, '')), ''),
    topic
  )
  returning id into cid;

  insert into public.os_conversation_members (conversation_id, user_id, member_role)
  values (cid, me, 'owner');

  if cleaned is not null then
    foreach uid in array cleaned loop
      if exists (select 1 from public.profiles p where p.id = uid and p.active) then
        insert into public.os_conversation_members (conversation_id, user_id, member_role)
        values (cid, uid, 'member')
        on conflict do nothing;
      end if;
    end loop;
  end if;

  return cid;
end;
$$;

grant execute on function public.create_channel(text, uuid[], text, text) to authenticated;

-- Join an existing channel by id (must be kind=channel; open join for firm channels)
create or replace function public.join_channel(cid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  k text;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  select kind into k from public.os_conversations where id = cid and archived_at is null;
  if k is null then raise exception 'Channel not found'; end if;
  if k <> 'channel' then raise exception 'Not a channel'; end if;

  insert into public.os_conversation_members (conversation_id, user_id, member_role)
  values (cid, me, 'member')
  on conflict (conversation_id, user_id) do update
    set left_at = null,
        joined_at = coalesce(os_conversation_members.joined_at, now());
end;
$$;

grant execute on function public.join_channel(uuid) to authenticated;

-- List discoverable channels (for browse) — members see all; non-members see firm channels
create or replace function public.list_discoverable_channels()
returns setof public.os_conversations
language sql
security definer
set search_path = public
stable
as $$
  select c.*
  from public.os_conversations c
  where c.kind = 'channel'
    and c.archived_at is null
    and (
      public.is_conversation_member(c.id)
      or c.entity_id is null
    )
  order by c.title asc nulls last;
$$;

grant execute on function public.list_discoverable_channels() to authenticated;

-- Allow select of discoverable channels for browse (in addition to member select)
drop policy if exists "os_conversations_select_discoverable_channel" on public.os_conversations;
create policy "os_conversations_select_discoverable_channel"
  on public.os_conversations for select
  to authenticated
  using (
    kind = 'channel'
    and archived_at is null
    and entity_id is null
  );

-- ---------------------------------------------------------------------------
-- Reactions
-- ---------------------------------------------------------------------------
create table if not exists public.os_message_reactions (
  message_id uuid not null references public.os_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (char_length(emoji) >= 1 and char_length(emoji) <= 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists os_message_reactions_message_idx
  on public.os_message_reactions (message_id);

alter table public.os_message_reactions enable row level security;

drop policy if exists "os_reactions_select_member" on public.os_message_reactions;
create policy "os_reactions_select_member"
  on public.os_message_reactions for select
  to authenticated
  using (
    exists (
      select 1 from public.os_messages m
      where m.id = message_id
        and public.is_conversation_member(m.conversation_id)
    )
  );

drop policy if exists "os_reactions_insert_own" on public.os_message_reactions;
create policy "os_reactions_insert_own"
  on public.os_message_reactions for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.os_messages m
      where m.id = message_id
        and public.is_conversation_member(m.conversation_id)
    )
  );

drop policy if exists "os_reactions_delete_own" on public.os_message_reactions;
create policy "os_reactions_delete_own"
  on public.os_message_reactions for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, delete on public.os_message_reactions to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.os_message_reactions;
  exception when duplicate_object then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Global message search (across conversations the user belongs to)
-- ---------------------------------------------------------------------------
create or replace function public.search_messages_global(
  p_query text,
  p_limit int default 30
)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  parent_id uuid,
  created_at timestamptz,
  conversation_title text
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_query is null or length(trim(p_query)) < 2 then return; end if;

  return query
  select
    m.id,
    m.conversation_id,
    m.sender_id,
    m.body,
    m.parent_id,
    m.created_at,
    coalesce(c.title, 'Conversation') as conversation_title
  from public.os_messages m
  join public.os_conversations c on c.id = m.conversation_id
  where public.is_conversation_member(m.conversation_id)
    and m.deleted_at is null
    and m.body ilike '%' || trim(p_query) || '%'
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 80));
end;
$$;

grant execute on function public.search_messages_global(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Mention notifications (called from app; also enhance insert trigger)
-- ---------------------------------------------------------------------------
create or replace function public.notify_message_mentions(
  p_message_id uuid,
  p_mentioned_user_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  msg record;
  sender_label text;
  uid uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select m.* into msg from public.os_messages m where m.id = p_message_id;
  if msg is null then raise exception 'Message not found'; end if;
  if msg.sender_id <> auth.uid() then raise exception 'Forbidden'; end if;
  if not public.is_conversation_member(msg.conversation_id) then
    raise exception 'Forbidden';
  end if;

  select coalesce(nullif(trim(p.full_name), ''), p.email, 'Someone')
  into sender_label
  from public.profiles p where p.id = msg.sender_id;

  foreach uid in array coalesce(p_mentioned_user_ids, '{}'::uuid[]) loop
    if uid is null or uid = msg.sender_id then continue; end if;
    if not exists (
      select 1 from public.os_conversation_members m
      where m.conversation_id = msg.conversation_id
        and m.user_id = uid and m.left_at is null
    ) then
      continue;
    end if;

    insert into public.app_notifications (
      notification_id, user_id, kind, title, body, href
    )
    values (
      'NTF-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
      uid,
      'chat_mention',
      sender_label || ' mentioned you',
      left(msg.body, 120),
      '/messages?c=' || msg.conversation_id::text
    );
  end loop;
end;
$$;

grant execute on function public.notify_message_mentions(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Normalize: IC reviews
-- ---------------------------------------------------------------------------
create table if not exists public.os_ic_reviews (
  id uuid primary key default gen_random_uuid(),
  ic_id text not null unique,
  deal_id text not null,
  company_name text not null,
  status text not null,
  decision text,
  conditions text,
  recommendation text,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_ic_reviews_deal_idx on public.os_ic_reviews (deal_id);
create index if not exists os_ic_reviews_status_idx on public.os_ic_reviews (status);

alter table public.os_ic_reviews enable row level security;

drop policy if exists "os_ic_reviews_authenticated_select" on public.os_ic_reviews;
create policy "os_ic_reviews_authenticated_select"
  on public.os_ic_reviews for select to authenticated using (true);

drop policy if exists "os_ic_reviews_authenticated_write" on public.os_ic_reviews;
create policy "os_ic_reviews_authenticated_write"
  on public.os_ic_reviews for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.os_ic_reviews to authenticated;

-- ---------------------------------------------------------------------------
-- Normalize: M&A targets + tasks
-- ---------------------------------------------------------------------------
create table if not exists public.os_ma_targets (
  id uuid primary key default gen_random_uuid(),
  ma_id text not null unique,
  company_name text not null,
  website text,
  sector text,
  deal_type text,
  source text,
  stage text not null,
  priority text not null default 'P2',
  owner text,
  enterprise_value_m numeric,
  revenue_m numeric,
  ebitda_m numeric,
  next_action text,
  next_action_date date,
  exclusivity_end date,
  strategic_fit text,
  notes text,
  outcome text,
  entity_id text,
  handoff_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists os_ma_targets_stage_idx on public.os_ma_targets (stage);
create index if not exists os_ma_targets_updated_at_idx on public.os_ma_targets (updated_at desc);

alter table public.os_ma_targets enable row level security;

drop policy if exists "os_ma_targets_authenticated_select" on public.os_ma_targets;
create policy "os_ma_targets_authenticated_select"
  on public.os_ma_targets for select to authenticated using (true);

drop policy if exists "os_ma_targets_authenticated_write" on public.os_ma_targets;
create policy "os_ma_targets_authenticated_write"
  on public.os_ma_targets for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.os_ma_targets to authenticated;

create table if not exists public.os_ma_tasks (
  id uuid primary key default gen_random_uuid(),
  task_id text not null unique,
  ma_id text not null references public.os_ma_targets (ma_id) on delete cascade,
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

create index if not exists os_ma_tasks_ma_id_idx on public.os_ma_tasks (ma_id);

alter table public.os_ma_tasks enable row level security;

drop policy if exists "os_ma_tasks_authenticated_select" on public.os_ma_tasks;
create policy "os_ma_tasks_authenticated_select"
  on public.os_ma_tasks for select to authenticated using (true);

drop policy if exists "os_ma_tasks_authenticated_write" on public.os_ma_tasks;
create policy "os_ma_tasks_authenticated_write"
  on public.os_ma_tasks for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.os_ma_tasks to authenticated;
