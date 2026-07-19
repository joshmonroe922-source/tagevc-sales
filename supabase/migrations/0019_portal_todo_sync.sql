-- Per-portal Microsoft To Do list mapping + sync metadata on sales_tasks.

alter table public.sales_tasks
  add column if not exists portal_slug text;

alter table public.sales_tasks
  add column if not exists ms_todo_list_id text;

alter table public.sales_tasks
  add column if not exists ms_todo_task_id text;

update public.sales_tasks
set portal_slug = 'deal-sourcing'
where portal_slug is null;

alter table public.sales_tasks
  drop constraint if exists sales_tasks_portal_slug_check;

alter table public.sales_tasks
  add constraint sales_tasks_portal_slug_check
  check (
    portal_slug is null
    or portal_slug in (
      'deal-sourcing',
      'due-diligence',
      'new-start-up',
      'new-acquisition',
      'manage-portfolio',
      'executive-leadership',
      'reporting',
      'accounting-finance',
      'legal',
      'marketing',
      'technology',
      'human-resources'
    )
  );

create index if not exists sales_tasks_portal_slug_idx
  on public.sales_tasks (portal_slug, status, due_at);

create index if not exists sales_tasks_ms_todo_task_idx
  on public.sales_tasks (ms_todo_task_id)
  where ms_todo_task_id is not null;

comment on column public.sales_tasks.portal_slug is
  'Portal section this follow-up belongs to (Deal Sourcing default).';
comment on column public.sales_tasks.ms_todo_list_id is
  'Microsoft To Do list id when synced.';
comment on column public.sales_tasks.ms_todo_task_id is
  'Microsoft To Do task id when synced.';

-- Per-user Graph list cache (one Tage · {Portal} list per portal).
create table if not exists public.sales_user_todo_lists (
  id uuid primary key default gen_random_uuid(),
  sales_user_id uuid not null references public.sales_users (id) on delete cascade,
  portal_slug text not null,
  ms_list_id text not null,
  list_display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sales_user_id, portal_slug)
);

alter table public.sales_user_todo_lists
  drop constraint if exists sales_user_todo_lists_portal_slug_check;

alter table public.sales_user_todo_lists
  add constraint sales_user_todo_lists_portal_slug_check
  check (
    portal_slug in (
      'deal-sourcing',
      'due-diligence',
      'new-start-up',
      'new-acquisition',
      'manage-portfolio',
      'executive-leadership',
      'reporting',
      'accounting-finance',
      'legal',
      'marketing',
      'technology',
      'human-resources'
    )
  );

create index if not exists sales_user_todo_lists_user_idx
  on public.sales_user_todo_lists (sales_user_id);

alter table public.sales_user_todo_lists enable row level security;

drop policy if exists "Users view own todo list maps" on public.sales_user_todo_lists;
create policy "Users view own todo list maps"
  on public.sales_user_todo_lists for select
  using (
    public.is_active_sales_user()
    and (
      sales_user_id = public.current_sales_user_id()
      or public.sales_user_role() = 'admin'
    )
  );

drop policy if exists "Users insert own todo list maps" on public.sales_user_todo_lists;
create policy "Users insert own todo list maps"
  on public.sales_user_todo_lists for insert
  with check (
    public.is_active_sales_user()
    and sales_user_id = public.current_sales_user_id()
  );

drop policy if exists "Users update own todo list maps" on public.sales_user_todo_lists;
create policy "Users update own todo list maps"
  on public.sales_user_todo_lists for update
  using (
    public.is_active_sales_user()
    and sales_user_id = public.current_sales_user_id()
  )
  with check (
    public.is_active_sales_user()
    and sales_user_id = public.current_sales_user_id()
  );

drop policy if exists "Users delete own todo list maps" on public.sales_user_todo_lists;
create policy "Users delete own todo list maps"
  on public.sales_user_todo_lists for delete
  using (
    public.is_active_sales_user()
    and sales_user_id = public.current_sales_user_id()
  );
