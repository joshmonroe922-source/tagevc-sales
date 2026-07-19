-- Marketing audit: evidence columns, due-date seed, mark-reviewed roll-forward, task due sync.
-- Aligns with shared pattern in 0030_audit_evidence_and_review.sql:
--   cadence = review frequency (do NOT add review_frequency column)
--   evidence_storage_path / evidence_file_name / evidence_mime_type
-- No Secretary of State automation.
-- Run after 0030 on hqmobgtnedmhzipusert.

-- Evidence columns (idempotent if 0030 already added them)
alter table public.marketing_controls
  add column if not exists evidence_storage_path text not null default '';

alter table public.marketing_controls
  add column if not exists evidence_file_name text not null default '';

alter table public.marketing_controls
  add column if not exists evidence_mime_type text not null default '';

-- Drop marketing-only review_frequency if an earlier draft added it
do $mkt$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'marketing_controls'
      and column_name = 'review_frequency'
  ) then
    alter table public.marketing_controls drop column review_frequency;
  end if;
end $mkt$;

-- Seed next_due_at when missing (per row — parent vs entity already distinct)
update public.marketing_controls c
set next_due_at = public.default_next_due_for_cadence(c.cadence)
where c.active = true
  and c.next_due_at is null
  and c.cadence <> 'custom';

-- Align open task dues
update public.marketing_tasks t
set due_at = c.next_due_at,
    updated_at = now()
from public.marketing_controls c
where t.control_id = c.id
  and t.status = 'open'
  and c.next_due_at is not null
  and (t.due_at is distinct from c.next_due_at);

-- Mark reviewed → roll next_due_at by cadence; close open tasks
create or replace function public.mark_marketing_control_reviewed(
  p_control_id uuid,
  p_reviewed_by uuid default null
)
returns public.marketing_controls
language plpgsql
security definer
set search_path = public
as $mkt$
declare
  rec public.marketing_controls;
  reviewed date := current_date;
  base date;
  next_due date;
begin
  select * into rec
  from public.marketing_controls
  where id = p_control_id and active = true
  for update;

  if not found then
    raise exception 'marketing control not found';
  end if;

  base := greatest(coalesce(rec.next_due_at, reviewed), reviewed);
  if rec.cadence = 'one_time' then
    next_due := null;
  else
    next_due := public.advance_due_by_cadence(base, rec.cadence);
  end if;

  update public.marketing_controls
  set
    last_reviewed_at = reviewed,
    next_due_at = next_due,
    status = 'compliant',
    updated_at = now()
  where id = p_control_id
  returning * into rec;

  update public.marketing_tasks
  set status = 'done',
      notes = case
        when notes = '' then 'Closed on review ' || reviewed::text
        else notes || E'\nClosed on review ' || reviewed::text
      end,
      updated_at = now()
  where control_id = p_control_id
    and status = 'open';

  return rec;
end;
$mkt$;

grant execute on function public.mark_marketing_control_reviewed(uuid, uuid) to authenticated;

-- Keep open marketing_tasks.due_at aligned when next_due_at changes
create or replace function public.trg_marketing_control_sync_task_due()
returns trigger
language plpgsql
security definer
set search_path = public
as $mkt$
begin
  if new.next_due_at is distinct from old.next_due_at then
    update public.marketing_tasks
    set due_at = new.next_due_at,
        updated_at = now()
    where control_id = new.id
      and status = 'open';
  end if;
  return new;
end;
$mkt$;

drop trigger if exists marketing_controls_sync_task_due on public.marketing_controls;
create trigger marketing_controls_sync_task_due
  after update of next_due_at on public.marketing_controls
  for each row execute function public.trg_marketing_control_sync_task_due();

-- Tasks for incomplete: reopen due compliant rows, sync dues, create missing
create or replace function public.create_marketing_tasks_for_incomplete(p_created_by uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $mkt$
declare
  inserted integer := 0;
begin
  update public.marketing_controls
  set status = 'open',
      updated_at = now()
  where active = true
    and status = 'compliant'
    and next_due_at is not null
    and next_due_at <= current_date;

  update public.marketing_tasks t
  set due_at = c.next_due_at,
      updated_at = now()
  from public.marketing_controls c
  where t.control_id = c.id
    and t.status = 'open'
    and (t.due_at is distinct from c.next_due_at);

  insert into public.marketing_tasks (control_id, title, status, due_at, notes, created_by)
  select
    c.id,
    'Marketing: ' || c.title,
    'open',
    c.next_due_at,
    coalesce(nullif(c.area, ''), 'Marketing')
      || ' · ' || coalesce(nullif(c.control_key, ''), 'control')
      || case when c.next_due_at is not null then ' · due ' || c.next_due_at::text else '' end,
    p_created_by
  from public.marketing_controls c
  where c.active = true
    and c.status in ('open', 'in_progress', 'gap')
    and not exists (
      select 1 from public.marketing_tasks t
      where t.control_id = c.id and t.status = 'open'
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$mkt$;

grant execute on function public.create_marketing_tasks_for_incomplete(uuid) to authenticated;

-- Stamp default next_due_at when provisioning new entity / parent rows
create or replace function public.provision_marketing_controls_for_entity(p_entity_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $mkt$
declare
  inserted integer := 0;
begin
  insert into public.marketing_controls (
    entity_id, control_key, title, description, area, document_kind,
    evidence_expectation, source, cadence, owner_role,
    applies_to_parent, applies_to_entities, status, notes, next_due_at
  )
  select
    p_entity_id,
    t.control_key,
    t.title,
    t.description,
    t.area,
    t.document_kind,
    t.evidence_expectation,
    t.source,
    t.cadence,
    t.owner_role,
    t.applies_to_parent,
    t.applies_to_entities,
    'open',
    'Auto-provisioned for new entity from marketing control templates',
    public.default_next_due_for_cadence(t.cadence)
  from public.marketing_control_templates t
  where t.applies_to_entities = true
    and not exists (
      select 1 from public.marketing_controls c
      where c.control_key = t.control_key
        and c.entity_id = p_entity_id
        and c.active = true
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$mkt$;

create or replace function public.provision_marketing_controls_for_parent()
returns integer
language plpgsql
security definer
set search_path = public
as $mkt$
declare
  inserted integer := 0;
begin
  insert into public.marketing_controls (
    entity_id, control_key, title, description, area, document_kind,
    evidence_expectation, source, cadence, owner_role,
    applies_to_parent, applies_to_entities, status, notes, next_due_at
  )
  select
    null,
    t.control_key,
    t.title,
    t.description,
    t.area,
    t.document_kind,
    t.evidence_expectation,
    t.source,
    t.cadence,
    t.owner_role,
    t.applies_to_parent,
    t.applies_to_entities,
    'open',
    'Seeded from Marketing Plan and Audit',
    public.default_next_due_for_cadence(t.cadence)
  from public.marketing_control_templates t
  where t.applies_to_parent = true
    and not exists (
      select 1 from public.marketing_controls c
      where c.control_key = t.control_key
        and c.entity_id is null
        and c.active = true
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$mkt$;

comment on column public.marketing_controls.cadence is
  'Review frequency (aligned across audit portals; annual default).';
comment on column public.marketing_controls.next_due_at is
  'Next review due — set per parent/entity independently.';
comment on column public.marketing_controls.evidence_storage_path is
  'Path in storage.buckets audit-evidence (marketing/{control_id}/…).';
