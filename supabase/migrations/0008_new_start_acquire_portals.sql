-- New Start Up + New Mergers & Acquisitions portals
-- Onboarding entry points that deep-link into Entity Ops start/acquire checklists.
-- Slug `new-acquisition` kept for URL stability; display name is M&A.
-- Run in Supabase SQL Editor after 0007_portals.sql.
-- Note: 0013 also renames/updates display fields for already-applied environments.

insert into public.sales_portals (slug, name, description, icon, sort_order)
values
  (
    'new-start-up',
    'New Start Up',
    'Onboard a newly launched business into the portfolio.',
    'startup',
    15
  ),
  (
    'new-acquisition',
    'New Mergers & Acquisitions',
    'Onboard an M&A target into the portfolio after diligence and close.',
    'acquisition',
    16
  )
on conflict (slug) do update
set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  sort_order = excluded.sort_order,
  active = true;

-- Assign every active admin (non-house) to all portals, including the new ones.
insert into public.sales_user_portals (sales_user_id, portal_id)
select su.id, p.id
from public.sales_users su
cross join public.sales_portals p
where su.active = true
  and su.role = 'admin'
  and coalesce(su.is_house_account, false) = false
  and p.active = true
on conflict (sales_user_id, portal_id) do nothing;
