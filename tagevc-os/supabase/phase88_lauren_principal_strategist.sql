-- Phase 88: Lauren Monroe job title → Principal Strategist
-- Does NOT assign Think Tank (or any) app role — title only.
-- Safe to re-run.

-- Profile title when Lauren's auth user / profiles row exists
update public.profiles
set job_title = 'Principal Strategist',
    updated_at = now()
where lower(email) in (
  'lauren@tagevc.com',
  'laurenmonroe@tagevc.com',
  'lauren.monroe@tagevc.com'
);

-- HRIS directory: upsert by work_email / known employee_key
insert into public.os_hris_employees (
  employee_key,
  full_name,
  work_email,
  entity_id,
  role_title,
  status,
  start_date
)
values (
  'lauren-monroe',
  'Lauren Monroe',
  'lauren@tagevc.com',
  'ENT-FIRM',
  'Principal Strategist',
  'active',
  current_date
)
on conflict (employee_key) do update
set
  full_name = excluded.full_name,
  work_email = excluded.work_email,
  role_title = 'Principal Strategist',
  status = coalesce(nullif(os_hris_employees.status, 'terminated'), 'active'),
  updated_at = now();

update public.os_hris_employees
set role_title = 'Principal Strategist',
    updated_at = now()
where lower(coalesce(work_email, '')) in (
  'lauren@tagevc.com',
  'laurenmonroe@tagevc.com',
  'lauren.monroe@tagevc.com'
)
or lower(coalesce(full_name, '')) = 'lauren monroe';

comment on column public.profiles.job_title is
  'Display title (e.g. Owner / CEO, Principal Strategist). Separate from app role.';
