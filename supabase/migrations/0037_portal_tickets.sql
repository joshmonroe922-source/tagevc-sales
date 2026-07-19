-- Portal ticketing (in-app helpdesk)
-- Shared-services queues + diagnostic page-context capture.
-- Run on hqmobgtnedmhzipusert after 0036.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.ticket_queue_portal_slug(p_category text)
returns text
language sql
immutable
as $$
  select case p_category
    when 'technology' then 'technology'
    when 'legal' then 'legal'
    when 'accounting-finance' then 'accounting-finance'
    when 'marketing' then 'marketing'
    when 'human-resources' then 'human-resources'
    else null
  end;
$$;

-- True if current user can manage tickets in this queue category.
create or replace function public.user_can_manage_ticket_category(p_category text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_active_sales_user()
    and (
      public.sales_user_role() = 'admin'
      or (
        p_category = 'admin'
        and public.sales_user_role() = 'admin'
      )
      or (
        public.ticket_queue_portal_slug(p_category) is not null
        and public.user_has_portal(public.ticket_queue_portal_slug(p_category))
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- portal_tickets
-- ---------------------------------------------------------------------------
create sequence if not exists public.portal_ticket_number_seq start 1001;

create table if not exists public.portal_tickets (
  id                uuid primary key default gen_random_uuid(),
  ticket_number     int not null default nextval('public.portal_ticket_number_seq') unique,
  title             text not null,
  description       text not null default '',
  -- technology | legal | accounting-finance | marketing | human-resources | admin
  category          text not null
    check (category in (
      'technology',
      'legal',
      'accounting-finance',
      'marketing',
      'human-resources',
      'admin'
    )),
  -- open → in_progress → waiting → resolved → closed
  status            text not null default 'open'
    check (status in ('open', 'in_progress', 'waiting', 'resolved', 'closed')),
  priority          text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  created_by        uuid not null references public.sales_users (id) on delete restrict,
  assignee_id       uuid references public.sales_users (id) on delete set null,
  -- Diagnostic page context captured at create (route, viewport, UA, …)
  diagnostic_context jsonb not null default '{}'::jsonb,
  assignee_has_unread boolean not null default false,
  creator_has_unread  boolean not null default false,
  resolved_at       timestamptz,
  closed_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists portal_tickets_category_status_idx
  on public.portal_tickets (category, status, updated_at desc);

create index if not exists portal_tickets_created_by_idx
  on public.portal_tickets (created_by, updated_at desc);

create index if not exists portal_tickets_assignee_idx
  on public.portal_tickets (assignee_id, updated_at desc)
  where assignee_id is not null;

create index if not exists portal_tickets_status_idx
  on public.portal_tickets (status, updated_at desc);

alter table public.portal_tickets enable row level security;

drop policy if exists "portal_tickets_select" on public.portal_tickets;
create policy "portal_tickets_select"
  on public.portal_tickets for select
  using (
    public.is_active_sales_user()
    and (
      created_by = public.current_sales_user_id()
      or assignee_id = public.current_sales_user_id()
      or public.user_can_manage_ticket_category(category)
    )
  );

drop policy if exists "portal_tickets_insert" on public.portal_tickets;
create policy "portal_tickets_insert"
  on public.portal_tickets for insert
  with check (
    public.is_active_sales_user()
    and created_by = public.current_sales_user_id()
  );

drop policy if exists "portal_tickets_update" on public.portal_tickets;
create policy "portal_tickets_update"
  on public.portal_tickets for update
  using (
    public.is_active_sales_user()
    and (
      created_by = public.current_sales_user_id()
      or assignee_id = public.current_sales_user_id()
      or public.user_can_manage_ticket_category(category)
    )
  )
  with check (
    public.is_active_sales_user()
    and (
      created_by = public.current_sales_user_id()
      or assignee_id = public.current_sales_user_id()
      or public.user_can_manage_ticket_category(category)
    )
  );

-- Soft delete not needed; managers rarely delete. Restrict delete to admins.
drop policy if exists "portal_tickets_delete" on public.portal_tickets;
create policy "portal_tickets_delete"
  on public.portal_tickets for delete
  using (
    public.is_active_sales_user()
    and public.sales_user_role() = 'admin'
  );

-- True if current user can view this ticket (creator, assignee, or queue manager).
create or replace function public.user_can_view_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.portal_tickets t
    where t.id = p_ticket_id
      and public.is_active_sales_user()
      and (
        t.created_by = public.current_sales_user_id()
        or t.assignee_id = public.current_sales_user_id()
        or public.user_can_manage_ticket_category(t.category)
      )
  );
$$;

create or replace function public.touch_portal_ticket_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if new.status = 'resolved' and (old.status is distinct from 'resolved') then
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;
  if new.status = 'closed' and (old.status is distinct from 'closed') then
    new.closed_at := coalesce(new.closed_at, now());
  end if;
  if new.status not in ('resolved', 'closed') then
    new.resolved_at := null;
    new.closed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists portal_tickets_touch on public.portal_tickets;
create trigger portal_tickets_touch
  before update on public.portal_tickets
  for each row execute function public.touch_portal_ticket_updated_at();

-- ---------------------------------------------------------------------------
-- portal_ticket_comments
-- ---------------------------------------------------------------------------
create table if not exists public.portal_ticket_comments (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.portal_tickets (id) on delete cascade,
  author_id   uuid not null references public.sales_users (id) on delete restrict,
  body        text not null,
  is_internal boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists portal_ticket_comments_ticket_idx
  on public.portal_ticket_comments (ticket_id, created_at);

alter table public.portal_ticket_comments enable row level security;

drop policy if exists "portal_ticket_comments_select" on public.portal_ticket_comments;
create policy "portal_ticket_comments_select"
  on public.portal_ticket_comments for select
  using (
    public.user_can_view_ticket(ticket_id)
    and (
      is_internal = false
      or public.user_can_manage_ticket_category(
        (select t.category from public.portal_tickets t where t.id = ticket_id)
      )
    )
  );

drop policy if exists "portal_ticket_comments_insert" on public.portal_ticket_comments;
create policy "portal_ticket_comments_insert"
  on public.portal_ticket_comments for insert
  with check (
    public.user_can_view_ticket(ticket_id)
    and author_id = public.current_sales_user_id()
    and (
      is_internal = false
      or public.user_can_manage_ticket_category(
        (select t.category from public.portal_tickets t where t.id = ticket_id)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- portal_ticket_attachments
-- ---------------------------------------------------------------------------
create table if not exists public.portal_ticket_attachments (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     uuid not null references public.portal_tickets (id) on delete cascade,
  comment_id    uuid references public.portal_ticket_comments (id) on delete set null,
  uploaded_by   uuid not null references public.sales_users (id) on delete restrict,
  -- page_snapshot | upload | other
  kind          text not null default 'upload'
    check (kind in ('page_snapshot', 'upload', 'other')),
  file_name     text not null,
  mime_type     text not null default 'application/octet-stream',
  byte_size     int not null default 0,
  storage_path  text not null,
  created_at    timestamptz not null default now()
);

create index if not exists portal_ticket_attachments_ticket_idx
  on public.portal_ticket_attachments (ticket_id, created_at);

alter table public.portal_ticket_attachments enable row level security;

drop policy if exists "portal_ticket_attachments_select" on public.portal_ticket_attachments;
create policy "portal_ticket_attachments_select"
  on public.portal_ticket_attachments for select
  using (public.user_can_view_ticket(ticket_id));

drop policy if exists "portal_ticket_attachments_insert" on public.portal_ticket_attachments;
create policy "portal_ticket_attachments_insert"
  on public.portal_ticket_attachments for insert
  with check (
    public.user_can_view_ticket(ticket_id)
    and uploaded_by = public.current_sales_user_id()
  );

drop policy if exists "portal_ticket_attachments_delete" on public.portal_ticket_attachments;
create policy "portal_ticket_attachments_delete"
  on public.portal_ticket_attachments for delete
  using (
    public.user_can_view_ticket(ticket_id)
    and (
      uploaded_by = public.current_sales_user_id()
      or public.sales_user_role() = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- Storage: ticket-attachments (private)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ticket-attachments',
  'ticket-attachments',
  false,
  52428800,
  null
)
on conflict (id) do nothing;

drop policy if exists "Ticket attachments read" on storage.objects;
create policy "Ticket attachments read"
  on storage.objects for select
  using (
    bucket_id = 'ticket-attachments'
    and public.is_active_sales_user()
  );

drop policy if exists "Ticket attachments upload" on storage.objects;
create policy "Ticket attachments upload"
  on storage.objects for insert
  with check (
    bucket_id = 'ticket-attachments'
    and public.is_active_sales_user()
  );

drop policy if exists "Ticket attachments update" on storage.objects;
create policy "Ticket attachments update"
  on storage.objects for update
  using (
    bucket_id = 'ticket-attachments'
    and public.is_active_sales_user()
  );

drop policy if exists "Ticket attachments delete" on storage.objects;
create policy "Ticket attachments delete"
  on storage.objects for delete
  using (
    bucket_id = 'ticket-attachments'
    and public.is_active_sales_user()
  );

-- ---------------------------------------------------------------------------
-- Mark ticket read (clears unread flag for caller)
-- ---------------------------------------------------------------------------
create or replace function public.mark_portal_ticket_read(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.current_sales_user_id();
  t public.portal_tickets%rowtype;
begin
  if not public.user_can_view_ticket(p_ticket_id) then
    raise exception 'not allowed';
  end if;
  select * into t from public.portal_tickets where id = p_ticket_id;
  if not found then
    return;
  end if;
  if t.created_by = uid then
    update public.portal_tickets
      set creator_has_unread = false
      where id = p_ticket_id;
  end if;
  if t.assignee_id = uid or public.user_can_manage_ticket_category(t.category) then
    update public.portal_tickets
      set assignee_has_unread = false
      where id = p_ticket_id;
  end if;
end;
$$;

grant execute on function public.mark_portal_ticket_read(uuid) to authenticated;
grant execute on function public.user_can_manage_ticket_category(text) to authenticated;
grant execute on function public.user_can_view_ticket(uuid) to authenticated;
