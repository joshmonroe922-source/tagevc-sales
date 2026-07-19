-- Administrative shared-services portal (shell)
-- Run after 0037_portal_tickets.

-- ---------------------------------------------------------------------------
-- Portal catalog
-- ---------------------------------------------------------------------------
insert into public.sales_portals (slug, name, description, icon, sort_order)
values (
  'administrative',
  'Administrative',
  'Office operations, facilities, vendor management, and general admin shared services across parent + subsidiaries.',
  'administrative',
  95
)
on conflict (slug) do update
set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  sort_order = excluded.sort_order,
  active = true;

-- Assign every active admin to the new portal.
insert into public.sales_user_portals (sales_user_id, portal_id)
select su.id, p.id
from public.sales_users su
cross join public.sales_portals p
where su.active = true
  and su.role = 'admin'
  and coalesce(su.is_house_account, false) = false
  and p.slug = 'administrative'
  and p.active = true
on conflict (sales_user_id, portal_id) do nothing;

-- ---------------------------------------------------------------------------
-- To Do portal_slug allowlist
-- ---------------------------------------------------------------------------
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
      'human-resources',
      'administrative'
    )
  );

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
      'human-resources',
      'administrative'
    )
  );

-- ---------------------------------------------------------------------------
-- Tickets: admin queue owned by Administrative portal
-- ---------------------------------------------------------------------------
create or replace function public.ticket_queue_portal_slug(p_category text)
returns text
language sql
immutable
as $$
  select case p_category
    when 'technology' then 'technology'
    when 'legal' then 'legal'
    when 'accounting-finance' then 'accounting-finance'
    when 'marketing' then 'marketing'
    when 'human-resources' then 'human-resources'
    when 'admin' then 'administrative'
    else null
  end;
$$;

create or replace function public.user_can_manage_ticket_category(p_category text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_active_sales_user()
    and (
      public.sales_user_role() = 'admin'
      or (
        public.ticket_queue_portal_slug(p_category) is not null
        and public.user_has_portal(public.ticket_queue_portal_slug(p_category))
      )
    );
$$;
