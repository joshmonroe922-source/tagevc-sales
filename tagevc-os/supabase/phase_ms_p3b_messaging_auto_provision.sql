-- Multi-subsidiary P3b: auto-provision Messaging memberships.
-- Backfills current users + bakes triggers so future joiners / entities
-- get spine + portal mirror rows without a manual Admin lifecycle click.
-- Safe to re-run. Additive. Does not mutate SF tables. Does not change
-- cross-entity DM policy (dm_opt_in_rooms_deny remains).

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Signent home membership (client_id IS NULL) needs a partial unique index
-- because Postgres UNIQUE constraints treat NULLs as distinct.
do $$
begin
  if to_regclass('public.signent_messaging_memberships') is not null then
    execute $idx$
      create unique index if not exists signent_messaging_home_uidx
        on public.signent_messaging_memberships (entity_id, profile_id)
        where client_id is null
    $idx$;
  end if;
end $$;

-- Seed Signent default channels (were in TS DEFAULT_CHANNELS_BY_ENTITY only).
insert into public.os_messaging_default_channels
  (entity_id, channel_key, title, description, detail)
values
  (
    'ENT-SIGNENT','general','Signent HR · General',
    'Default subsidiary channel for Signent HR',
    jsonb_build_object('money_auto_approve',false,'contract_version','ms-p3b-v1')
  ),
  (
    'ENT-SIGNENT','shared-services','Signent HR · Shared Services',
    'Escalations and SS coordination',
    jsonb_build_object('money_auto_approve',false,'contract_version','ms-p3b-v1')
  )
on conflict (entity_id, channel_key) do update set
  title = excluded.title,
  description = excluded.description,
  active = true,
  detail = excluded.detail;

-- Ensure new Active registry entities get channel seeds + stay local-first.
create or replace function public.ensure_entity_messaging_defaults_ms_p3b(
  p_entity_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := public.resolve_canonical_entity_id(p_entity_code);
  v_name text;
begin
  if v_entity is null then
    return jsonb_build_object('ok',false,'error','entity_required');
  end if;

  select canonical_name into v_name
  from public.os_entity_registry
  where entity_code = v_entity;

  insert into public.os_messaging_default_channels
    (entity_id, channel_key, title, description, detail)
  values
    (
      v_entity,
      'general',
      coalesce(v_name, v_entity) || ' · General',
      'Default entity channel',
      jsonb_build_object('money_auto_approve',false,'contract_version','ms-p3b-v1')
    ),
    (
      v_entity,
      'shared-services',
      coalesce(v_name, v_entity) || ' · Shared Services',
      'Escalations and SS coordination',
      jsonb_build_object('money_auto_approve',false,'contract_version','ms-p3b-v1')
    )
  on conflict (entity_id, channel_key) do update set
    title = excluded.title,
    description = excluded.description,
    active = true;

  return jsonb_build_object(
    'ok', true,
    'entity_id', v_entity,
    'money_auto_approve', false,
    'contract_version', 'ms-p3b-v1'
  );
end;
$$;

revoke all on function public.ensure_entity_messaging_defaults_ms_p3b(text)
  from public, anon;
grant execute on function public.ensure_entity_messaging_defaults_ms_p3b(text)
  to authenticated, service_role;

-- Mirror helpers (tables may or may not exist depending on portal phase apply).
create or replace function public.sync_portal_messaging_mirror_ms_p3b(
  p_user_id uuid,
  p_entity_id text,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := public.resolve_canonical_entity_id(p_entity_id);
begin
  if p_user_id is null or v_entity is null then
    return;
  end if;

  -- Recruit 619 mirror
  if v_entity = 'ENT-R619'
     and to_regclass('public.r619_messaging_memberships') is not null then
    if p_active then
      insert into public.r619_messaging_memberships as m (
        entity_id, profile_id, home_entity_id, status,
        directory_scope, provisioned_at, revoked_at, last_error, updated_at
      ) values (
        'ENT-R619', p_user_id, 'ENT-R619', 'active',
        'home_entity', now(), null, null, now()
      )
      on conflict (entity_id, profile_id) do update set
        status = 'active',
        home_entity_id = 'ENT-R619',
        directory_scope = 'home_entity',
        provisioned_at = coalesce(m.provisioned_at, now()),
        revoked_at = null,
        last_error = null,
        updated_at = now();
    else
      update public.r619_messaging_memberships
      set status = 'revoked',
          revoked_at = now(),
          updated_at = now()
      where profile_id = p_user_id
        and entity_id = 'ENT-R619'
        and status is distinct from 'revoked';
    end if;
  end if;

  -- Instant NDA mirror
  if v_entity = 'ENT-INDA'
     and to_regclass('public.inda_messaging_memberships') is not null then
    if p_active then
      insert into public.inda_messaging_memberships as m (
        entity_id, profile_id, home_entity_id, status,
        directory_scope, provisioned_at, revoked_at, last_error, updated_at
      ) values (
        'ENT-INDA', p_user_id, 'ENT-INDA', 'active',
        'home_entity', now(), null, null, now()
      )
      on conflict (entity_id, profile_id) do update set
        status = 'active',
        home_entity_id = 'ENT-INDA',
        directory_scope = 'home_entity',
        provisioned_at = coalesce(m.provisioned_at, now()),
        revoked_at = null,
        last_error = null,
        updated_at = now();
    else
      update public.inda_messaging_memberships
      set status = 'revoked',
          revoked_at = now(),
          updated_at = now()
      where profile_id = p_user_id
        and entity_id = 'ENT-INDA'
        and status is distinct from 'revoked';
    end if;
  end if;

  -- Signent: entity-home row uses client_id IS NULL (client inboxes stay separate).
  if v_entity = 'ENT-SIGNENT'
     and to_regclass('public.signent_messaging_memberships') is not null then
    if p_active then
      update public.signent_messaging_memberships
      set role = coalesce(role, 'member'),
          active = true
      where entity_id = 'ENT-SIGNENT'
        and profile_id = p_user_id
        and client_id is null;

      if not found then
        insert into public.signent_messaging_memberships (
          entity_id, profile_id, client_id, role, active
        ) values (
          'ENT-SIGNENT', p_user_id, null, 'member', true
        );
      end if;
    else
      update public.signent_messaging_memberships
      set active = false
      where profile_id = p_user_id
        and entity_id = 'ENT-SIGNENT'
        and client_id is null
        and active is distinct from false;
    end if;
  end if;
end;
$$;

revoke all on function public.sync_portal_messaging_mirror_ms_p3b(uuid, text, boolean)
  from public, anon;

-- Core sync: home spine membership + portal mirror from profiles.entity_id.
create or replace function public.sync_messaging_membership_for_profile_ms_p3b(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text;
  v_active boolean;
  v_resolved text;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'user_id_required');
  end if;

  select entity_id, coalesce(active, true)
  into v_entity, v_active
  from public.profiles
  where id = p_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'profile_not_found');
  end if;

  v_resolved := public.resolve_canonical_entity_id(v_entity);

  if v_resolved is null or not v_active then
    -- Soft-revoke all active spine homes for this user; clear mirrors.
    update public.os_messaging_entity_memberships
    set deprovisioned_at = now()
    where user_id = p_user_id
      and deprovisioned_at is null;

    if v_resolved is not null then
      perform public.sync_portal_messaging_mirror_ms_p3b(p_user_id, v_resolved, false);
    end if;

    return jsonb_build_object(
      'ok', true,
      'action', 'deprovisioned',
      'user_id', p_user_id,
      'entity_id', v_resolved,
      'money_auto_approve', false,
      'contract_version', 'ms-p3b-v1'
    );
  end if;

  perform public.ensure_entity_messaging_defaults_ms_p3b(v_resolved);

  -- Clear other homes so unique home index stays valid.
  update public.os_messaging_entity_memberships
  set is_home = false
  where user_id = p_user_id
    and deprovisioned_at is null
    and is_home
    and entity_id is distinct from v_resolved;

  insert into public.os_messaging_entity_memberships as m (
    user_id, entity_id, membership_role, is_home, detail, deprovisioned_at
  ) values (
    p_user_id,
    v_resolved,
    'member',
    true,
    jsonb_build_object(
      'money_auto_approve', false,
      'contract_version', 'ms-p3b-v1',
      'source', 'auto_provision'
    ),
    null
  )
  on conflict (user_id, entity_id) do update set
    membership_role = excluded.membership_role,
    is_home = true,
    deprovisioned_at = null,
    provisioned_at = coalesce(m.provisioned_at, now()),
    detail = excluded.detail;

  perform public.sync_portal_messaging_mirror_ms_p3b(p_user_id, v_resolved, true);

  return jsonb_build_object(
    'ok', true,
    'action', 'provisioned',
    'user_id', p_user_id,
    'entity_id', v_resolved,
    'is_home', true,
    'money_auto_approve', false,
    'contract_version', 'ms-p3b-v1'
  );
end;
$$;

revoke all on function public.sync_messaging_membership_for_profile_ms_p3b(uuid)
  from public, anon;
grant execute on function public.sync_messaging_membership_for_profile_ms_p3b(uuid)
  to authenticated, service_role;

-- Backfill all profiles that have a home entity.
create or replace function public.backfill_messaging_memberships_ms_p3b()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
  v_ok integer := 0;
  v_fail integer := 0;
  v_result jsonb;
begin
  for r in
    select id, entity_id
    from public.profiles
    where coalesce(active, true) = true
      and entity_id is not null
  loop
    begin
      v_result := public.sync_messaging_membership_for_profile_ms_p3b(r.id);
      if coalesce((v_result->>'ok')::boolean, false) then
        v_ok := v_ok + 1;
      else
        v_fail := v_fail + 1;
      end if;
    exception when others then
      v_fail := v_fail + 1;
    end;
  end loop;

  -- Seed defaults for every Active registry entity (even with zero members).
  perform public.ensure_entity_messaging_defaults_ms_p3b(entity_code)
  from public.os_entity_registry
  where status = 'Active';

  return jsonb_build_object(
    'ok', true,
    'provisioned', v_ok,
    'failed', v_fail,
    'money_auto_approve', false,
    'contract_version', 'ms-p3b-v1'
  );
end;
$$;

revoke all on function public.backfill_messaging_memberships_ms_p3b()
  from public, anon;
grant execute on function public.backfill_messaging_memberships_ms_p3b()
  to authenticated, service_role;

-- Trigger: profiles insert/update of entity_id / active → sync messaging.
create or replace function public.trg_profiles_sync_messaging_ms_p3b()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if tg_op = 'INSERT'
     or new.entity_id is distinct from old.entity_id
     or new.active is distinct from old.active then
    perform public.sync_messaging_membership_for_profile_ms_p3b(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_messaging_ms_p3b on public.profiles;
create trigger profiles_sync_messaging_ms_p3b
  after insert or update of entity_id, active
  on public.profiles
  for each row
  execute function public.trg_profiles_sync_messaging_ms_p3b();

-- Trigger: new Active entity in registry → channel defaults.
create or replace function public.trg_entity_registry_messaging_defaults_ms_p3b()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.status = 'Active' then
    perform public.ensure_entity_messaging_defaults_ms_p3b(new.entity_code);
  end if;
  return new;
end;
$$;

drop trigger if exists os_entity_registry_messaging_defaults_ms_p3b
  on public.os_entity_registry;
create trigger os_entity_registry_messaging_defaults_ms_p3b
  after insert or update of status, canonical_name
  on public.os_entity_registry
  for each row
  execute function public.trg_entity_registry_messaging_defaults_ms_p3b();

-- One-shot backfill for current memberships.
select public.backfill_messaging_memberships_ms_p3b();
