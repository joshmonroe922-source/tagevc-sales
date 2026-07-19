-- Morning digest: timezone (server-side), opt-out, per-day send lock.

alter table public.sales_users
  add column if not exists morning_digest_enabled boolean not null default true;

alter table public.sales_users
  add column if not exists timezone text;

alter table public.sales_users
  add column if not exists morning_digest_last_sent_on text;

comment on column public.sales_users.morning_digest_enabled is
  'When true (default), user receives the 6:00 AM local Today digest email.';

comment on column public.sales_users.timezone is
  'IANA timezone for digest scheduling and day boundaries. Null = derive from Outlook mailbox or default Indianapolis.';

comment on column public.sales_users.morning_digest_last_sent_on is
  'Local calendar day (YYYY-MM-DD) the morning digest was last sent for; prevents duplicate sends.';

create or replace function public.set_my_timezone(p_timezone text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_tz text;
begin
  v_uid := public.current_sales_user_id();
  if v_uid is null then
    raise exception 'Not authorized';
  end if;

  v_tz := nullif(trim(coalesce(p_timezone, '')), '');
  if v_tz is not null and position('/' in v_tz) = 0 and v_tz <> 'UTC' then
    raise exception 'Invalid timezone';
  end if;

  update public.sales_users
  set timezone = v_tz
  where id = v_uid;

  return v_tz;
end;
$$;

revoke all on function public.set_my_timezone(text) from public;
grant execute on function public.set_my_timezone(text) to authenticated;

create or replace function public.set_my_morning_digest_enabled(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  v_uid := public.current_sales_user_id();
  if v_uid is null then
    raise exception 'Not authorized';
  end if;

  update public.sales_users
  set morning_digest_enabled = coalesce(p_enabled, true)
  where id = v_uid;

  return coalesce(p_enabled, true);
end;
$$;

revoke all on function public.set_my_morning_digest_enabled(boolean) from public;
grant execute on function public.set_my_morning_digest_enabled(boolean) to authenticated;
