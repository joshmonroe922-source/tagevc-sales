-- Move entity compliance solely under Legal shared services.
-- Entity portals (Manage Portfolio) stay sales + operations.
-- Run after 0022_sales_contacts.sql.

-- ---------------------------------------------------------------------------
-- Portal catalog copy
-- ---------------------------------------------------------------------------
update public.sales_portals
set
  description = 'Portfolio companies, checklists, folders, and operations.',
  active = true
where slug = 'manage-portfolio';

update public.sales_portals
set
  description =
    'Shared compliance: licenses, filings, and renewals across all portfolio companies.',
  active = true
where slug = 'legal';

-- ---------------------------------------------------------------------------
-- Legal can read company names (for compliance picker / join), without full ops access
-- ---------------------------------------------------------------------------
drop policy if exists "Users view assigned ops entities" on public.ops_entities;
create policy "Users view assigned ops entities"
  on public.ops_entities for select
  using (
    public.is_active_sales_user()
    and (
      public.user_has_entity(id)
      or public.user_has_portal('legal')
    )
  );

-- ---------------------------------------------------------------------------
-- Compliance: Legal portal only (admins via user_has_portal)
-- ---------------------------------------------------------------------------
drop policy if exists "Sales users manage compliance items" on public.ops_compliance_items;
drop policy if exists "Users manage assigned compliance items" on public.ops_compliance_items;
create policy "Legal users manage compliance items"
  on public.ops_compliance_items for all
  using (public.is_active_sales_user() and public.user_has_portal('legal'))
  with check (public.is_active_sales_user() and public.user_has_portal('legal'));
