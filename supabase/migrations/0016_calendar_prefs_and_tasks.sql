-- Calendar view preference + docs for Microsoft To Do / Planner (same OAuth connection).

alter table public.sales_users
  add column if not exists calendar_default_view text;

alter table public.sales_users
  drop constraint if exists sales_users_calendar_default_view_check;

alter table public.sales_users
  add constraint sales_users_calendar_default_view_check
  check (
    calendar_default_view is null
    or calendar_default_view in ('month', 'week', 'agenda')
  );

comment on column public.sales_users.calendar_default_view is
  'Preferred calendar UI view: month | week | agenda. Null = agenda.';

update public.sales_users
set calendar_default_view = 'agenda'
where calendar_default_view is null;

create or replace function public.set_my_calendar_default_view(p_view text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_view text;
begin
  v_uid := public.current_sales_user_id();
  if v_uid is null then
    raise exception 'Not authorized';
  end if;

  v_view := lower(trim(coalesce(p_view, '')));
  if v_view not in ('month', 'week', 'agenda') then
    raise exception 'Invalid calendar view';
  end if;

  update public.sales_users
  set calendar_default_view = v_view
  where id = v_uid;

  return v_view;
end;
$$;

revoke all on function public.set_my_calendar_default_view(text) from public;
grant execute on function public.set_my_calendar_default_view(text) to authenticated;
