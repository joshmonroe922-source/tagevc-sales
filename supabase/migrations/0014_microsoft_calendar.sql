-- Microsoft 365 / Outlook calendar (per-user Graph OAuth)
-- Tokens are service-role only; clients never read refresh/access tokens.

-- ---------------------------------------------------------------------------
-- work_email on sales_users (may differ from portal login email)
-- ---------------------------------------------------------------------------
alter table public.sales_users
  add column if not exists work_email text;

comment on column public.sales_users.work_email is
  'Microsoft 365 mailbox for calendar OAuth (login_hint). Falls back to email when null.';

create index if not exists sales_users_work_email_lower_idx
  on public.sales_users (lower(work_email))
  where work_email is not null;

-- Seed: portal login already on tagevc.com → use as work mailbox
update public.sales_users
set work_email = lower(email)
where work_email is null
  and lower(email) like '%@tagevc.com'
  and coalesce(is_house_account, false) = false;

-- ---------------------------------------------------------------------------
-- microsoft_calendar_connections — one row per sales user
-- ---------------------------------------------------------------------------
create table if not exists public.microsoft_calendar_connections (
  id                    uuid primary key default gen_random_uuid(),
  sales_user_id         uuid not null unique
                          references public.sales_users (id) on delete cascade,
  microsoft_email       text,
  microsoft_user_id     text,
  -- Encrypted blobs (AES-GCM via edge MS_TOKEN_ENCRYPTION_KEY). Never expose to client.
  access_token_enc      text,
  refresh_token_enc     text,
  token_expires_at      timestamptz,
  scopes                text not null default '',
  connected_at          timestamptz,
  last_synced_at        timestamptz,
  last_error            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists microsoft_calendar_connections_user_idx
  on public.microsoft_calendar_connections (sales_user_id);

comment on table public.microsoft_calendar_connections is
  'Per-user Microsoft Graph calendar OAuth. Token columns are edge/service-role only.';

alter table public.microsoft_calendar_connections enable row level security;

-- No client policies on token table: edge functions use service role.
-- Status/events are returned via edge functions only.

-- ---------------------------------------------------------------------------
-- OAuth CSRF state (short-lived)
-- ---------------------------------------------------------------------------
create table if not exists public.microsoft_oauth_states (
  id            uuid primary key default gen_random_uuid(),
  sales_user_id uuid not null references public.sales_users (id) on delete cascade,
  state_token   text not null unique,
  redirect_path text not null default '/sales/calendar',
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);

create index if not exists microsoft_oauth_states_token_idx
  on public.microsoft_oauth_states (state_token);
create index if not exists microsoft_oauth_states_expires_idx
  on public.microsoft_oauth_states (expires_at);

alter table public.microsoft_oauth_states enable row level security;

-- ---------------------------------------------------------------------------
-- Safe RPC: current user may set their own work_email only
-- ---------------------------------------------------------------------------
create or replace function public.set_my_work_email(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_email text;
begin
  v_uid := public.current_sales_user_id();
  if v_uid is null then
    raise exception 'Not authorized';
  end if;

  v_email := nullif(lower(trim(coalesce(p_email, ''))), '');
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid email';
  end if;

  update public.sales_users
  set work_email = v_email
  where id = v_uid;

  return v_email;
end;
$$;

revoke all on function public.set_my_work_email(text) from public;
grant execute on function public.set_my_work_email(text) to authenticated;

-- Admins may set work_email for any user (uses existing admin manage policy on sales_users).
