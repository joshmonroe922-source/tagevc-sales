-- Multiple saved mail signatures per portal user (Recruiting Desk parity).
-- Default signature syncs to sales_users.mail_signature_html for microsoft-mail append.

create table if not exists public.mail_signatures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.sales_users(id) on delete cascade,
  name text not null,
  body_html text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mail_signatures_name_len check (char_length(name) between 1 and 120),
  constraint mail_signatures_body_len check (char_length(body_html) <= 20000),
  unique (user_id, name)
);

create index if not exists mail_signatures_user_default_idx
  on public.mail_signatures (user_id, is_default desc, name);

alter table public.mail_signatures enable row level security;

create policy mail_signatures_select_own on public.mail_signatures
  for select to authenticated
  using (user_id = public.current_sales_user_id());

create policy mail_signatures_insert_own on public.mail_signatures
  for insert to authenticated
  with check (user_id = public.current_sales_user_id());

create policy mail_signatures_update_own on public.mail_signatures
  for update to authenticated
  using (user_id = public.current_sales_user_id())
  with check (user_id = public.current_sales_user_id());

create policy mail_signatures_delete_own on public.mail_signatures
  for delete to authenticated
  using (user_id = public.current_sales_user_id());

create or replace function public.sync_default_mail_signature(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_html text;
begin
  select body_html into v_html
  from public.mail_signatures
  where user_id = p_user_id and is_default = true
  order by updated_at desc
  limit 1;

  update public.sales_users
  set mail_signature_html = v_html
  where id = p_user_id;
end;
$$;

revoke all on function public.sync_default_mail_signature(uuid) from public;
grant execute on function public.sync_default_mail_signature(uuid) to authenticated;

create or replace function public.list_my_mail_signatures()
returns jsonb
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

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'name', s.name,
          'body_html', s.body_html,
          'is_default', s.is_default,
          'created_at', s.created_at,
          'updated_at', s.updated_at
        )
        order by s.is_default desc, s.name asc
      )
      from public.mail_signatures s
      where s.user_id = v_uid
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.list_my_mail_signatures() from public;
grant execute on function public.list_my_mail_signatures() to authenticated;

create or replace function public.upsert_my_mail_signature(
  p_id uuid default null,
  p_name text default null,
  p_body_html text default null,
  p_is_default boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_name text;
  v_html text;
  v_row public.mail_signatures%rowtype;
begin
  v_uid := public.current_sales_user_id();
  if v_uid is null then
    raise exception 'Not authorized';
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  v_html := nullif(trim(coalesce(p_body_html, '')), '');

  if p_id is null then
    if v_name is null then
      raise exception 'Signature name is required';
    end if;
    if v_html is null then
      raise exception 'Signature body is required';
    end if;

    if p_is_default then
      update public.mail_signatures
      set is_default = false, updated_at = now()
      where user_id = v_uid and is_default = true;
    end if;

    insert into public.mail_signatures (user_id, name, body_html, is_default)
    values (v_uid, v_name, v_html, coalesce(p_is_default, false))
    returning * into v_row;
  else
    select * into v_row
    from public.mail_signatures
    where id = p_id and user_id = v_uid;

    if not found then
      raise exception 'Signature not found';
    end if;

    if p_is_default then
      update public.mail_signatures
      set is_default = false, updated_at = now()
      where user_id = v_uid and is_default = true and id <> p_id;
    end if;

    update public.mail_signatures
    set
      name = coalesce(v_name, name),
      body_html = coalesce(v_html, body_html),
      is_default = case when p_is_default then true else is_default end,
      updated_at = now()
    where id = p_id
    returning * into v_row;
  end if;

  if v_row.is_default then
    perform public.sync_default_mail_signature(v_uid);
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'body_html', v_row.body_html,
    'is_default', v_row.is_default,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.upsert_my_mail_signature(uuid, text, text, boolean) from public;
grant execute on function public.upsert_my_mail_signature(uuid, text, text, boolean) to authenticated;

create or replace function public.delete_my_mail_signature(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_was_default boolean;
begin
  v_uid := public.current_sales_user_id();
  if v_uid is null then
    raise exception 'Not authorized';
  end if;

  select is_default into v_was_default
  from public.mail_signatures
  where id = p_id and user_id = v_uid;

  if not found then
    raise exception 'Signature not found';
  end if;

  delete from public.mail_signatures where id = p_id and user_id = v_uid;

  if v_was_default then
    update public.sales_users
    set mail_signature_html = null
    where id = v_uid;
  end if;
end;
$$;

revoke all on function public.delete_my_mail_signature(uuid) from public;
grant execute on function public.delete_my_mail_signature(uuid) to authenticated;

create or replace function public.set_my_default_mail_signature(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_row public.mail_signatures%rowtype;
begin
  v_uid := public.current_sales_user_id();
  if v_uid is null then
    raise exception 'Not authorized';
  end if;

  select * into v_row
  from public.mail_signatures
  where id = p_id and user_id = v_uid;

  if not found then
    raise exception 'Signature not found';
  end if;

  update public.mail_signatures
  set is_default = false, updated_at = now()
  where user_id = v_uid and is_default = true;

  update public.mail_signatures
  set is_default = true, updated_at = now()
  where id = p_id
  returning * into v_row;

  perform public.sync_default_mail_signature(v_uid);

  return jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'body_html', v_row.body_html,
    'is_default', v_row.is_default,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.set_my_default_mail_signature(uuid) from public;
grant execute on function public.set_my_default_mail_signature(uuid) to authenticated;
