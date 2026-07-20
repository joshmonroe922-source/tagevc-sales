-- Phase 18: Soft entity scope on Deal Flow / MA / RE / handoffs
-- Apply after phase17_entity_rls.sql
-- Firm-wide sees all; subsidiary sees own entity + unscoped (null) rows.
-- Leads use related_entity_id (nullable).

-- ---------------------------------------------------------------------------
-- os_leads — soft scope via related_entity_id
-- ---------------------------------------------------------------------------
drop policy if exists "os_leads_authenticated_select" on public.os_leads;
drop policy if exists "os_leads_authenticated_write" on public.os_leads;
drop policy if exists "os_leads_scoped_select" on public.os_leads;
drop policy if exists "os_leads_scoped_write" on public.os_leads;

create policy "os_leads_scoped_select"
  on public.os_leads for select to authenticated
  using (
    public.is_firm_wide_access()
    or related_entity_id is null
    or public.can_access_entity(related_entity_id)
  );

create policy "os_leads_scoped_write"
  on public.os_leads for all to authenticated
  using (
    public.is_firm_wide_access()
    or related_entity_id is null
    or public.can_access_entity(related_entity_id)
  )
  with check (
    public.is_firm_wide_access()
    or related_entity_id is null
    or public.can_access_entity(related_entity_id)
  );

-- ---------------------------------------------------------------------------
-- os_deals
-- ---------------------------------------------------------------------------
drop policy if exists "os_deals_authenticated_select" on public.os_deals;
drop policy if exists "os_deals_authenticated_write" on public.os_deals;
drop policy if exists "os_deals_scoped_select" on public.os_deals;
drop policy if exists "os_deals_scoped_write" on public.os_deals;

create policy "os_deals_scoped_select"
  on public.os_deals for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );

create policy "os_deals_scoped_write"
  on public.os_deals for all to authenticated
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

-- ---------------------------------------------------------------------------
-- os_ma_targets
-- ---------------------------------------------------------------------------
drop policy if exists "os_ma_targets_authenticated_select" on public.os_ma_targets;
drop policy if exists "os_ma_targets_authenticated_write" on public.os_ma_targets;
drop policy if exists "os_ma_targets_scoped_select" on public.os_ma_targets;
drop policy if exists "os_ma_targets_scoped_write" on public.os_ma_targets;

create policy "os_ma_targets_scoped_select"
  on public.os_ma_targets for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );

create policy "os_ma_targets_scoped_write"
  on public.os_ma_targets for all to authenticated
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

-- ---------------------------------------------------------------------------
-- os_re_deals
-- ---------------------------------------------------------------------------
drop policy if exists "os_re_deals_authenticated_select" on public.os_re_deals;
drop policy if exists "os_re_deals_authenticated_write" on public.os_re_deals;
drop policy if exists "os_re_deals_scoped_select" on public.os_re_deals;
drop policy if exists "os_re_deals_scoped_write" on public.os_re_deals;

create policy "os_re_deals_scoped_select"
  on public.os_re_deals for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );

create policy "os_re_deals_scoped_write"
  on public.os_re_deals for all to authenticated
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

-- ---------------------------------------------------------------------------
-- os_handoffs
-- ---------------------------------------------------------------------------
drop policy if exists "os_handoffs_authenticated_select" on public.os_handoffs;
drop policy if exists "os_handoffs_authenticated_write" on public.os_handoffs;
drop policy if exists "os_handoffs_scoped_select" on public.os_handoffs;
drop policy if exists "os_handoffs_scoped_write" on public.os_handoffs;

create policy "os_handoffs_scoped_select"
  on public.os_handoffs for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );

create policy "os_handoffs_scoped_write"
  on public.os_handoffs for all to authenticated
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
