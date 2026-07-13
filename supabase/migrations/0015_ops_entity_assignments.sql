-- User-level access to portfolio entities (Manage Portfolio / Entity Ops).
-- Mirrors sales_user_portals: admins bypass via role; assignments gate everyone else.
-- Run after 0009_portfolio_companies.sql (and ideally after 0014).

-- ---------------------------------------------------------------------------
-- ops_entity_assignments — which entities each allowlisted user may open
-- ---------------------------------------------------------------------------
create table if not exists public.ops_entity_assignments (
  user_id     uuid not null references public.sales_users (id) on delete cascade,
  entity_id   uuid not null references public.ops_entities (id) on delete cascade,
  assigned_by uuid references public.sales_users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (user_id, entity_id)
);

create index if not exists ops_entity_assignments_entity_idx
  on public.ops_entity_assignments (entity_id);
create index if not exists ops_entity_assignments_user_idx
  on public.ops_entity_assignments (user_id);

alter table public.ops_entity_assignments enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.user_has_entity(p_entity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.sales_user_role() = 'admin'
    or exists (
      select 1
      from public.ops_entity_assignments a
      where a.user_id = public.current_sales_user_id()
        and a.entity_id = p_entity_id
    );
$$;

create or replace function public.user_has_any_entity()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.sales_user_role() = 'admin'
    or exists (
      select 1
      from public.ops_entity_assignments a
      where a.user_id = public.current_sales_user_id()
    );
$$;

-- Auto-assign creator (+ all active admins) when an entity is created so
-- INSERT … RETURNING and follow-up folder/checklist inserts succeed under RLS.
create or replace function public.ops_entities_auto_assign()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.ops_entity_assignments (user_id, entity_id, assigned_by)
    values (new.created_by, new.id, new.created_by)
    on conflict (user_id, entity_id) do nothing;
  end if;

  insert into public.ops_entity_assignments (user_id, entity_id, assigned_by)
  select su.id, new.id, new.created_by
  from public.sales_users su
  where su.active = true
    and su.role = 'admin'
    and coalesce(su.is_house_account, false) = false
  on conflict (user_id, entity_id) do nothing;

  return new;
end;
$$;

drop trigger if exists ops_entities_auto_assign on public.ops_entities;
create trigger ops_entities_auto_assign
  after insert on public.ops_entities
  for each row execute function public.ops_entities_auto_assign();

-- ---------------------------------------------------------------------------
-- Seed: assign all existing portfolio entities to all active admins (Josh, etc.)
-- App + user_has_entity() also treat role=admin as full access even without rows.
-- ---------------------------------------------------------------------------
insert into public.ops_entity_assignments (user_id, entity_id)
select su.id, e.id
from public.sales_users su
cross join public.ops_entities e
where su.active = true
  and su.role = 'admin'
  and coalesce(su.is_house_account, false) = false
on conflict (user_id, entity_id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS — assignments
-- ---------------------------------------------------------------------------
drop policy if exists "Users view own entity assignments" on public.ops_entity_assignments;
create policy "Users view own entity assignments"
  on public.ops_entity_assignments for select
  using (
    public.is_active_sales_user()
    and (
      user_id = public.current_sales_user_id()
      or public.sales_user_role() = 'admin'
    )
  );

drop policy if exists "Admins manage entity assignments" on public.ops_entity_assignments;
create policy "Admins manage entity assignments"
  on public.ops_entity_assignments for all
  using (public.is_active_sales_user() and public.sales_user_role() = 'admin')
  with check (public.is_active_sales_user() and public.sales_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- RLS — tighten ops entity data to assignments (admins via user_has_entity)
-- ---------------------------------------------------------------------------
drop policy if exists "Sales users manage ops entities" on public.ops_entities;
drop policy if exists "Users view assigned ops entities" on public.ops_entities;
drop policy if exists "Users insert ops entities" on public.ops_entities;
drop policy if exists "Users update assigned ops entities" on public.ops_entities;
drop policy if exists "Users delete assigned ops entities" on public.ops_entities;

create policy "Users view assigned ops entities"
  on public.ops_entities for select
  using (public.is_active_sales_user() and public.user_has_entity(id));

-- Any active sales user may create; trigger grants them (and admins) access.
create policy "Users insert ops entities"
  on public.ops_entities for insert
  with check (public.is_active_sales_user());

create policy "Users update assigned ops entities"
  on public.ops_entities for update
  using (public.is_active_sales_user() and public.user_has_entity(id))
  with check (public.is_active_sales_user() and public.user_has_entity(id));

create policy "Users delete assigned ops entities"
  on public.ops_entities for delete
  using (public.is_active_sales_user() and public.user_has_entity(id));

drop policy if exists "Sales users manage checklist items" on public.ops_checklist_items;
create policy "Users manage assigned checklist items"
  on public.ops_checklist_items for all
  using (public.is_active_sales_user() and public.user_has_entity(entity_id))
  with check (public.is_active_sales_user() and public.user_has_entity(entity_id));

drop policy if exists "Sales users manage ops folders" on public.ops_folders;
create policy "Users manage assigned ops folders"
  on public.ops_folders for all
  using (public.is_active_sales_user() and public.user_has_entity(entity_id))
  with check (public.is_active_sales_user() and public.user_has_entity(entity_id));

drop policy if exists "Sales users manage ops documents" on public.ops_documents;
create policy "Users manage assigned ops documents"
  on public.ops_documents for all
  using (public.is_active_sales_user() and public.user_has_entity(entity_id))
  with check (public.is_active_sales_user() and public.user_has_entity(entity_id));

drop policy if exists "Sales users manage compliance items" on public.ops_compliance_items;
create policy "Users manage assigned compliance items"
  on public.ops_compliance_items for all
  using (public.is_active_sales_user() and public.user_has_entity(entity_id))
  with check (public.is_active_sales_user() and public.user_has_entity(entity_id));

-- ---------------------------------------------------------------------------
-- Storage: tighten entity-docs to assigned entities when bucket policies exist
-- Path convention: {entity_id}/{folder_or_unfiled}/...
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from storage.buckets where id = 'entity-docs'
  ) then
    drop policy if exists "Sales users read entity-docs" on storage.objects;
    drop policy if exists "Sales users upload entity-docs" on storage.objects;
    drop policy if exists "Sales users update entity-docs" on storage.objects;
    drop policy if exists "Sales users delete entity-docs" on storage.objects;
    drop policy if exists "Users read assigned entity-docs" on storage.objects;
    drop policy if exists "Users upload assigned entity-docs" on storage.objects;
    drop policy if exists "Users update assigned entity-docs" on storage.objects;
    drop policy if exists "Users delete assigned entity-docs" on storage.objects;

    create policy "Users read assigned entity-docs"
      on storage.objects for select
      using (
        bucket_id = 'entity-docs'
        and public.is_active_sales_user()
        and split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$'
        and public.user_has_entity(split_part(name, '/', 1)::uuid)
      );

    create policy "Users upload assigned entity-docs"
      on storage.objects for insert
      with check (
        bucket_id = 'entity-docs'
        and public.is_active_sales_user()
        and split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$'
        and public.user_has_entity(split_part(name, '/', 1)::uuid)
      );

    create policy "Users update assigned entity-docs"
      on storage.objects for update
      using (
        bucket_id = 'entity-docs'
        and public.is_active_sales_user()
        and split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$'
        and public.user_has_entity(split_part(name, '/', 1)::uuid)
      )
      with check (
        bucket_id = 'entity-docs'
        and public.is_active_sales_user()
        and split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$'
        and public.user_has_entity(split_part(name, '/', 1)::uuid)
      );

    create policy "Users delete assigned entity-docs"
      on storage.objects for delete
      using (
        bucket_id = 'entity-docs'
        and public.is_active_sales_user()
        and split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$'
        and public.user_has_entity(split_part(name, '/', 1)::uuid)
      );
  end if;
end $$;
