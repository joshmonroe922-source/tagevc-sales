-- Multi-portal ticketing: source portal / entity / subsidiary sync hooks.
-- Run after 0044_recruit619_kpi_hierarchy.sql.
-- Extends 0037_portal_tickets (attachments bucket already exists).

-- ---------------------------------------------------------------------------
-- Source portal catalog (Tage hub + subsidiary sales platforms)
-- ---------------------------------------------------------------------------
-- Values are free-text with a recommended set (enforced lightly via check):
--   tage | recruit619-desk | instant-nda | signent | other

alter table public.portal_tickets
  add column if not exists source_portal text not null default 'tage';

alter table public.portal_tickets
  drop constraint if exists portal_tickets_source_portal_check;

alter table public.portal_tickets
  add constraint portal_tickets_source_portal_check
  check (source_portal in (
    'tage',
    'recruit619-desk',
    'instant-nda',
    'signent',
    'other'
  ));

-- Portfolio entity this ticket is about (Recruit 619, Instant NDA, …)
alter table public.portal_tickets
  add column if not exists entity_id uuid
    references public.ops_entities (id) on delete set null;

-- How the ticket entered Tage
alter table public.portal_tickets
  add column if not exists created_via text not null default 'portal_ui';

alter table public.portal_tickets
  drop constraint if exists portal_tickets_created_via_check;

alter table public.portal_tickets
  add constraint portal_tickets_created_via_check
  check (created_via in ('portal_ui', 'subsidiary_api', 'system'));

-- Subsidiary-side identity (for round-trip sync)
alter table public.portal_tickets
  add column if not exists external_id text;

alter table public.portal_tickets
  add column if not exists external_url text;

alter table public.portal_tickets
  add column if not exists sync_status text not null default 'local_only';

alter table public.portal_tickets
  drop constraint if exists portal_tickets_sync_status_check;

alter table public.portal_tickets
  add constraint portal_tickets_sync_status_check
  check (sync_status in ('local_only', 'pending', 'synced', 'error'));

alter table public.portal_tickets
  add column if not exists last_synced_at timestamptz;

alter table public.portal_tickets
  add column if not exists sync_error text;

-- Outbound webhook / poll cursor payload for subsidiaries (opaque JSON)
alter table public.portal_tickets
  add column if not exists sync_meta jsonb not null default '{}'::jsonb;

create index if not exists portal_tickets_source_portal_idx
  on public.portal_tickets (source_portal, updated_at desc);

create index if not exists portal_tickets_entity_id_idx
  on public.portal_tickets (entity_id, updated_at desc)
  where entity_id is not null;

create unique index if not exists portal_tickets_source_external_uidx
  on public.portal_tickets (source_portal, external_id)
  where external_id is not null;

-- ---------------------------------------------------------------------------
-- Sync event log (status/comment changes visible to subsidiaries)
-- ---------------------------------------------------------------------------
create table if not exists public.portal_ticket_sync_events (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     uuid not null references public.portal_tickets (id) on delete cascade,
  event_type    text not null
    check (event_type in (
      'created',
      'status_changed',
      'comment_added',
      'attachment_added',
      'assigned',
      'synced_ack',
      'sync_error'
    )),
  payload       jsonb not null default '{}'::jsonb,
  -- pending = waiting for subsidiary pull/webhook delivery
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'delivered', 'skipped', 'error')),
  created_at    timestamptz not null default now()
);

create index if not exists portal_ticket_sync_events_ticket_idx
  on public.portal_ticket_sync_events (ticket_id, created_at desc);

create index if not exists portal_ticket_sync_events_pending_idx
  on public.portal_ticket_sync_events (delivery_status, created_at)
  where delivery_status = 'pending';

alter table public.portal_ticket_sync_events enable row level security;

drop policy if exists "portal_ticket_sync_events_select" on public.portal_ticket_sync_events;
create policy "portal_ticket_sync_events_select"
  on public.portal_ticket_sync_events for select
  using (public.user_can_view_ticket(ticket_id));

-- Inserts come from service role / triggers — authenticated users read only.
drop policy if exists "portal_ticket_sync_events_insert" on public.portal_ticket_sync_events;
create policy "portal_ticket_sync_events_insert"
  on public.portal_ticket_sync_events for insert
  with check (
    public.user_can_view_ticket(ticket_id)
    and public.sales_user_role() = 'admin'
  );

-- ---------------------------------------------------------------------------
-- Emit sync events on status change (for subsidiary visibility)
-- ---------------------------------------------------------------------------
create or replace function public.portal_ticket_emit_sync_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only emit for tickets that originated outside Tage or opted into sync
  if new.source_portal = 'tage' and new.sync_status = 'local_only' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    insert into public.portal_ticket_sync_events (ticket_id, event_type, payload)
    values (
      new.id,
      'created',
      jsonb_build_object(
        'ticket_number', new.ticket_number,
        'status', new.status,
        'source_portal', new.source_portal,
        'external_id', new.external_id
      )
    );
    return null;
  end if;

  if old.status is distinct from new.status then
    insert into public.portal_ticket_sync_events (ticket_id, event_type, payload)
    values (
      new.id,
      'status_changed',
      jsonb_build_object(
        'from', old.status,
        'to', new.status,
        'ticket_number', new.ticket_number,
        'external_id', new.external_id
      )
    );
    if new.sync_status = 'synced' then
      update public.portal_tickets
        set sync_status = 'pending'
        where id = new.id;
    end if;
  end if;

  if old.assignee_id is distinct from new.assignee_id then
    insert into public.portal_ticket_sync_events (ticket_id, event_type, payload)
    values (
      new.id,
      'assigned',
      jsonb_build_object(
        'assignee_id', new.assignee_id,
        'external_id', new.external_id
      )
    );
  end if;

  return null;
end;
$$;

drop trigger if exists portal_tickets_sync_emit on public.portal_tickets;
create trigger portal_tickets_sync_emit
  after insert or update of status, assignee_id on public.portal_tickets
  for each row execute function public.portal_ticket_emit_sync_event();

-- Comment add → sync event (non-internal only)
create or replace function public.portal_ticket_comment_emit_sync_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.portal_tickets%rowtype;
begin
  select * into t from public.portal_tickets where id = new.ticket_id;
  if not found then
    return new;
  end if;
  if t.source_portal = 'tage' and t.sync_status = 'local_only' then
    return new;
  end if;
  if new.is_internal then
    return new;
  end if;

  insert into public.portal_ticket_sync_events (ticket_id, event_type, payload)
  values (
    new.ticket_id,
    'comment_added',
    jsonb_build_object(
      'comment_id', new.id,
      'body', left(new.body, 4000),
      'author_id', new.author_id,
      'external_id', t.external_id
    )
  );

  update public.portal_tickets
    set sync_status = case
      when sync_status = 'local_only' then 'local_only'
      else 'pending'
    end,
    updated_at = now()
    where id = new.ticket_id;

  return new;
end;
$$;

drop trigger if exists portal_ticket_comments_sync_emit on public.portal_ticket_comments;
create trigger portal_ticket_comments_sync_emit
  after insert on public.portal_ticket_comments
  for each row execute function public.portal_ticket_comment_emit_sync_event();
