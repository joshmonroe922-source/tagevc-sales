-- Fix profiles RLS recursion that caused silent fallback to "associate"
-- Run in Supabase SQL editor for tagevc-os

create or replace function public.current_user_role()
returns public.app_role
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin_or_visionary()
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
      and p.role in ('admin', 'visionary')
  );
$$;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  to authenticated
  using (
    auth.uid() = id
    or public.is_admin_or_visionary()
  );

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin"
  on public.profiles for update
  to authenticated
  using (
    auth.uid() = id
    or public.is_admin_or_visionary()
  )
  with check (
    auth.uid() = id
    or public.is_admin_or_visionary()
  );

drop policy if exists "entities_authenticated_read" on public.entities;
create policy "entities_authenticated_read"
  on public.entities for select
  to authenticated
  using (true);

drop policy if exists "entities_admin_write" on public.entities;
create policy "entities_admin_write"
  on public.entities for all
  to authenticated
  using (
    public.is_admin_or_visionary()
    or public.current_user_role() = 'partner'
  )
  with check (
    public.is_admin_or_visionary()
    or public.current_user_role() = 'partner'
  );

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.entities to authenticated;
grant usage on type public.app_role to authenticated, anon;

update public.profiles
set role = 'visionary', updated_at = now()
where lower(email) in ('joshmonroe@tagevc.com', 'josh@tagevc.com');

select id, email, role from public.profiles;
