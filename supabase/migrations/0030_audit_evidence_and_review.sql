-- Audit control evidence attach + review due roll-forward
-- Aligns shared column names across portal audit matrices.
-- Primary consumer this release: Finance (/sales/finance).
-- cadence = review frequency (annual default). Do NOT introduce review_frequency.
-- Run on hqmobgtnedmhzipusert after 0029.

-- ---------------------------------------------------------------------------
-- Shared helper: advance a due date by cadence (review frequency)
-- ---------------------------------------------------------------------------
create or replace function public.advance_due_by_cadence(
  p_from date,
  p_cadence text
) returns date
language plpgsql
immutable
as $$
declare
  base date := coalesce(p_from, current_date);
begin
  case coalesce(p_cadence, 'annual')
    when 'monthly' then
      return (base + interval '1 month')::date;
    when 'quarterly' then
      return (base + interval '3 months')::date;
    when 'annual' then
      return (base + interval '1 year')::date;
    when 'one_time' then
      return null;
    else
      -- custom: leave caller to set; default +1 year
      return (base + interval '1 year')::date;
  end case;
end;
$$;

-- Initial default due when provisioning (per-row; entities keep independent dates)
create or replace function public.default_next_due_for_cadence(p_cadence text)
returns date
language plpgsql
immutable
as $$
begin
  case coalesce(p_cadence, 'annual')
    when 'monthly' then
      return (current_date + interval '1 month')::date;
    when 'quarterly' then
      return (current_date + interval '3 months')::date;
    when 'one_time' then
      return (current_date + interval '30 days')::date;
    when 'custom' then
      return null;
    else
      return (current_date + interval '1 year')::date;
  end case;
end;
$$;

-- ---------------------------------------------------------------------------
-- Aligned evidence-file columns on all audit control tables
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'finance_controls',
    'legal_controls',
    'marketing_controls',
    'technology_controls',
    'hr_compliance_controls'
  ]
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format(
      'alter table public.%I add column if not exists evidence_storage_path text not null default ''''',
      t
    );
    execute format(
      'alter table public.%I add column if not exists evidence_file_name text not null default ''''',
      t
    );
    execute format(
      'alter table public.%I add column if not exists evidence_mime_type text not null default ''''',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Storage bucket for audit evidence (private)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audit-evidence',
  'audit-evidence',
  false,
  52428800,
  null
)
on conflict (id) do nothing;

drop policy if exists "Audit evidence read" on storage.objects;
create policy "Audit evidence read"
  on storage.objects for select
  using (
    bucket_id = 'audit-evidence'
    and public.is_active_sales_user()
  );

drop policy if exists "Audit evidence upload" on storage.objects;
create policy "Audit evidence upload"
  on storage.objects for insert
  with check (
    bucket_id = 'audit-evidence'
    and public.is_active_sales_user()
  );

drop policy if exists "Audit evidence update" on storage.objects;
create policy "Audit evidence update"
  on storage.objects for update
  using (
    bucket_id = 'audit-evidence'
    and public.is_active_sales_user()
  )
  with check (
    bucket_id = 'audit-evidence'
    and public.is_active_sales_user()
  );

drop policy if exists "Audit evidence delete" on storage.objects;
create policy "Audit evidence delete"
  on storage.objects for delete
  using (
    bucket_id = 'audit-evidence'
    and public.is_active_sales_user()
  );

-- ---------------------------------------------------------------------------
-- Finance: seed next_due_at where missing (per control / per entity)
-- ---------------------------------------------------------------------------
update public.finance_controls c
set next_due_at = public.default_next_due_for_cadence(c.cadence)
where c.active = true
  and c.next_due_at is null
  and c.cadence <> 'custom';

-- Keep open task due dates in sync with controls
update public.finance_tasks t
set due_at = c.next_due_at,
    updated_at = now()
from public.finance_controls c
where t.control_id = c.id
  and t.status = 'open'
  and c.next_due_at is not null
  and (t.due_at is distinct from c.next_due_at);

-- ---------------------------------------------------------------------------
-- Finance: mark reviewed → roll next_due_at by cadence; close open tasks
-- ---------------------------------------------------------------------------
create or replace function public.mark_finance_control_reviewed(
  p_control_id uuid,
  p_reviewed_by uuid default null
)
returns public.finance_controls
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.finance_controls;
  reviewed date := current_date;
  base date;
  next_due date;
begin
  select * into rec
  from public.finance_controls
  where id = p_control_id and active = true
  for update;

  if not found then
    raise exception 'finance control not found';
  end if;

  -- Roll from the later of prior due / review date so overdue items don't stick
  base := greatest(coalesce(rec.next_due_at, reviewed), reviewed);
  if rec.cadence = 'one_time' then
    next_due := null;
  else
    next_due := public.advance_due_by_cadence(base, rec.cadence);
  end if;

  update public.finance_controls
  set
    last_reviewed_at = reviewed,
    next_due_at = next_due,
    status = case when rec.cadence = 'one_time' then 'compliant' else 'compliant' end,
    updated_at = now()
  where id = p_control_id
  returning * into rec;

  update public.finance_tasks
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

grant execute on function public.advance_due_by_cadence(date, text) to authenticated;
grant execute on function public.default_next_due_for_cadence(text) to authenticated;
grant execute on function public.mark_finance_control_reviewed(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Finance tasks: create incomplete + sync due_at from control.next_due_at
-- Also reopen compliant rows whose next_due_at has arrived.
-- ---------------------------------------------------------------------------
create or replace function public.create_finance_tasks_for_incomplete(p_created_by uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  -- Reopen compliant/in-cycle controls that are due again
  update public.finance_controls
  set status = 'open',
      updated_at = now()
  where active = true
    and status = 'compliant'
    and next_due_at is not null
    and next_due_at <= current_date;

  -- Sync due dates on existing open tasks
  update public.finance_tasks t
  set due_at = c.next_due_at,
      updated_at = now()
  from public.finance_controls c
  where t.control_id = c.id
    and t.status = 'open'
    and (t.due_at is distinct from c.next_due_at);

  insert into public.finance_tasks (control_id, title, status, due_at, notes, created_by)
  select
    c.id,
    'Finance: ' || c.title,
    'open',
    c.next_due_at,
    coalesce(nullif(c.area, ''), 'Finance') || ' · ' || coalesce(nullif(c.control_key, ''), 'control'),
    p_created_by
  from public.finance_controls c
  where c.active = true
    and c.status in ('open', 'in_progress', 'gap')
    and not exists (
      select 1 from public.finance_tasks t
      where t.control_id = c.id and t.status = 'open'
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

-- Provision helpers: stamp default next_due_at on new rows
create or replace function public.provision_finance_controls_for_entity(p_entity_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  insert into public.finance_controls (
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
    'Auto-provisioned for new entity from finance control templates',
    public.default_next_due_for_cadence(t.cadence)
  from public.finance_control_templates t
  where t.applies_to_entities = true
    and not exists (
      select 1 from public.finance_controls c
      where c.control_key = t.control_key
        and c.entity_id = p_entity_id
        and c.active = true
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

create or replace function public.provision_finance_controls_for_parent()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  insert into public.finance_controls (
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
    'Seeded from Finance & Accounting Functions and Audit',
    public.default_next_due_for_cadence(t.cadence)
  from public.finance_control_templates t
  where t.applies_to_parent = true
    and not exists (
      select 1 from public.finance_controls c
      where c.control_key = t.control_key
        and c.entity_id is null
        and c.active = true
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

comment on function public.advance_due_by_cadence(date, text) is
  'Shared audit helper: cadence column is the review frequency (annual/monthly/quarterly/one_time/custom).';
comment on column public.finance_controls.cadence is
  'Review frequency (aligned name across audit portals; annual default).';
comment on column public.finance_controls.next_due_at is
  'Next review due — set per parent/entity independently (e.g. annual report dates).';
comment on column public.finance_controls.evidence_storage_path is
  'Path in storage.buckets audit-evidence for attached evidence file.';

-- ---------------------------------------------------------------------------
-- Legal + HR: seed next_due_at where missing; sync open task dues
-- ---------------------------------------------------------------------------
update public.legal_controls c
set next_due_at = public.default_next_due_for_cadence(c.cadence)
where c.active = true
  and c.next_due_at is null
  and c.cadence <> 'custom';

update public.hr_compliance_controls c
set next_due_at = public.default_next_due_for_cadence(c.cadence)
where c.active = true
  and c.next_due_at is null
  and c.cadence <> 'custom';

update public.legal_tasks t
set due_at = c.next_due_at,
    updated_at = now()
from public.legal_controls c
where t.control_id = c.id
  and t.status = 'open'
  and c.next_due_at is not null
  and (t.due_at is distinct from c.next_due_at);

-- Legal: mark reviewed → roll next_due_at; close open legal_tasks
create or replace function public.mark_legal_control_reviewed(
  p_control_id uuid,
  p_reviewed_by uuid default null
)
returns public.legal_controls
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.legal_controls;
  reviewed date := current_date;
  base date;
  next_due date;
begin
  select * into rec
  from public.legal_controls
  where id = p_control_id and active = true
  for update;

  if not found then
    raise exception 'legal control not found';
  end if;

  base := greatest(coalesce(rec.next_due_at, reviewed), reviewed);
  if rec.cadence = 'one_time' then
    next_due := null;
  else
    next_due := public.advance_due_by_cadence(base, rec.cadence);
  end if;

  update public.legal_controls
  set
    last_reviewed_at = reviewed,
    next_due_at = next_due,
    status = 'compliant',
    updated_at = now()
  where id = p_control_id
  returning * into rec;

  update public.legal_tasks
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

grant execute on function public.mark_legal_control_reviewed(uuid, uuid) to authenticated;

-- Sync open legal_tasks.due_at when control next_due_at changes
create or replace function public.trg_legal_control_sync_task_due()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.next_due_at is distinct from old.next_due_at then
    update public.legal_tasks
    set due_at = new.next_due_at,
        updated_at = now()
    where control_id = new.id
      and status = 'open';
  end if;
  return new;
end;
$$;

drop trigger if exists legal_controls_sync_task_due on public.legal_controls;
create trigger legal_controls_sync_task_due
  after update of next_due_at on public.legal_controls
  for each row execute function public.trg_legal_control_sync_task_due();

-- Keep create_legal_tasks_for_incomplete syncing due + reopening due cycle
create or replace function public.create_legal_tasks_for_incomplete(p_created_by uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  update public.legal_controls
  set status = 'open',
      updated_at = now()
  where active = true
    and status = 'compliant'
    and next_due_at is not null
    and next_due_at <= current_date;

  update public.legal_tasks t
  set due_at = c.next_due_at,
      updated_at = now()
  from public.legal_controls c
  where t.control_id = c.id
    and t.status = 'open'
    and (t.due_at is distinct from c.next_due_at);

  insert into public.legal_tasks (control_id, title, status, due_at, notes, created_by)
  select
    c.id,
    'Legal: ' || c.title,
    'open',
    c.next_due_at,
    coalesce(nullif(c.area, ''), 'Legal') || ' · ' || coalesce(nullif(c.control_key, ''), 'control'),
    p_created_by
  from public.legal_controls c
  where c.active = true
    and c.status in ('open', 'in_progress', 'gap')
    and not exists (
      select 1 from public.legal_tasks t
      where t.control_id = c.id and t.status = 'open'
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

comment on column public.legal_controls.cadence is
  'Review frequency (annual default). Parent and each entity row are independent.';
comment on column public.legal_controls.next_due_at is
  'Next review/filing due — set per company (e.g. annual report dates differ by entity).';
comment on column public.hr_compliance_controls.cadence is
  'Review frequency for HR compliance controls (annual default).';
