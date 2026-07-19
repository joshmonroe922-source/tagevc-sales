-- Personal Think Tank for every logged-in sales user (in addition to entity-scoped journals).
-- entity_id NULL + scope = 'personal' = one private journal per user.
-- entity_id set + scope = 'entity' = one journal per (user, portfolio entity).

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
alter table public.think_tank_conversations
  alter column entity_id drop not null;

alter table public.think_tank_conversations
  add column if not exists scope text not null default 'entity';

alter table public.think_tank_conversations
  drop constraint if exists think_tank_conversations_scope_check;

alter table public.think_tank_conversations
  add constraint think_tank_conversations_scope_check
  check (scope in ('personal', 'entity'));

alter table public.think_tank_conversations
  drop constraint if exists think_tank_conversations_scope_entity_check;

alter table public.think_tank_conversations
  add constraint think_tank_conversations_scope_entity_check
  check (
    (scope = 'personal' and entity_id is null)
    or (scope = 'entity' and entity_id is not null)
  );

-- Replace old unique (entity_id, user_id) — NULL entity_id would not enforce one personal thread.
alter table public.think_tank_conversations
  drop constraint if exists think_tank_conversations_entity_id_user_id_key;

drop index if exists think_tank_conversations_entity_user_uidx;
drop index if exists think_tank_conversations_personal_user_uidx;

create unique index if not exists think_tank_conversations_entity_user_uidx
  on public.think_tank_conversations (entity_id, user_id)
  where scope = 'entity' and entity_id is not null;

create unique index if not exists think_tank_conversations_personal_user_uidx
  on public.think_tank_conversations (user_id)
  where scope = 'personal';

create index if not exists think_tank_conversations_user_idx
  on public.think_tank_conversations (user_id);

-- Backfill scope for any legacy rows
update public.think_tank_conversations
set scope = case when entity_id is null then 'personal' else 'entity' end
where scope is distinct from case when entity_id is null then 'personal' else 'entity' end;

-- ---------------------------------------------------------------------------
-- RLS — own personal threads OR entity-assigned entity threads
-- ---------------------------------------------------------------------------
drop policy if exists "Entity users manage think tank conversations" on public.think_tank_conversations;
drop policy if exists "Users manage own think tank conversations" on public.think_tank_conversations;

create policy "Users manage own think tank conversations"
  on public.think_tank_conversations for all
  using (
    public.is_active_sales_user()
    and user_id = public.current_sales_user_id()
    and (
      scope = 'personal'
      or (scope = 'entity' and entity_id is not null and public.user_has_entity(entity_id))
    )
  )
  with check (
    public.is_active_sales_user()
    and user_id = public.current_sales_user_id()
    and (
      scope = 'personal'
      or (scope = 'entity' and entity_id is not null and public.user_has_entity(entity_id))
    )
  );

drop policy if exists "Entity users manage think tank messages" on public.think_tank_messages;
drop policy if exists "Users manage own think tank messages" on public.think_tank_messages;

create policy "Users manage own think tank messages"
  on public.think_tank_messages for all
  using (
    public.is_active_sales_user()
    and exists (
      select 1 from public.think_tank_conversations c
      where c.id = conversation_id
        and c.user_id = public.current_sales_user_id()
        and (
          c.scope = 'personal'
          or (c.scope = 'entity' and c.entity_id is not null and public.user_has_entity(c.entity_id))
        )
    )
  )
  with check (
    public.is_active_sales_user()
    and exists (
      select 1 from public.think_tank_conversations c
      where c.id = conversation_id
        and c.user_id = public.current_sales_user_id()
        and (
          c.scope = 'personal'
          or (c.scope = 'entity' and c.entity_id is not null and public.user_has_entity(c.entity_id))
        )
    )
  );

comment on column public.think_tank_conversations.scope is
  'personal = global journal for any portal user; entity = subsidiary COO journal';
comment on table public.think_tank_conversations is
  'Think Tank journals: personal (one per user) or entity-scoped (one per user per ops entity)';
