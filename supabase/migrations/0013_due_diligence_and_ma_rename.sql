-- Due Diligence portal + rename New Acquisition → New Mergers & Acquisitions
-- Slug `new-acquisition` stays for URL / deep-link stability.
-- Run after 0008_new_start_acquire_portals.sql (and ideally after 0012).

-- ---------------------------------------------------------------------------
-- Rename display name for M&A onboarding portal (slug unchanged)
-- ---------------------------------------------------------------------------
update public.sales_portals
set
  name = 'New Mergers & Acquisitions',
  description = 'Onboard an M&A target into the portfolio after diligence and close.',
  icon = 'acquisition',
  sort_order = 16,
  active = true
where slug = 'new-acquisition';

-- ---------------------------------------------------------------------------
-- Due Diligence — deal-flow workspace between sourcing and M&A onboarding
-- ---------------------------------------------------------------------------
insert into public.sales_portals (slug, name, description, icon, sort_order)
values
  (
    'due-diligence',
    'Due Diligence',
    'Diligence checklist and deal workspace before term sheet or close.',
    'diligence',
    12
  )
on conflict (slug) do update
set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  sort_order = excluded.sort_order,
  active = true;

-- Assign every active admin (non-house) to all portals, including Due Diligence.
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
