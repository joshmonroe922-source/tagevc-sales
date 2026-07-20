-- Phase 17: Entity-scoped RLS helpers + scoped policies for Entity/Portfolio tables
-- Apply after phase17_validate_fks.sql (or independently after phase14)
-- Firm-wide roles retain full access; subsidiary-scoped profiles limited by entity_id.

-- ---------------------------------------------------------------------------
-- Helpers (security definer — avoid recursive profiles RLS)
-- ---------------------------------------------------------------------------
create or replace function public.current_user_entity_id()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select entity_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_firm_wide_access()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role in (
          'visionary', 'admin', 'partner', 'associate',
          'coo', 'counsel_ops', 'service_lead'
        )
        or p.entity_id is null
        or p.entity_id = 'ENT-FIRM'
      )
  );
$$;

create or replace function public.can_access_entity(p_entity_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.is_firm_wide_access()
    or public.current_user_entity_id() = p_entity_id
    or exists (
      select 1
      from public.entities e
      where e.entity_id = p_entity_id
        and e.parent_entity_id = public.current_user_entity_id()
    );
$$;

grant execute on function public.current_user_entity_id() to authenticated;
grant execute on function public.is_firm_wide_access() to authenticated;
grant execute on function public.can_access_entity(text) to authenticated;

-- ---------------------------------------------------------------------------
-- entities — scoped select; write stays firm-wide / partner+
-- ---------------------------------------------------------------------------
drop policy if exists "entities_authenticated_read" on public.entities;
drop policy if exists "entities_authenticated_write" on public.entities;
drop policy if exists "entities_admin_write" on public.entities;
drop policy if exists "entities_scoped_select" on public.entities;
drop policy if exists "entities_scoped_write" on public.entities;

create policy "entities_scoped_select"
  on public.entities for select to authenticated
  using (public.can_access_entity(entity_id));

create policy "entities_scoped_write"
  on public.entities for all to authenticated
  using (
    public.is_firm_wide_access()
    or (
      public.current_user_role() in ('sub_lead', 'coo')
      and public.can_access_entity(entity_id)
    )
  )
  with check (
    public.is_firm_wide_access()
    or (
      public.current_user_role() in ('sub_lead', 'coo')
      and public.can_access_entity(entity_id)
    )
  );

-- ---------------------------------------------------------------------------
-- portfolio_companies — scoped by entity_id
-- ---------------------------------------------------------------------------
drop policy if exists "portfolio_companies_authenticated_read" on public.portfolio_companies;
drop policy if exists "portfolio_companies_authenticated_write" on public.portfolio_companies;
drop policy if exists "portfolio_companies_scoped_select" on public.portfolio_companies;
drop policy if exists "portfolio_companies_scoped_write" on public.portfolio_companies;

create policy "portfolio_companies_scoped_select"
  on public.portfolio_companies for select to authenticated
  using (public.can_access_entity(entity_id));

create policy "portfolio_companies_scoped_write"
  on public.portfolio_companies for all to authenticated
  using (
    public.is_firm_wide_access()
    or (
      public.current_user_role() in ('sub_lead', 'coo')
      and public.can_access_entity(entity_id)
    )
  )
  with check (
    public.is_firm_wide_access()
    or (
      public.current_user_role() in ('sub_lead', 'coo')
      and public.can_access_entity(entity_id)
    )
  );

-- ---------------------------------------------------------------------------
-- entity_month_pnl / KPI — scoped by entity_id
-- ---------------------------------------------------------------------------
drop policy if exists "entity_month_pnl_authenticated_read" on public.entity_month_pnl;
drop policy if exists "entity_month_pnl_authenticated_write" on public.entity_month_pnl;
drop policy if exists "entity_month_pnl_scoped_select" on public.entity_month_pnl;
drop policy if exists "entity_month_pnl_scoped_write" on public.entity_month_pnl;

create policy "entity_month_pnl_scoped_select"
  on public.entity_month_pnl for select to authenticated
  using (public.can_access_entity(entity_id));

create policy "entity_month_pnl_scoped_write"
  on public.entity_month_pnl for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (public.is_firm_wide_access() or public.can_access_entity(entity_id));

drop policy if exists "entity_month_kpi_authenticated_read" on public.entity_month_kpi;
drop policy if exists "entity_month_kpi_authenticated_write" on public.entity_month_kpi;
drop policy if exists "entity_month_kpi_scoped_select" on public.entity_month_kpi;
drop policy if exists "entity_month_kpi_scoped_write" on public.entity_month_kpi;

create policy "entity_month_kpi_scoped_select"
  on public.entity_month_kpi for select to authenticated
  using (public.can_access_entity(entity_id));

create policy "entity_month_kpi_scoped_write"
  on public.entity_month_kpi for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (public.is_firm_wide_access() or public.can_access_entity(entity_id));

drop policy if exists "entity_month_kpi_flex_authenticated_read" on public.entity_month_kpi_flex;
drop policy if exists "entity_month_kpi_flex_authenticated_write" on public.entity_month_kpi_flex;
drop policy if exists "entity_month_kpi_flex_scoped_select" on public.entity_month_kpi_flex;
drop policy if exists "entity_month_kpi_flex_scoped_write" on public.entity_month_kpi_flex;

create policy "entity_month_kpi_flex_scoped_select"
  on public.entity_month_kpi_flex for select to authenticated
  using (public.can_access_entity(entity_id));

create policy "entity_month_kpi_flex_scoped_write"
  on public.entity_month_kpi_flex for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (public.is_firm_wide_access() or public.can_access_entity(entity_id));

-- ---------------------------------------------------------------------------
-- os_tickets / os_documents — soft scope when entity_id is set
-- Firm-wide still sees all; subsidiary sees own entity + unscoped (null) rows
-- ---------------------------------------------------------------------------
drop policy if exists "os_tickets_authenticated_select" on public.os_tickets;
drop policy if exists "os_tickets_authenticated_write" on public.os_tickets;
drop policy if exists "os_tickets_scoped_select" on public.os_tickets;
drop policy if exists "os_tickets_scoped_write" on public.os_tickets;

create policy "os_tickets_scoped_select"
  on public.os_tickets for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );

create policy "os_tickets_scoped_write"
  on public.os_tickets for all to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  )
  with check (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );

drop policy if exists "os_documents_authenticated_select" on public.os_documents;
drop policy if exists "os_documents_authenticated_write" on public.os_documents;
drop policy if exists "os_documents_scoped_select" on public.os_documents;
drop policy if exists "os_documents_scoped_write" on public.os_documents;

create policy "os_documents_scoped_select"
  on public.os_documents for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );

create policy "os_documents_scoped_write"
  on public.os_documents for all to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  )
  with check (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
