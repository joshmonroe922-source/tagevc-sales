-- 0014 — Nobody can raise their own role on the shared profiles table.
--
-- profiles_update_own_or_admin lets every signed-in user update their own row,
-- and portal bootstraps upsert role from user_metadata (also user-editable), so
-- any user could make themselves visionary in every portal on this project.
--
-- Rules for API callers (current_user = authenticated / anon). Service role,
-- postgres and handle_new_user() are unaffected.
--   Self update  : role, active, email stay as they were. entity_id may only be
--                  filled from blank using the verified login email's domain.
--   Self insert  : role = associate, active = true, email = login email,
--                  entity_id from the login email's domain.
--   Others' rows : existing policies still decide who may edit. On top of that,
--                  only a visionary may grant, remove, or change a visionary
--                  (including their active/entity); admin requires visionary
--                  or admin.
--
-- Self-edits are silently kept (not raised) so portal bootstraps keep working.

begin;

create or replace function public.profiles_entity_for_email(p_email text)
returns text
language sql
immutable
as $$
  select case
    when lower(p_email) like '%@recruit619.com' then 'ENT-R619'
    when lower(p_email) like '%@instantnda.us' or lower(p_email) like '%@instantnda.com' then 'ENT-INDA'
    when lower(p_email) like '%@signenthr.com' or lower(p_email) like '%@signent.hr' then 'ENT-SIGNENT'
    else null
  end;
$$;

-- SECURITY INVOKER on purpose: current_user must be the API role, not the owner.
create or replace function public.profiles_guard_privileged_columns()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_login_email text := lower(nullif(auth.jwt() ->> 'email', ''));
  v_actor_role public.app_role;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.role := 'associate';
    new.active := true;
    new.email := coalesce(v_login_email, new.email);
    new.entity_id := public.profiles_entity_for_email(coalesce(v_login_email, new.email));
    return new;
  end if;

  if new.id = v_uid then
    new.role := old.role;
    new.active := old.active;
    new.email := old.email;
    if new.entity_id is distinct from old.entity_id then
      if old.entity_id is null
         and new.entity_id is not distinct from public.profiles_entity_for_email(v_login_email) then
        null;
      else
        new.entity_id := old.entity_id;
      end if;
    end if;
    return new;
  end if;

  if new.role is distinct from old.role
     or new.active is distinct from old.active
     or new.entity_id is distinct from old.entity_id then
    select p.role into v_actor_role
    from public.profiles p
    where p.id = v_uid and p.active = true;

    if (old.role = 'visionary' or new.role = 'visionary')
       and v_actor_role is distinct from 'visionary' then
      raise exception 'Only a visionary can grant, remove or change a visionary.'
        using errcode = '42501';
    end if;

    if new.role is distinct from old.role
       and (old.role = 'admin' or new.role = 'admin')
       and coalesce(v_actor_role::text, '') not in ('visionary', 'admin') then
      raise exception 'Only a visionary or admin can grant or remove admin.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged_columns_trg on public.profiles;
create trigger profiles_guard_privileged_columns_trg
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_privileged_columns();

-- TRUNCATE ignores RLS and no API caller needs it.
revoke truncate, references, trigger on public.profiles from anon, authenticated;

commit;
