-- Technology audit: due-date seed, mark-reviewed roll-forward, task due sync.
-- Aligns with 0030_audit_evidence_and_review.sql (cadence = review frequency;
-- evidence_storage_path / evidence_file_name / evidence_mime_type already added there).
-- Do NOT add a separate review_frequency column.
-- No Secretary of State automation.

-- ---------------------------------------------------------------------------
-- Seed next_due_at where missing (per control / per entity or parent)
-- ---------------------------------------------------------------------------
update public.technology_controls c
set next_due_at = public.default_next_due_for_cadence(c.cadence)
where c.active = true
  and c.next_due_at is null
  and c.cadence <> 'custom';

-- Keep open task due dates in sync with controls
update public.technology_tasks t
set due_at = c.next_due_at,
    updated_at = now()
from public.technology_controls c
where t.control_id = c.id
  and t.status = 'open'
  and c.next_due_at is not null
  and (t.due_at is distinct from c.next_due_at);

-- ---------------------------------------------------------------------------
-- Mark reviewed → roll next_due_at by cadence; close open tasks
-- ---------------------------------------------------------------------------
create or replace function public.mark_technology_control_reviewed(
  p_control_id uuid,
  p_reviewed_by uuid default null
)
returns public.technology_controls
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.technology_controls;
  reviewed date := current_date;
  base date;
  next_due date;
begin
  select * into rec
  from public.technology_controls
  where id = p_control_id and active = true
  for update;

  if not found then
    raise exception 'technology control not found';
  end if;

  -- Roll from the later of prior due / review date so overdue items don't stick
  base := greatest(coalesce(rec.next_due_at, reviewed), reviewed);
  if rec.cadence = 'one_time' then
    next_due := null;
  else
    next_due := public.advance_due_by_cadence(base, rec.cadence);
  end if;

  update public.technology_controls
  set
    last_reviewed_at = reviewed,
    next_due_at = next_due,
    status = 'compliant',
    updated_at = now()
  where id = p_control_id
  returning * into rec;

  update public.technology_tasks
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
$$;

grant execute on function public.mark_technology_control_reviewed(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Tasks: create incomplete + sync due_at; reopen when next_due_at arrives
-- ---------------------------------------------------------------------------
create or replace function public.create_technology_tasks_for_incomplete(p_created_by uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  update public.technology_controls
  set status = 'open',
      updated_at = now()
  where active = true
    and status = 'compliant'
    and next_due_at is not null
    and next_due_at <= current_date;

  update public.technology_tasks t
  set due_at = c.next_due_at,
      updated_at = now()
  from public.technology_controls c
  where t.control_id = c.id
    and t.status = 'open'
    and (t.due_at is distinct from c.next_due_at);

  insert into public.technology_tasks (control_id, title, status, due_at, notes, created_by)
  select
    c.id,
    'Technology: ' || c.title,
    'open',
    c.next_due_at,
    coalesce(nullif(c.area, ''), 'Technology')
      || ' · ' || coalesce(nullif(c.control_key, ''), 'control')
      || case when c.next_due_at is not null then ' · due ' || c.next_due_at::text else '' end,
    p_created_by
  from public.technology_controls c
  where c.active = true
    and c.status in ('open', 'in_progress', 'gap')
    and not exists (
      select 1 from public.technology_tasks t
      where t.control_id = c.id and t.status = 'open'
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

grant execute on function public.create_technology_tasks_for_incomplete(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Provision helpers: stamp default next_due_at on new rows
-- ---------------------------------------------------------------------------
create or replace function public.provision_technology_controls_for_entity(p_entity_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  insert into public.technology_controls (
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
    'Auto-provisioned for new entity from technology control templates',
    public.default_next_due_for_cadence(t.cadence)
  from public.technology_control_templates t
  where t.applies_to_entities = true
    and not exists (
      select 1 from public.technology_controls c
      where c.control_key = t.control_key
        and c.entity_id = p_entity_id
        and c.active = true
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

create or replace function public.provision_technology_controls_for_parent()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  insert into public.technology_controls (
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
    'Seeded from Technology Plan and Audit',
    public.default_next_due_for_cadence(t.cadence)
  from public.technology_control_templates t
  where t.applies_to_parent = true
    and not exists (
      select 1 from public.technology_controls c
      where c.control_key = t.control_key
        and c.entity_id is null
        and c.active = true
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

comment on column public.technology_controls.cadence is
  'Review frequency (aligned name across audit portals; annual default).';
comment on column public.technology_controls.next_due_at is
  'Next review due — set per parent/entity independently.';
comment on column public.technology_controls.evidence_storage_path is
  'Path in storage.buckets audit-evidence for attached evidence file.';
