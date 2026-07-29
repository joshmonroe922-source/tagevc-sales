-- Phase 86: Think Tank role (VP Think Tank / Strategic Thinking)
-- Enum + firm-wide / Visionary-breadth helpers. Do NOT assign to Lauren's profile
-- (preview via Josh Role Switcher only until explicitly granted).

alter type public.app_role add value if not exists 'think_tank';

-- Firm-wide entity access for Think Tank (+ keep SSC function roles aligned with app).
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
          'visionary', 'think_tank', 'admin', 'partner', 'associate',
          'coo', 'counsel_ops', 'service_lead',
          'ssc_finance', 'ssc_hr', 'ssc_legal', 'ssc_it', 'ssc_marketing'
        )
        or p.entity_id is null
        or p.entity_id = 'ENT-FIRM'
      )
  );
$$;

grant execute on function public.is_firm_wide_access() to authenticated;

-- Visionary + Think Tank (Net Worth private assets / C-Suite).
-- Personal credit tables keep is_visionary_role() — Think Tank excluded there.
create or replace function public.is_visionary_breadth_role()
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
      and p.role in ('visionary', 'think_tank')
  );
$$;

grant execute on function public.is_visionary_breadth_role() to authenticated;

-- Investor assets: private scope for Visionary breadth (credit stays Visionary-only).
do $$
begin
  if to_regclass('public.os_investor_assets') is null then
    return;
  end if;

  drop policy if exists os_investor_assets_select on public.os_investor_assets;
  create policy os_investor_assets_select on public.os_investor_assets
    for select to authenticated
    using (
      (visibility_scope = 'visionary_private' and public.is_visionary_breadth_role())
      or (
        visibility_scope = 'firm_visible'
        and (
          public.is_firm_wide_access()
          or entity_id is null
          or public.can_access_entity(entity_id)
        )
      )
    );

  drop policy if exists os_investor_assets_write on public.os_investor_assets;
  create policy os_investor_assets_write on public.os_investor_assets
    for all to authenticated
    using (
      (visibility_scope = 'visionary_private' and public.is_visionary_breadth_role())
      or (
        visibility_scope = 'firm_visible'
        and public.can_view_business_credit()
        and (
          public.is_firm_wide_access()
          or entity_id is null
          or public.can_access_entity(entity_id)
        )
      )
    )
    with check (
      (visibility_scope = 'visionary_private' and public.is_visionary_breadth_role())
      or (
        visibility_scope = 'firm_visible'
        and public.can_view_business_credit()
        and (
          public.is_firm_wide_access()
          or entity_id is null
          or public.can_access_entity(entity_id)
        )
      )
    );
end $$;

-- C-Suite: allow Think Tank (same as Visionary for threads owned by auth.uid()).
do $$
begin
  if to_regclass('public.os_csuite_briefings') is not null then
    drop policy if exists os_csuite_briefings_visionary on public.os_csuite_briefings;
    create policy os_csuite_briefings_visionary on public.os_csuite_briefings
      for all to authenticated
      using (public.is_visionary_breadth_role())
      with check (public.is_visionary_breadth_role());
  end if;

  if to_regclass('public.os_csuite_threads') is not null then
    drop policy if exists os_csuite_threads_visionary on public.os_csuite_threads;
    create policy os_csuite_threads_visionary on public.os_csuite_threads
      for all to authenticated
      using (public.is_visionary_breadth_role() and visionary_id = auth.uid())
      with check (public.is_visionary_breadth_role() and visionary_id = auth.uid());
  end if;

  if to_regclass('public.os_csuite_messages') is not null then
    drop policy if exists os_csuite_messages_visionary on public.os_csuite_messages;
    create policy os_csuite_messages_visionary on public.os_csuite_messages
      for all to authenticated
      using (
        public.is_visionary_breadth_role()
        and exists (
          select 1 from public.os_csuite_threads t
          where t.id = thread_id and t.visionary_id = auth.uid()
        )
      )
      with check (
        public.is_visionary_breadth_role()
        and exists (
          select 1 from public.os_csuite_threads t
          where t.id = thread_id and t.visionary_id = auth.uid()
        )
      );
  end if;

  if to_regclass('public.os_csuite_actions') is not null then
    drop policy if exists os_csuite_actions_visionary on public.os_csuite_actions;
    create policy os_csuite_actions_visionary on public.os_csuite_actions
      for all to authenticated
      using (public.is_visionary_breadth_role())
      with check (public.is_visionary_breadth_role());
  end if;

  if to_regclass('public.os_csuite_reports') is not null then
    drop policy if exists os_csuite_reports_visionary on public.os_csuite_reports;
    create policy os_csuite_reports_visionary on public.os_csuite_reports
      for all to authenticated
      using (public.is_visionary_breadth_role() and visionary_id = auth.uid())
      with check (public.is_visionary_breadth_role() and visionary_id = auth.uid());
  end if;
end $$;

-- Safety: never assign Think Tank here. Verify with:
--   select email, role from public.profiles where email ilike '%lauren%';
