-- Persist completion timestamps on portal open tasks (controls already have last_reviewed_at;
-- finance close items already have completed_at; HR checklist items already have completed_at).

alter table public.legal_tasks
  add column if not exists completed_at timestamptz;

alter table public.finance_tasks
  add column if not exists completed_at timestamptz;

alter table public.marketing_tasks
  add column if not exists completed_at timestamptz;

alter table public.technology_tasks
  add column if not exists completed_at timestamptz;

alter table public.finance_close_tasks
  add column if not exists completed_at timestamptz;

-- Backfill from updated_at when already done
update public.legal_tasks
  set completed_at = coalesce(completed_at, updated_at)
  where status = 'done' and completed_at is null;

update public.finance_tasks
  set completed_at = coalesce(completed_at, updated_at)
  where status = 'done' and completed_at is null;

update public.marketing_tasks
  set completed_at = coalesce(completed_at, updated_at)
  where status = 'done' and completed_at is null;

update public.technology_tasks
  set completed_at = coalesce(completed_at, updated_at)
  where status = 'done' and completed_at is null;

update public.finance_close_tasks
  set completed_at = coalesce(completed_at, updated_at)
  where status = 'done' and completed_at is null;
