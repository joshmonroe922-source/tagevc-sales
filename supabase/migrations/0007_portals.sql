-- Tage VC multi-portal access control v1
-- Catalog of functional portals + many-to-many assignments on sales_users.
-- Run in Supabase SQL Editor after 0001–0006.
-- UI gates routes by assignment; feature-table RLS stays "any active sales user"
-- for now (same as prior multi-rep note). Portal catalog RLS is assignment-aware.

-- ---------------------------------------------------------------------------
-- sales_portals — functional areas inside the portal app (Deal Sourcing, etc.)
-- ---------------------------------------------------------------------------
create table if not exists public.sales_portals (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null,
  description  text not null default '',
  icon         text not null default 'portal',
  sort_order   int not null default 100,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create index if not exists sales_portals_sort_idx
  on public.sales_portals (sort_order, name);

alter table public.sales_portals enable row level security;

-- ---------------------------------------------------------------------------
-- sales_user_portals — which portals each allowlisted user may open
-- ---------------------------------------------------------------------------
create table if not exists public.sales_user_portals (
  sales_user_id uuid not null references public.sales_users (id) on delete cascade,
  portal_id     uuid not null references public.sales_portals (id) on delete cascade,
  assigned_at   timestamptz not null default now(),
  assigned_by   uuid references public.sales_users (id) on delete set null,
  primary key (sales_user_id, portal_id)
);

create index if not exists sales_user_portals_portal_idx
  on public.sales_user_portals (portal_id);
create index if not exists sales_user_portals_user_idx
  on public.sales_user_portals (sales_user_id);

alter table public.sales_user_portals enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.user_has_portal(p_slug text)
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
      from public.sales_user_portals up
      join public.sales_portals p on p.id = up.portal_id
      where up.sales_user_id = public.current_sales_user_id()
        and p.slug = p_slug
        and p.active = true
    );
$$;

create or replace function public.user_has_any_portal()
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
      from public.sales_user_portals up
      join public.sales_portals p on p.id = up.portal_id
      where up.sales_user_id = public.current_sales_user_id()
        and p.active = true
    );
$$;

-- ---------------------------------------------------------------------------
-- Seed the nine portals
-- ---------------------------------------------------------------------------
insert into public.sales_portals (slug, name, description, icon, sort_order)
values
  (
    'deal-sourcing',
    'Deal Sourcing',
    'Pipeline, follow-ups, and founder nurture.',
    'deals',
    10
  ),
  (
    'manage-portfolio',
    'Manage Portfolio',
    'Portfolio entities, checklists, folders, and compliance.',
    'portfolio',
    20
  ),
  (
    'executive-leadership',
    'Executive Leadership',
    'Leadership overview and cross-portal priorities.',
    'executive',
    30
  ),
  (
    'reporting',
    'Reporting',
    'Deal-flow metrics and performance views.',
    'reporting',
    40
  ),
  (
    'accounting-finance',
    'Accounting and Finance',
    'Finance workspace (coming soon).',
    'finance',
    50
  ),
  (
    'legal',
    'Legal',
    'Legal workspace (coming soon).',
    'legal',
    60
  ),
  (
    'marketing',
    'Marketing',
    'Blog, social, and content operations.',
    'marketing',
    70
  ),
  (
    'technology',
    'Technology',
    'Technology workspace (coming soon).',
    'technology',
    80
  ),
  (
    'human-resources',
    'Human Resources',
    'HR workspace (coming soon).',
    'hr',
    90
  )
on conflict (slug) do update
set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  sort_order = excluded.sort_order,
  active = true;

-- Assign every active admin (non-house) to all portals.
-- Covers josh@tagevc.com, hello@tagevc.com, joshmonroe@tagevc.com, etc.
-- App + user_has_portal() also treat role=admin as full access even without rows.
insert into public.sales_user_portals (sales_user_id, portal_id)
select su.id, p.id
from public.sales_users su
cross join public.sales_portals p
where su.active = true
  and su.role = 'admin'
  and coalesce(su.is_house_account, false) = false
  and p.active = true
on conflict (sales_user_id, portal_id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Portals: assigned users see their portals; admins see all (for assignment UI)
drop policy if exists "Users view assigned portals" on public.sales_portals;
create policy "Users view assigned portals"
  on public.sales_portals for select
  using (
    public.is_active_sales_user()
    and (
      public.sales_user_role() = 'admin'
      or exists (
        select 1
        from public.sales_user_portals up
        where up.portal_id = sales_portals.id
          and up.sales_user_id = public.current_sales_user_id()
      )
    )
  );

drop policy if exists "Admins manage portals" on public.sales_portals;
create policy "Admins manage portals"
  on public.sales_portals for all
  using (public.is_active_sales_user() and public.sales_user_role() = 'admin')
  with check (public.is_active_sales_user() and public.sales_user_role() = 'admin');

-- Assignments: users read own rows; admins manage all
drop policy if exists "Users view own portal assignments" on public.sales_user_portals;
create policy "Users view own portal assignments"
  on public.sales_user_portals for select
  using (
    public.is_active_sales_user()
    and (
      sales_user_id = public.current_sales_user_id()
      or public.sales_user_role() = 'admin'
    )
  );

drop policy if exists "Admins manage portal assignments" on public.sales_user_portals;
create policy "Admins manage portal assignments"
  on public.sales_user_portals for all
  using (public.is_active_sales_user() and public.sales_user_role() = 'admin')
  with check (public.is_active_sales_user() and public.sales_user_role() = 'admin');
