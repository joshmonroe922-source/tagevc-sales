-- Phase 13: Private channels, file uploads, moderation, prefs, RE normalize
-- Apply after phase12_channels_and_normalize.sql

-- ---------------------------------------------------------------------------
-- Conversation privacy + description
-- ---------------------------------------------------------------------------
alter table public.os_conversations
  add column if not exists is_private boolean not null default false;

alter table public.os_conversations
  add column if not exists description text;

create index if not exists os_conversations_private_idx
  on public.os_conversations (kind, is_private)
  where archived_at is null;

-- Soft-delete messages already have deleted_at; ensure index
create index if not exists os_messages_deleted_idx
  on public.os_messages (conversation_id)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- File attachments (Supabase Storage backed)
-- ---------------------------------------------------------------------------
create table if not exists public.os_message_files (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.os_messages (id) on delete cascade,
  conversation_id uuid not null references public.os_conversations (id) on delete cascade,
  uploader_id uuid not null references public.profiles (id) on delete restrict,
  storage_path text not null,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  created_at timestamptz not null default now()
);

create index if not exists os_message_files_message_idx
  on public.os_message_files (message_id);
create index if not exists os_message_files_conversation_idx
  on public.os_message_files (conversation_id);

alter table public.os_message_files enable row level security;

drop policy if exists "os_message_files_select_member" on public.os_message_files;
create policy "os_message_files_select_member"
  on public.os_message_files for select
  to authenticated
  using (public.is_conversation_member(conversation_id));

drop policy if exists "os_message_files_insert_member" on public.os_message_files;
create policy "os_message_files_insert_member"
  on public.os_message_files for insert
  to authenticated
  with check (
    uploader_id = auth.uid()
    and public.is_conversation_member(conversation_id)
  );

grant select, insert on public.os_message_files to authenticated;

-- Storage bucket (private)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  10485760, -- 10 MB
  array[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path convention: {user_id}/{conversation_id}/{uuid}_{filename}
drop policy if exists "chat_attachments_select_member" on storage.objects;
create policy "chat_attachments_select_member"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and public.is_conversation_member((storage.foldername(name))[2]::uuid)
  );

drop policy if exists "chat_attachments_insert_own" on storage.objects;
create policy "chat_attachments_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_conversation_member((storage.foldername(name))[2]::uuid)
  );

drop policy if exists "chat_attachments_delete_own" on storage.objects;
create policy "chat_attachments_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Channel RPCs (private + member management + settings)
-- ---------------------------------------------------------------------------
create or replace function public.create_channel(
  p_title text,
  p_member_ids uuid[] default '{}'::uuid[],
  p_entity_id text default null,
  p_topic text default null,
  p_is_private boolean default false
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
  priv boolean := coalesce(p_is_private, false);
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if p_title is null or length(trim(p_title)) < 1 then
    raise exception 'Channel name required';
  end if;

  select array_agg(distinct x)
  into cleaned
  from unnest(coalesce(p_member_ids, '{}'::uuid[])) as x
  where x is not null and x <> me;

  -- Public firm channel: invite everyone if no members picked
  if not priv and cleaned is null then
    select array_agg(p.id)
    into cleaned
    from public.profiles p
    where p.active = true and p.id <> me;
  end if;

  -- Private channel requires at least one other member (or solo ok for drafts)
  insert into public.os_conversations (
    kind, title, created_by, entity_id, last_message_preview, is_private, description
  )
  values (
    'channel',
    trim(p_title),
    me,
    nullif(trim(coalesce(p_entity_id, '')), ''),
    topic,
    priv,
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

-- Recreate with new signature (drop old 4-arg if needed)
drop function if exists public.create_channel(text, uuid[], text, text);
-- keep grant on 5-arg version
grant execute on function public.create_channel(text, uuid[], text, text, boolean) to authenticated;

-- Private channels cannot be self-joined
create or replace function public.join_channel(cid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  row public.os_conversations%rowtype;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  select * into row from public.os_conversations where id = cid and archived_at is null;
  if row.id is null then raise exception 'Channel not found'; end if;
  if row.kind <> 'channel' then raise exception 'Not a channel'; end if;
  if row.is_private then
    raise exception 'Private channel — ask an owner to invite you';
  end if;

  insert into public.os_conversation_members (conversation_id, user_id, member_role)
  values (cid, me, 'member')
  on conflict (conversation_id, user_id) do update
    set left_at = null,
        joined_at = coalesce(os_conversation_members.joined_at, now());
end;
$$;

grant execute on function public.join_channel(uuid) to authenticated;

create or replace function public.update_channel_settings(
  cid uuid,
  p_title text default null,
  p_description text default null,
  p_is_private boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.os_conversation_members m
    where m.conversation_id = cid
      and m.user_id = auth.uid()
      and m.left_at is null
      and m.member_role = 'owner'
  ) then
    raise exception 'Only channel owners can update settings';
  end if;
  if not exists (
    select 1 from public.os_conversations c
    where c.id = cid and c.kind = 'channel' and c.archived_at is null
  ) then
    raise exception 'Channel not found';
  end if;

  update public.os_conversations
  set
    title = coalesce(nullif(trim(p_title), ''), title),
    description = case
      when p_description is null then description
      else nullif(trim(p_description), '')
    end,
    is_private = coalesce(p_is_private, is_private),
    updated_at = now()
  where id = cid;
end;
$$;

grant execute on function public.update_channel_settings(uuid, text, text, boolean) to authenticated;

create or replace function public.add_channel_members(cid uuid, p_member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.os_conversation_members m
    where m.conversation_id = cid and m.user_id = auth.uid()
      and m.left_at is null and m.member_role = 'owner'
  ) then
    raise exception 'Only channel owners can add members';
  end if;

  foreach uid in array coalesce(p_member_ids, '{}'::uuid[]) loop
    if uid is null then continue; end if;
    if not exists (select 1 from public.profiles p where p.id = uid and p.active) then
      continue;
    end if;
    insert into public.os_conversation_members (conversation_id, user_id, member_role)
    values (cid, uid, 'member')
    on conflict (conversation_id, user_id) do update
      set left_at = null,
          joined_at = coalesce(os_conversation_members.joined_at, now());
  end loop;
end;
$$;

grant execute on function public.add_channel_members(uuid, uuid[]) to authenticated;

create or replace function public.remove_channel_member(cid uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.os_conversation_members m
    where m.conversation_id = cid and m.user_id = auth.uid()
      and m.left_at is null and m.member_role = 'owner'
  ) and auth.uid() <> p_user_id then
    raise exception 'Forbidden';
  end if;

  update public.os_conversation_members
  set left_at = now()
  where conversation_id = cid
    and user_id = p_user_id
    and left_at is null
    and member_role <> 'owner'; -- owners cannot be removed this way
end;
$$;

grant execute on function public.remove_channel_member(uuid, uuid) to authenticated;

-- Soft-delete message (sender or channel owner)
create or replace function public.soft_delete_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  msg record;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into msg from public.os_messages where id = p_message_id;
  if msg is null then raise exception 'Message not found'; end if;
  if not public.is_conversation_member(msg.conversation_id) then
    raise exception 'Forbidden';
  end if;
  if msg.sender_id <> auth.uid()
     and not exists (
       select 1 from public.os_conversation_members m
       where m.conversation_id = msg.conversation_id
         and m.user_id = auth.uid()
         and m.left_at is null
         and m.member_role = 'owner'
     ) then
    raise exception 'Forbidden';
  end if;

  update public.os_messages
  set deleted_at = now(), body = '[deleted]', metadata = '{}'::jsonb
  where id = p_message_id;
end;
$$;

grant execute on function public.soft_delete_message(uuid) to authenticated;

-- Discoverable channels: public only (or already a member)
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
      or (c.is_private = false and c.entity_id is null)
    )
  order by c.title asc nulls last;
$$;

-- Tighten select policy for discoverable public channels
drop policy if exists "os_conversations_select_discoverable_channel" on public.os_conversations;
create policy "os_conversations_select_discoverable_channel"
  on public.os_conversations for select
  to authenticated
  using (
    kind = 'channel'
    and archived_at is null
    and is_private = false
    and entity_id is null
  );

-- ---------------------------------------------------------------------------
-- Notification preferences
-- ---------------------------------------------------------------------------
create table if not exists public.os_notification_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  email_digests boolean not null default true,
  digest_frequency text not null default 'daily'
    check (digest_frequency in ('off', 'daily', 'weekly')),
  notify_mentions boolean not null default true,
  notify_chat_messages boolean not null default true,
  muted_conversation_ids uuid[] not null default '{}'::uuid[],
  updated_at timestamptz not null default now()
);

alter table public.os_notification_prefs enable row level security;

drop policy if exists "os_notif_prefs_own" on public.os_notification_prefs;
create policy "os_notif_prefs_own"
  on public.os_notification_prefs for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update on public.os_notification_prefs to authenticated;

create or replace function public.upsert_notification_prefs(
  p_email_digests boolean default null,
  p_digest_frequency text default null,
  p_notify_mentions boolean default null,
  p_notify_chat_messages boolean default null,
  p_muted_conversation_ids uuid[] default null
)
returns public.os_notification_prefs
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  row public.os_notification_prefs;
begin
  if me is null then raise exception 'Not authenticated'; end if;

  insert into public.os_notification_prefs (user_id)
  values (me)
  on conflict (user_id) do nothing;

  update public.os_notification_prefs
  set
    email_digests = coalesce(p_email_digests, email_digests),
    digest_frequency = coalesce(p_digest_frequency, digest_frequency),
    notify_mentions = coalesce(p_notify_mentions, notify_mentions),
    notify_chat_messages = coalesce(p_notify_chat_messages, notify_chat_messages),
    muted_conversation_ids = coalesce(p_muted_conversation_ids, muted_conversation_ids),
    updated_at = now()
  where user_id = me
  returning * into row;

  return row;
end;
$$;

grant execute on function public.upsert_notification_prefs(boolean, text, boolean, boolean, uuid[]) to authenticated;

-- Respect mute + prefs in chat notify trigger
create or replace function public.os_messages_notify_members()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  preview text := left(new.body, 120);
  sender_label text;
  conv_title text;
begin
  if new.deleted_at is not null then
    return new;
  end if;

  select coalesce(nullif(trim(p.full_name), ''), p.email, 'Someone')
  into sender_label
  from public.profiles p
  where p.id = new.sender_id;

  select coalesce(
    nullif(trim(c.title), ''),
    case when c.kind = 'dm' then 'Direct message' else 'Conversation' end
  )
  into conv_title
  from public.os_conversations c
  where c.id = new.conversation_id;

  insert into public.app_notifications (
    notification_id, user_id, kind, title, body, href
  )
  select
    'NTF-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    m.user_id,
    'chat_message',
    sender_label || ' in ' || conv_title,
    preview,
    '/messages?c=' || new.conversation_id::text
  from public.os_conversation_members m
  left join public.os_notification_prefs pref on pref.user_id = m.user_id
  where m.conversation_id = new.conversation_id
    and m.user_id <> new.sender_id
    and m.left_at is null
    and coalesce(pref.notify_chat_messages, true) = true
    and not (new.conversation_id = any (coalesce(pref.muted_conversation_ids, '{}'::uuid[])));

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Normalize: Real Estate deals + tasks
-- ---------------------------------------------------------------------------
create table if not exists public.os_re_deals (
  id uuid primary key default gen_random_uuid(),
  re_id text not null unique,
  asset_name text not null,
  route text not null,
  asset_type text,
  market text,
  source text,
  stage text not null,
  priority text not null default 'P2',
  sourcer text,
  ask_k numeric,
  offer_k numeric,
  noi_k numeric,
  cap_yield_signal text,
  next_action text,
  next_action_date date,
  notes text,
  outcome text,
  entity_id text,
  handoff_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists os_re_deals_stage_idx on public.os_re_deals (stage);
create index if not exists os_re_deals_updated_at_idx on public.os_re_deals (updated_at desc);

alter table public.os_re_deals enable row level security;

drop policy if exists "os_re_deals_authenticated_select" on public.os_re_deals;
create policy "os_re_deals_authenticated_select"
  on public.os_re_deals for select to authenticated using (true);

drop policy if exists "os_re_deals_authenticated_write" on public.os_re_deals;
create policy "os_re_deals_authenticated_write"
  on public.os_re_deals for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.os_re_deals to authenticated;

create table if not exists public.os_re_tasks (
  id uuid primary key default gen_random_uuid(),
  task_id text not null unique,
  re_id text not null references public.os_re_deals (re_id) on delete cascade,
  asset_name text not null,
  route text not null,
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

create index if not exists os_re_tasks_re_id_idx on public.os_re_tasks (re_id);

alter table public.os_re_tasks enable row level security;

drop policy if exists "os_re_tasks_authenticated_select" on public.os_re_tasks;
create policy "os_re_tasks_authenticated_select"
  on public.os_re_tasks for select to authenticated using (true);

drop policy if exists "os_re_tasks_authenticated_write" on public.os_re_tasks;
create policy "os_re_tasks_authenticated_write"
  on public.os_re_tasks for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.os_re_tasks to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.os_message_files;
  exception when duplicate_object then null;
  end;
end $$;
