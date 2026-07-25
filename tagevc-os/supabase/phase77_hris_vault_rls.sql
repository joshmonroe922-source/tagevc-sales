-- Phase 77: HRIS entity-scoped document vault RLS + manager access.
-- Additive on Phase 72. Safe to re-run. Does NOT drop os_store_snapshots.
-- Tightens hris-private storage from firm-wide to entity/manager scoped.
-- Existing objects remain readable when path resolves to an accessible employee.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

/** HR / Visionary roles that may manage HRIS docs within entity scope. */
create or replace function public.is_hris_hr_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.role in ('visionary', 'admin', 'coo', 'counsel_ops', 'service_lead')
  );
$$;

grant execute on function public.is_hris_hr_role() to authenticated;

/**
 * Resolve employee id from a hris-private storage object name.
 * New: {entity_id}/{employee_id}/...
 * Legacy: {employee_id}/...
 * Unresolvable → null (deny by default).
 */
create or replace function public.hris_storage_employee_id(p_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  parts text[];
  candidate text;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    return null;
  end if;
  parts := string_to_array(p_name, '/');
  if parts is null or array_length(parts, 1) is null then
    return null;
  end if;
  if parts[1] ~ '^ENT-[A-Z0-9-]{1,32}$' then
    if array_length(parts, 1) < 2 then
      return null;
    end if;
    candidate := parts[2];
  else
    candidate := parts[1];
  end if;
  begin
    return candidate::uuid;
  exception when invalid_text_representation then
    return null;
  end;
end;
$$;

grant execute on function public.hris_storage_employee_id(text) to authenticated;

/**
 * Can the current user access HRIS data for this employee?
 * - Visionary: break-glass (all)
 * - HR roles: entity-scoped via can_access_entity
 * - Assigned manager: manager_profile_id = auth.uid()
 * - Else: deny
 */
create or replace function public.is_hris_employee_accessible(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when p_employee_id is null then false
      when public.is_visionary_role() then true
      when exists (
        select 1
        from public.os_hris_employees e
        where e.id = p_employee_id
          and e.manager_profile_id = auth.uid()
      ) then true
      when public.is_hris_hr_role()
        and exists (
          select 1
          from public.os_hris_employees e
          where e.id = p_employee_id
            and public.can_access_entity(e.entity_id)
        ) then true
      else false
    end;
$$;

grant execute on function public.is_hris_employee_accessible(uuid) to authenticated;

create or replace function public.is_hris_doc_accessible(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.os_hris_documents d
    where d.id = p_document_id
      and public.is_hris_employee_accessible(d.employee_id)
  );
$$;

grant execute on function public.is_hris_doc_accessible(uuid) to authenticated;

create or replace function public.can_access_hris_storage_path(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when public.is_visionary_role() then true
      when public.hris_storage_employee_id(p_name) is null then false
      else public.is_hris_employee_accessible(public.hris_storage_employee_id(p_name))
    end;
$$;

grant execute on function public.can_access_hris_storage_path(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Table RLS: replace firm-wide blanket with scoped helper
-- ---------------------------------------------------------------------------
drop policy if exists os_hris_docs_select on public.os_hris_documents;
create policy os_hris_docs_select on public.os_hris_documents
  for select to authenticated
  using (public.is_hris_employee_accessible(employee_id));

drop policy if exists os_hris_docs_write on public.os_hris_documents;
create policy os_hris_docs_write on public.os_hris_documents
  for all to authenticated
  using (public.is_hris_employee_accessible(employee_id))
  with check (public.is_hris_employee_accessible(employee_id));

-- ---------------------------------------------------------------------------
-- Storage policies: entity/manager scoped (legacy paths still resolve)
-- ---------------------------------------------------------------------------
drop policy if exists "hris_private_storage_select" on storage.objects;
create policy "hris_private_storage_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'hris-private'
    and public.can_access_hris_storage_path(name)
  );

drop policy if exists "hris_private_storage_insert" on storage.objects;
create policy "hris_private_storage_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'hris-private'
    and public.can_access_hris_storage_path(name)
  );

drop policy if exists "hris_private_storage_update" on storage.objects;
create policy "hris_private_storage_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'hris-private'
    and public.can_access_hris_storage_path(name)
  )
  with check (
    bucket_id = 'hris-private'
    and public.can_access_hris_storage_path(name)
  );

comment on function public.is_hris_employee_accessible(uuid) is
  'Phase 77: Visionary break-glass OR assigned manager OR HR role with entity scope.';
comment on function public.can_access_hris_storage_path(text) is
  'Phase 77: hris-private path ACL — deny unresolvable paths except Visionary.';
