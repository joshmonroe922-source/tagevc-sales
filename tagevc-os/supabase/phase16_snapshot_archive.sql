-- Phase 16: Snapshot archive + stronger handoff/audit indexes
-- Apply after phase15_write_cutover.sql
-- Soft-archive: copy live snapshot → archive table, replace live payload with empty object.

-- ---------------------------------------------------------------------------
-- Archive table (retain historical JSONB before clearing live rows)
-- ---------------------------------------------------------------------------
create table if not exists public.os_store_snapshot_archive (
  id uuid primary key default gen_random_uuid(),
  collection text not null,
  payload jsonb not null,
  version int not null default 1,
  source_updated_at timestamptz,
  source_updated_by uuid,
  archived_at timestamptz not null default now(),
  archived_by uuid,
  note text
);

create index if not exists os_store_snapshot_archive_collection_idx
  on public.os_store_snapshot_archive (collection);
create index if not exists os_store_snapshot_archive_archived_at_idx
  on public.os_store_snapshot_archive (archived_at desc);

alter table public.os_store_snapshot_archive enable row level security;

drop policy if exists "os_store_snapshot_archive_authenticated_select"
  on public.os_store_snapshot_archive;
create policy "os_store_snapshot_archive_authenticated_select"
  on public.os_store_snapshot_archive for select to authenticated using (true);

drop policy if exists "os_store_snapshot_archive_authenticated_write"
  on public.os_store_snapshot_archive;
create policy "os_store_snapshot_archive_authenticated_write"
  on public.os_store_snapshot_archive for all to authenticated
  using (true) with check (true);

grant select, insert, update, delete on public.os_store_snapshot_archive to authenticated;

-- Soft-archive one collection: copy → clear live payload to {}
create or replace function public.archive_store_snapshot(
  p_collection text,
  p_note text default null,
  p_archived_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  live record;
  archived_id uuid;
begin
  select collection, payload, version, updated_at, updated_by
    into live
  from public.os_store_snapshots
  where collection = p_collection
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'collection_not_found',
      'collection', p_collection
    );
  end if;

  -- Skip if already empty object
  if live.payload = '{}'::jsonb then
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'already_empty',
      'collection', p_collection
    );
  end if;

  insert into public.os_store_snapshot_archive (
    collection, payload, version, source_updated_at, source_updated_by,
    archived_by, note
  ) values (
    live.collection, live.payload, live.version, live.updated_at, live.updated_by,
    p_archived_by, p_note
  )
  returning id into archived_id;

  update public.os_store_snapshots
  set
    payload = '{}'::jsonb,
    updated_at = now(),
    updated_by = p_archived_by
  where collection = p_collection;

  return jsonb_build_object(
    'ok', true,
    'collection', p_collection,
    'archive_id', archived_id,
    'archived_at', now()
  );
end;
$$;

grant execute on function public.archive_store_snapshot(text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Stronger indexes for handoffs / audits (relationship readiness)
-- ---------------------------------------------------------------------------
create index if not exists os_handoffs_entity_id_idx
  on public.os_handoffs (entity_id) where entity_id is not null;
create index if not exists os_handoffs_portfolio_id_idx
  on public.os_handoffs (portfolio_id) where portfolio_id is not null;
create index if not exists os_handoffs_track_source_idx
  on public.os_handoffs (track, source_id);

create index if not exists os_ic_audits_deal_ic_idx
  on public.os_ic_audits (deal_id, ic_id);

-- Optional FK constraints as NOT VALID (validate later after orphan cleanup)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'os_handoffs_entity_id_fkey'
  ) then
    begin
      alter table public.os_handoffs
        add constraint os_handoffs_entity_id_fkey
        foreign key (entity_id) references public.entities (entity_id)
        not valid;
    exception when others then
      raise notice 'os_handoffs_entity_id_fkey skipped: %', sqlerrm;
    end;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'os_handoffs_portfolio_id_fkey'
  ) then
    begin
      alter table public.os_handoffs
        add constraint os_handoffs_portfolio_id_fkey
        foreign key (portfolio_id) references public.portfolio_companies (portfolio_id)
        not valid;
    exception when others then
      raise notice 'os_handoffs_portfolio_id_fkey skipped: %', sqlerrm;
    end;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'os_ic_audits_deal_id_fkey'
  ) then
    begin
      alter table public.os_ic_audits
        add constraint os_ic_audits_deal_id_fkey
        foreign key (deal_id) references public.os_deals (deal_id)
        not valid;
    exception when others then
      raise notice 'os_ic_audits_deal_id_fkey skipped: %', sqlerrm;
    end;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'os_ticket_audits_ticket_id_fkey'
  ) then
    begin
      alter table public.os_ticket_audits
        add constraint os_ticket_audits_ticket_id_fkey
        foreign key (ticket_id) references public.os_tickets (ticket_id)
        not valid;
    exception when others then
      raise notice 'os_ticket_audits_ticket_id_fkey skipped: %', sqlerrm;
    end;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'os_doc_audits_doc_id_fkey'
  ) then
    begin
      alter table public.os_doc_audits
        add constraint os_doc_audits_doc_id_fkey
        foreign key (doc_id) references public.os_documents (doc_id)
        not valid;
    exception when others then
      raise notice 'os_doc_audits_doc_id_fkey skipped: %', sqlerrm;
    end;
  end if;
end $$;

-- Refresh counts view with archive
create or replace view public.os_normalization_counts as
select 'entities'::text as domain, count(*)::bigint as row_count from public.entities
union all
select 'portfolio_companies', count(*) from public.portfolio_companies
union all
select 'entity_month_pnl', count(*) from public.entity_month_pnl
union all
select 'entity_month_kpi', count(*) from public.entity_month_kpi
union all
select 'entity_month_kpi_flex', count(*) from public.entity_month_kpi_flex
union all
select 'os_leads', count(*) from public.os_leads
union all
select 'os_lead_tasks', count(*) from public.os_lead_tasks
union all
select 'os_tickets', count(*) from public.os_tickets
union all
select 'os_deals', count(*) from public.os_deals
union all
select 'os_deal_tasks', count(*) from public.os_deal_tasks
union all
select 'os_documents', count(*) from public.os_documents
union all
select 'os_ic_reviews', count(*) from public.os_ic_reviews
union all
select 'os_ma_targets', count(*) from public.os_ma_targets
union all
select 'os_ma_tasks', count(*) from public.os_ma_tasks
union all
select 'os_re_deals', count(*) from public.os_re_deals
union all
select 'os_re_tasks', count(*) from public.os_re_tasks
union all
select 'os_handoffs', count(*) from public.os_handoffs
union all
select 'os_ic_audits', count(*) from public.os_ic_audits
union all
select 'os_ticket_audits', count(*) from public.os_ticket_audits
union all
select 'os_doc_audits', count(*) from public.os_doc_audits
union all
select 'os_store_snapshots', count(*) from public.os_store_snapshots
union all
select 'os_store_snapshot_archive', count(*) from public.os_store_snapshot_archive;

grant select on public.os_normalization_counts to authenticated;
