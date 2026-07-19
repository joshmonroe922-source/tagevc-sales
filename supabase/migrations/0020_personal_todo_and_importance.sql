-- Personal (unscoped) To Do list + importance on sales_tasks follow-ups.

alter table public.sales_tasks
  add column if not exists importance text not null default 'normal';

alter table public.sales_tasks
  drop constraint if exists sales_tasks_importance_check;

alter table public.sales_tasks
  add constraint sales_tasks_importance_check
  check (importance in ('low', 'normal', 'high'));

comment on column public.sales_tasks.importance is
  'Microsoft To Do importance: low | normal | high.';

-- Allow personal slug (Tage · Personal) alongside portal sections; null = unscoped.
alter table public.sales_tasks
  drop constraint if exists sales_tasks_portal_slug_check;

alter table public.sales_tasks
  add constraint sales_tasks_portal_slug_check
  check (
    portal_slug is null
    or portal_slug in (
      'personal',
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

comment on column public.sales_tasks.portal_slug is
  'Portal section, personal (Tage · Personal), or null for unscoped. Deal follow-ups use deal-sourcing.';

alter table public.sales_user_todo_lists
  drop constraint if exists sales_user_todo_lists_portal_slug_check;

alter table public.sales_user_todo_lists
  add constraint sales_user_todo_lists_portal_slug_check
  check (
    portal_slug in (
      'personal',
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
