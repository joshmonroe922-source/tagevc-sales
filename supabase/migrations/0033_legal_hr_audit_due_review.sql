-- Legal + HR audit due-date / mark-reviewed helpers
-- Applied after 0030–0032 (those were already on hqmobgtnedmhzipusert).
-- Cadence = review frequency. No SoS credential automation.

-- Seed next_due_at where still missing
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
