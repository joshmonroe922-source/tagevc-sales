-- Shared master Microsoft To Do list (header capture + /sales/todo).

alter table public.sales_tasks
  drop constraint if exists sales_tasks_portal_slug_check;

alter table public.sales_tasks
  add constraint sales_tasks_portal_slug_check
  check (
    portal_slug is null
    or portal_slug in (
      'master',
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
  'Master (shared To Do), personal, portal section, or null. Header capture uses master.';

alter table public.sales_user_todo_lists
  drop constraint if exists sales_user_todo_lists_portal_slug_check;

alter table public.sales_user_todo_lists
  add constraint sales_user_todo_lists_portal_slug_check
  check (
    portal_slug in (
      'master',
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
