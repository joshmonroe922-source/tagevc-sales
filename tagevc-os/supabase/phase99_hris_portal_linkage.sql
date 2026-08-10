-- ---------------------------------------------------------------------------
-- Phase 99 — HRIS ↔ portal profile linkage
--
-- Closes the "Recruit 619 portal linkage" gap: a hire under any entity got a
-- recruit_assignment stub with status pending_link and nothing ever provisioned
-- or connected the portal user.
--
-- Sign-in is Microsoft OAuth through Supabase, so the auth.users row is created
-- on first sign-in and its uuid is not knowable in advance. Rather than guess,
-- bind on the one stable key both sides share: the work email. A trigger on
-- public.profiles claims the matching HRIS employee whenever a profile appears
-- or its email changes, so linkage happens no matter who signs in first.
-- ---------------------------------------------------------------------------

create or replace function public.link_hris_employee_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp public.os_hris_employees%rowtype;
begin
  if new.email is null or btrim(new.email) = '' then
    return new;
  end if;

  select *
    into v_emp
  from public.os_hris_employees
  where lower(btrim(work_email)) = lower(btrim(new.email))
     or (
       coalesce(btrim(personal_email), '') <> ''
       and lower(btrim(personal_email)) = lower(btrim(new.email))
     )
  order by (lower(btrim(work_email)) = lower(btrim(new.email))) desc,
           created_at asc
  limit 1;

  if not found then
    return new;
  end if;

  -- Back-link the employee record to the portal profile.
  update public.os_hris_employees
  set
    profile_id = new.id,
    recruit_assignment = case
      when entity_id = 'ENT-R619' then
        coalesce(recruit_assignment, '{}'::jsonb)
        || jsonb_build_object(
             'status', 'linked',
             'linked_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SSZ'),
             'profile_id', new.id::text,
             'entity_id', 'ENT-R619',
             'portal_hint', coalesce(recruit_assignment->>'portal_hint', 'https://portal.recruit619.com')
           )
      else recruit_assignment
    end,
    updated_at = now()
  where id = v_emp.id
    and (profile_id is null or profile_id = new.id);

  -- Seed entity + title from the hire record. Role is only upgraded from the
  -- signup default so a deliberate role change is never silently reverted.
  update public.profiles
  set
    entity_id = coalesce(entity_id, v_emp.entity_id),
    full_name = coalesce(nullif(btrim(full_name), ''), v_emp.full_name),
    updated_at = now()
  where id = new.id;

  insert into public.os_hris_employee_events (employee_id, event_kind, summary, detail)
  values (
    v_emp.id,
    'link_added',
    'Portal profile linked',
    jsonb_build_object(
      'profile_id', new.id::text,
      'email', new.email,
      'entity_id', v_emp.entity_id,
      'source', 'link_hris_employee_to_profile'
    )
  );

  return new;
exception
  -- This trigger runs inside the sign-in transaction that creates the profile.
  -- Linkage is convenience, not a gate: never let it block someone logging in.
  when others then
    raise warning 'link_hris_employee_to_profile skipped for % : %', new.email, sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_link_hris_employee_to_profile on public.profiles;

create trigger trg_link_hris_employee_to_profile
after insert or update of email on public.profiles
for each row
execute function public.link_hris_employee_to_profile();

comment on function public.link_hris_employee_to_profile() is
  'Binds an HRIS employee to its portal profile by work/personal email on profile insert or email change.';
