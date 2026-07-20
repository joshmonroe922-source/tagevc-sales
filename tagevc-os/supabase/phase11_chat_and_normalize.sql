-- Phase 11: Chat enhancements + Deals/Documents normalization
-- Apply in Supabase SQL editor for tagevc-os after phase10_messaging.sql
--
-- Chat: notify members on message, link conversations, search helper
-- Normalize: os_deals, os_deal_tasks, os_documents (dual-write with snapshots)

-- ---------------------------------------------------------------------------
-- Chat: notify other members when a message arrives
-- ---------------------------------------------------------------------------
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
  where m.conversation_id = new.conversation_id
    and m.user_id <> new.sender_id
    and m.left_at is null;

  return new;
end;
$$;

drop trigger if exists os_messages_notify_members on public.os_messages;
create trigger os_messages_notify_members
  after insert on public.os_messages
  for each row execute function public.os_messages_notify_members();

-- ---------------------------------------------------------------------------
-- Chat: link conversation to a domain object
-- ---------------------------------------------------------------------------
create or replace function public.link_conversation(
  cid uuid,
  p_ref_type text,
  p_ref_id text,
  p_entity_id text default null
)
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
  if p_ref_type is null or p_ref_id is null
     or length(trim(p_ref_type)) = 0 or length(trim(p_ref_id)) = 0 then
    raise exception 'ref_type and ref_id required';
  end if;
  if p_ref_type not in ('lead', 'deal', 'entity', 'task', 'ticket', 'document') then
    raise exception 'Unsupported ref_type';
  end if;

  update public.os_conversations
  set
    linked_ref_type = lower(trim(p_ref_type)),
    linked_ref_id = trim(p_ref_id),
    entity_id = coalesce(nullif(trim(p_entity_id), ''), entity_id),
    updated_at = now()
  where id = cid;
end;
$$;

grant execute on function public.link_conversation(uuid, text, text, text) to authenticated;

-- Find or create a linked group chat for a domain object
create or replace function public.find_or_create_linked_chat(
  p_ref_type text,
  p_ref_id text,
  p_title text,
  p_entity_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cid uuid;
  title text;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;
  if p_ref_type is null or p_ref_id is null then
    raise exception 'ref_type and ref_id required';
  end if;
  if p_ref_type not in ('lead', 'deal', 'entity', 'task', 'ticket', 'document') then
    raise exception 'Unsupported ref_type';
  end if;

  title := coalesce(nullif(trim(p_title), ''), initcap(p_ref_type) || ' ' || p_ref_id);

  select c.id into cid
  from public.os_conversations c
  join public.os_conversation_members m
    on m.conversation_id = c.id and m.user_id = me and m.left_at is null
  where c.linked_ref_type = lower(trim(p_ref_type))
    and c.linked_ref_id = trim(p_ref_id)
    and c.archived_at is null
  order by c.created_at asc
  limit 1;

  if cid is not null then
    return cid;
  end if;

  insert into public.os_conversations (
    kind, title, created_by, linked_ref_type, linked_ref_id, entity_id
  )
  values (
    'group',
    title,
    me,
    lower(trim(p_ref_type)),
    trim(p_ref_id),
    nullif(trim(p_entity_id), '')
  )
  returning id into cid;

  insert into public.os_conversation_members (conversation_id, user_id, member_role)
  values (cid, me, 'owner');

  return cid;
end;
$$;

grant execute on function public.find_or_create_linked_chat(text, text, text, text) to authenticated;

-- Search messages in a conversation the user belongs to
create or replace function public.search_conversation_messages(
  cid uuid,
  p_query text,
  p_limit int default 40
)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  parent_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_conversation_member(cid) then
    raise exception 'Forbidden';
  end if;
  if p_query is null or length(trim(p_query)) < 2 then
    return;
  end if;

  return query
  select m.id, m.conversation_id, m.sender_id, m.body, m.parent_id, m.created_at
  from public.os_messages m
  where m.conversation_id = cid
    and m.deleted_at is null
    and m.body ilike '%' || trim(p_query) || '%'
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 40), 100));
end;
$$;

grant execute on function public.search_conversation_messages(uuid, text, int) to authenticated;

create extension if not exists pg_trgm;

create index if not exists os_messages_body_trgm_idx
  on public.os_messages using gin (body gin_trgm_ops);

create index if not exists os_conversations_linked_lookup_idx
  on public.os_conversations (linked_ref_type, linked_ref_id)
  where linked_ref_type is not null and archived_at is null;

-- ---------------------------------------------------------------------------
-- Normalize: Deals (DE-###) + Deal Tasks (DT-###)
-- ---------------------------------------------------------------------------
create table if not exists public.os_deals (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null unique,
  lead_id text,
  company_name text not null,
  entity_id text,
  exec_stage text not null,
  priority text not null default 'P2',
  instrument text,
  premoney_m numeric,
  check_k numeric,
  ownership_pct numeric,
  counsel text,
  path text,
  outcome text,
  owner text,
  next_action text,
  handoff_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists os_deals_exec_stage_idx on public.os_deals (exec_stage);
create index if not exists os_deals_updated_at_idx on public.os_deals (updated_at desc);
create index if not exists os_deals_entity_idx on public.os_deals (entity_id);

alter table public.os_deals enable row level security;

drop policy if exists "os_deals_authenticated_select" on public.os_deals;
create policy "os_deals_authenticated_select"
  on public.os_deals for select to authenticated using (true);

drop policy if exists "os_deals_authenticated_write" on public.os_deals;
create policy "os_deals_authenticated_write"
  on public.os_deals for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.os_deals to authenticated;

create table if not exists public.os_deal_tasks (
  id uuid primary key default gen_random_uuid(),
  task_id text not null unique,
  deal_id text not null references public.os_deals (deal_id) on delete cascade,
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

create index if not exists os_deal_tasks_deal_id_idx on public.os_deal_tasks (deal_id);
create index if not exists os_deal_tasks_status_idx on public.os_deal_tasks (status);

alter table public.os_deal_tasks enable row level security;

drop policy if exists "os_deal_tasks_authenticated_select" on public.os_deal_tasks;
create policy "os_deal_tasks_authenticated_select"
  on public.os_deal_tasks for select to authenticated using (true);

drop policy if exists "os_deal_tasks_authenticated_write" on public.os_deal_tasks;
create policy "os_deal_tasks_authenticated_write"
  on public.os_deal_tasks for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.os_deal_tasks to authenticated;

-- ---------------------------------------------------------------------------
-- Normalize: Documents (DOC-###)
-- ---------------------------------------------------------------------------
create table if not exists public.os_documents (
  id uuid primary key default gen_random_uuid(),
  doc_id text not null unique,
  entity_id text,
  deal_or_task_id text,
  doc_type text not null,
  template_id text,
  title text not null,
  library_path text not null default '',
  folder text not null default '',
  status text not null,
  envelope_id text,
  merged_body text,
  merge_values jsonb not null default '{}'::jsonb,
  signers jsonb not null default '[]'::jsonb,
  sent_by text,
  sent_at timestamptz,
  completed_at timestamptz,
  content_hash text,
  notes text,
  ai_review jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_documents_entity_idx on public.os_documents (entity_id);
create index if not exists os_documents_status_idx on public.os_documents (status);
create index if not exists os_documents_updated_at_idx on public.os_documents (updated_at desc);

alter table public.os_documents enable row level security;

drop policy if exists "os_documents_authenticated_select" on public.os_documents;
create policy "os_documents_authenticated_select"
  on public.os_documents for select to authenticated using (true);

drop policy if exists "os_documents_authenticated_write" on public.os_documents;
create policy "os_documents_authenticated_write"
  on public.os_documents for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.os_documents to authenticated;

-- Realtime for notification badges
do $$
begin
  begin
    alter publication supabase_realtime add table public.app_notifications;
  exception when duplicate_object then null;
  end;
end $$;
