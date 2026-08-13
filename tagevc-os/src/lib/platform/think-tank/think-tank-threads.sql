-- Phase 107: Think Tank multi-thread + attachments (shared UDL)
-- Apply once on opdqybaatfbwkokbzwli. Idempotent.
--
-- Changes:
--   * Drop one-thread-per-user unique (portal_key, profile_id)
--   * entity_os scope so Tage Entity OS switcher does not leak threads
--     across ENT-FIRM / ENT-R619 / ENT-SIGNENT / ENT-INDA
--   * portal_key is a slug (not a closed enum) so future clones work
--   * os_think_tank_attachments + private bucket os-think-tank
--
-- Known portal_key values: tage | r619 | inda | signent
-- Isolation: RLS (profile_id = auth.uid()) + app filter (portal_key, entity_os)

-- ---------------------------------------------------------------------------
-- Conversations: multi-thread + entity OS
-- ---------------------------------------------------------------------------
alter table public.os_think_tank_conversations
  drop constraint if exists os_think_tank_conversations_portal_key_profile_id_key;

alter table public.os_think_tank_conversations
  drop constraint if exists os_think_tank_conversations_portal_key_check;

alter table public.os_think_tank_conversations
  add column if not exists entity_os text;

update public.os_think_tank_conversations
set entity_os = coalesce(
  nullif(trim(entity_os), ''),
  nullif(trim(entity_id), ''),
  case portal_key
    when 'r619' then 'ENT-R619'
    when 'inda' then 'ENT-INDA'
    when 'signent' then 'ENT-SIGNENT'
    else 'ENT-FIRM'
  end
)
where coalesce(nullif(trim(entity_os), ''), '') = '';

alter table public.os_think_tank_conversations
  alter column entity_os set default 'ENT-FIRM';

alter table public.os_think_tank_conversations
  alter column entity_os set not null;

alter table public.os_think_tank_conversations
  drop constraint if exists os_think_tank_conversations_portal_key_slug;

alter table public.os_think_tank_conversations
  add constraint os_think_tank_conversations_portal_key_slug
  check (portal_key ~ '^[a-z0-9][a-z0-9_-]{1,31}$');

create index if not exists os_think_tank_conversations_scope_idx
  on public.os_think_tank_conversations (portal_key, profile_id, entity_os, updated_at desc);

-- ---------------------------------------------------------------------------
-- Attachments (thread-only document context)
-- ---------------------------------------------------------------------------
create table if not exists public.os_think_tank_attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.os_think_tank_conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  storage_bucket text not null default 'os-think-tank',
  storage_path text not null,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  extracted_text text,
  extract_error text,
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

create index if not exists os_think_tank_attachments_conv_idx
  on public.os_think_tank_attachments (conversation_id, created_at asc);

alter table public.os_think_tank_attachments enable row level security;

drop policy if exists os_tt_attachments_own on public.os_think_tank_attachments;
create policy os_tt_attachments_own on public.os_think_tank_attachments
  for all to authenticated
  using (
    profile_id = auth.uid()
    and exists (
      select 1 from public.os_think_tank_conversations c
      where c.id = conversation_id and c.profile_id = auth.uid()
    )
  )
  with check (
    profile_id = auth.uid()
    and exists (
      select 1 from public.os_think_tank_conversations c
      where c.id = conversation_id and c.profile_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.os_think_tank_attachments to authenticated;
grant select, insert, update, delete on public.os_think_tank_attachments to service_role;

-- ---------------------------------------------------------------------------
-- Storage bucket (private). Path: {profile_id}/{portal_key}/{conversation_id}/{file}
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'os-think-tank',
  'os-think-tank',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'text/csv',
    'text/html',
    'application/octet-stream'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists os_think_tank_storage_select on storage.objects;
create policy os_think_tank_storage_select
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'os-think-tank'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists os_think_tank_storage_insert on storage.objects;
create policy os_think_tank_storage_insert
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'os-think-tank'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists os_think_tank_storage_update on storage.objects;
create policy os_think_tank_storage_update
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'os-think-tank'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists os_think_tank_storage_delete on storage.objects;
create policy os_think_tank_storage_delete
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'os-think-tank'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
