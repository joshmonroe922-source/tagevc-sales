-- Phase 99: structured bonus / variable compensation on HRIS employees.
-- Additive on Phase 68/72. Safe to re-run.
--
-- Before this, variable comp (e.g. "$2,500 quarterly on MBO execution") could only
-- live in free-text notes, so it was not queryable, reportable, or redactable
-- separately from the rest of the notes field.

alter table public.os_hris_employees
  add column if not exists bonus_amount numeric(14,2),
  add column if not exists bonus_currency text not null default 'USD'
    check (bonus_currency ~ '^[A-Z]{3}$'),
  add column if not exists bonus_frequency text not null default 'none'
    check (bonus_frequency in (
      'none', 'monthly', 'quarterly', 'semiannual', 'annual', 'one_time'
    )),
  add column if not exists bonus_type text not null default 'none'
    check (bonus_type in (
      'none', 'mbo', 'commission', 'discretionary', 'signing', 'retention',
      'performance', 'other'
    )),
  add column if not exists bonus_notes text not null default '';

comment on column public.os_hris_employees.bonus_amount is
  'Variable comp per bonus_frequency period. Protected like comp_amount (HR/Visionary).';
comment on column public.os_hris_employees.bonus_type is
  'mbo = tied to written MBOs, typically defined in the offer letter.';

-- Reporting: find who has variable comp without scanning notes text.
create index if not exists os_hris_employees_bonus_idx
  on public.os_hris_employees (entity_id, bonus_frequency)
  where bonus_amount is not null;

-- ---------------------------------------------------------------------------
-- Backfill: Dennis McCall (ENT-R619) — $2,500 quarterly MBO bonus per offer
-- letter. Base salary stays untouched. Idempotent.
-- ---------------------------------------------------------------------------
update public.os_hris_employees
set bonus_amount = 2500.00,
    bonus_currency = 'USD',
    bonus_frequency = 'quarterly',
    bonus_type = 'mbo',
    bonus_notes = 'Contingent on execution of MBOs as defined in the offer letter.',
    updated_at = now()
where employee_key = 'dennis-vp-recruiting-r619'
  and bonus_amount is null;
