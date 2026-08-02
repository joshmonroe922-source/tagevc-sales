-- Phase 95: Custom Access Token hook for spine JWT org_ids[] (C2)
-- Enable in Supabase Dashboard → Authentication → Hooks → Custom Access Token
--   → select public.custom_access_token_hook
--
-- Requires phase94 graph spine (organizations, user_profiles, memberships).

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims jsonb;
  user_email text;
  entra text;
  profile_id uuid;
  is_admin boolean := false;
  org_ids uuid[] := '{}';
  role_list text[] := '{}';
  active uuid;
  r record;
begin
  claims := coalesce(event->'claims', '{}'::jsonb);

  user_email := lower(coalesce(
    claims->>'email',
    claims->'user_metadata'->>'email',
    ''
  ));
  entra := coalesce(
    claims->>'oid',
    claims->'user_metadata'->>'oid',
    claims->'app_metadata'->>'provider_id',
    claims->>'sub',
    ''
  );

  -- Prefer entra_oid match, then email
  if entra <> '' then
    select up.id, up.is_tage_admin
      into profile_id, is_admin
    from public.user_profiles up
    where up.entra_oid = entra
    limit 1;
  end if;

  if profile_id is null and user_email <> '' then
    select up.id, up.is_tage_admin, up.entra_oid
      into profile_id, is_admin, entra
    from public.user_profiles up
    where lower(up.email) = user_email
    limit 1;
  end if;

  -- Auto-provision spine profile from auth email (memberships still need ensureAdminMemberships / invite)
  if profile_id is null and user_email <> '' then
    insert into public.user_profiles (entra_oid, email, display_name, is_tage_admin)
    values (
      coalesce(nullif(entra, ''), 'pending:' || user_email),
      user_email,
      split_part(user_email, '@', 1),
      false
    )
    on conflict (entra_oid) do update
      set email = excluded.email
    returning id, is_tage_admin into profile_id, is_admin;
  end if;

  if profile_id is not null then
    for r in
      select m.org_id, m.role
      from public.memberships m
      where m.user_id = profile_id
        and m.status = 'active'
    loop
      org_ids := array_append(org_ids, r.org_id);
      role_list := array_append(role_list, r.role);
    end loop;
  end if;

  if cardinality(org_ids) > 0 then
    active := org_ids[1];
  else
    active := null;
  end if;

  claims := jsonb_set(claims, '{org_ids}', to_jsonb(org_ids), true);
  claims := jsonb_set(claims, '{roles}', to_jsonb(role_list), true);
  claims := jsonb_set(claims, '{is_tage_admin}', to_jsonb(coalesce(is_admin, false)), true);
  if entra <> '' then
    claims := jsonb_set(claims, '{entra_oid}', to_jsonb(entra), true);
  end if;
  if active is not null then
    claims := jsonb_set(claims, '{active_org_id}', to_jsonb(active), true);
  else
    claims := claims - 'active_org_id';
  end if;

  event := jsonb_set(event, '{claims}', claims, true);
  return event;
exception
  when others then
    -- Never block login — return original event
    return event;
end;
$$;

revoke all on function public.custom_access_token_hook(jsonb) from public;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to postgres;
grant execute on function public.custom_access_token_hook(jsonb) to service_role;

-- Auth admin needs to read membership tables inside the hook
grant usage on schema public to supabase_auth_admin;
grant select on public.user_profiles to supabase_auth_admin;
grant select on public.memberships to supabase_auth_admin;
grant select on public.organizations to supabase_auth_admin;
grant insert, update on public.user_profiles to supabase_auth_admin;

comment on function public.custom_access_token_hook(jsonb) is
  'C2 spine claims: org_ids[], roles[], is_tage_admin, entra_oid, active_org_id — enable as Custom Access Token hook';
