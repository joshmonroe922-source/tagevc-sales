-- Audit event log (v1)
-- All active sales users (including Josh/admins) insert their own events.
-- SELECT: admins see all non-protected actors; protected actors (Josh allowlist)
-- only the actor themselves can read those rows. No update/delete for clients.

-- ---------------------------------------------------------------------------
-- audit_events
-- ---------------------------------------------------------------------------
create table if not exists public.audit_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.sales_users (id) on delete set null,
  email        text,
  event_type   text not null,
  path         text,
  metadata     jsonb not null default '{}'::jsonb,
  -- Denormalized flag so RLS can filter without joining; set on insert.
  actor_protected boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint audit_events_event_type_len check (char_length(event_type) between 1 and 80)
);

create index if not exists audit_events_created_at_idx
  on public.audit_events (created_at desc);

create index if not exists audit_events_user_id_idx
  on public.audit_events (user_id, created_at desc);

create index if not exists audit_events_event_type_idx
  on public.audit_events (event_type, created_at desc);

create index if not exists audit_events_email_idx
  on public.audit_events (lower(email), created_at desc);

create index if not exists audit_events_actor_protected_idx
  on public.audit_events (actor_protected, created_at desc);

comment on table public.audit_events is
  'Activity audit for portal users. Protected-actor (Josh) rows are readable only by that actor.';

comment on column public.audit_events.actor_protected is
  'True when the actor is a protected account (Josh allowlist); only that actor may SELECT the row.';

alter table public.audit_events enable row level security;

-- ---------------------------------------------------------------------------
-- Protected-actor helpers (Josh allowlist emails)
-- ---------------------------------------------------------------------------
create or replace function public.audit_actor_is_protected(
  p_email text default null,
  p_user_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    lower(trim(coalesce(p_email, ''))) in (
      'josh@tagevc.com',
      'joshmonroe@tagevc.com',
      'joshmonroe922@gmail.com'
      -- hello@tagevc.com is shared / house-facing; not treated as Josh-private
    )
    or exists (
      select 1
      from public.sales_users su
      where p_user_id is not null
        and su.id = p_user_id
        and lower(su.email) in (
          'josh@tagevc.com',
          'joshmonroe@tagevc.com',
          'joshmonroe922@gmail.com'
        )
    );
$$;

create or replace function public.current_audit_actor_is_protected()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.audit_actor_is_protected(
    auth.jwt() ->> 'email',
    public.current_sales_user_id()
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- INSERT: any active sales user may insert only as themselves.
-- actor_protected must match whether the actor is protected (prevents spoofing visibility).
create policy "Sales users insert own audit events"
  on public.audit_events for insert
  to authenticated
  with check (
    public.is_active_sales_user()
    and (
      user_id is null
      or user_id = public.current_sales_user_id()
    )
    and (
      email is null
      or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
    and actor_protected = public.audit_actor_is_protected(
      coalesce(email, auth.jwt() ->> 'email'),
      coalesce(user_id, public.current_sales_user_id())
    )
  );

-- SELECT:
-- 1) Protected rows: only the protected actor themselves (Josh).
-- 2) Non-protected rows: any admin.
create policy "Admins read non-protected audit events"
  on public.audit_events for select
  using (
    public.is_active_sales_user()
    and public.sales_user_role() = 'admin'
    and actor_protected = false
  );

create policy "Protected actors read own audit events"
  on public.audit_events for select
  using (
    public.is_active_sales_user()
    and actor_protected = true
    and public.current_audit_actor_is_protected()
    and (
      (
        user_id is not null
        and user_id = public.current_sales_user_id()
      )
      or (
        email is not null
        and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
    )
  );

-- No update/delete policies → clients cannot mutate/delete.

-- ---------------------------------------------------------------------------
-- Service-role helper for edge functions / failed login
-- ---------------------------------------------------------------------------
create or replace function public.insert_audit_event(
  p_user_id uuid,
  p_email text,
  p_event_type text,
  p_path text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_protected boolean;
begin
  v_protected := public.audit_actor_is_protected(v_email, p_user_id);

  insert into public.audit_events (
    user_id, email, event_type, path, metadata, actor_protected
  )
  values (
    p_user_id,
    v_email,
    p_event_type,
    p_path,
    coalesce(p_metadata, '{}'::jsonb),
    v_protected
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.insert_audit_event(uuid, text, text, text, jsonb) from public;
grant execute on function public.insert_audit_event(uuid, text, text, text, jsonb) to service_role;

-- Unauthenticated failed-login logging (sets actor_protected from email)
create or replace function public.log_audit_login_failed(
  p_email text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  insert into public.audit_events (
    user_id, email, event_type, path, metadata, actor_protected
  )
  values (
    null,
    v_email,
    'login_failed',
    '/sales/login',
    coalesce(p_metadata, '{}'::jsonb),
    public.audit_actor_is_protected(v_email, null)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.log_audit_login_failed(text, jsonb) from public;
grant execute on function public.log_audit_login_failed(text, jsonb) to anon, authenticated, service_role;

grant select, insert on public.audit_events to authenticated;
grant select, insert on public.audit_events to service_role;
