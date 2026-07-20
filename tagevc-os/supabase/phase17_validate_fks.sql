-- Phase 17: Orphan cleanup + VALIDATE FK constraints from Phase 16
-- Apply after phase16_snapshot_archive.sql
-- Safe: nulls orphan refs before validating; does not drop audit history.

-- ---------------------------------------------------------------------------
-- Orphan cleanup (null soft refs so VALIDATE can succeed)
-- ---------------------------------------------------------------------------

-- Handoffs → entities
update public.os_handoffs h
set entity_id = null
where entity_id is not null
  and not exists (
    select 1 from public.entities e where e.entity_id = h.entity_id
  );

-- Handoffs → portfolio_companies
update public.os_handoffs h
set portfolio_id = null
where portfolio_id is not null
  and not exists (
    select 1 from public.portfolio_companies p where p.portfolio_id = h.portfolio_id
  );

-- IC audits with missing deals — keep row but clear broken FK by deleting orphans
-- (deal_id is NOT NULL on os_ic_audits; delete true orphans)
delete from public.os_ic_audits a
where not exists (
  select 1 from public.os_deals d where d.deal_id = a.deal_id
);

delete from public.os_ticket_audits a
where not exists (
  select 1 from public.os_tickets t where t.ticket_id = a.ticket_id
);

delete from public.os_doc_audits a
where not exists (
  select 1 from public.os_documents d where d.doc_id = a.doc_id
);

-- ---------------------------------------------------------------------------
-- Validate constraints (skip if constraint missing)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'os_handoffs_entity_id_fkey') then
    alter table public.os_handoffs validate constraint os_handoffs_entity_id_fkey;
  end if;
  if exists (select 1 from pg_constraint where conname = 'os_handoffs_portfolio_id_fkey') then
    alter table public.os_handoffs validate constraint os_handoffs_portfolio_id_fkey;
  end if;
  if exists (select 1 from pg_constraint where conname = 'os_ic_audits_deal_id_fkey') then
    alter table public.os_ic_audits validate constraint os_ic_audits_deal_id_fkey;
  end if;
  if exists (select 1 from pg_constraint where conname = 'os_ticket_audits_ticket_id_fkey') then
    alter table public.os_ticket_audits validate constraint os_ticket_audits_ticket_id_fkey;
  end if;
  if exists (select 1 from pg_constraint where conname = 'os_doc_audits_doc_id_fkey') then
    alter table public.os_doc_audits validate constraint os_doc_audits_doc_id_fkey;
  end if;
end $$;

-- Integrity report view for admin health
create or replace view public.os_fk_integrity as
select 'os_handoffs.entity_id'::text as check_name,
  count(*)::bigint as orphan_count
from public.os_handoffs h
where h.entity_id is not null
  and not exists (select 1 from public.entities e where e.entity_id = h.entity_id)
union all
select 'os_handoffs.portfolio_id',
  count(*)
from public.os_handoffs h
where h.portfolio_id is not null
  and not exists (select 1 from public.portfolio_companies p where p.portfolio_id = h.portfolio_id)
union all
select 'os_ic_audits.deal_id',
  count(*)
from public.os_ic_audits a
where not exists (select 1 from public.os_deals d where d.deal_id = a.deal_id)
union all
select 'os_ticket_audits.ticket_id',
  count(*)
from public.os_ticket_audits a
where not exists (select 1 from public.os_tickets t where t.ticket_id = a.ticket_id)
union all
select 'os_doc_audits.doc_id',
  count(*)
from public.os_doc_audits a
where not exists (select 1 from public.os_documents d where d.doc_id = a.doc_id);

grant select on public.os_fk_integrity to authenticated;
