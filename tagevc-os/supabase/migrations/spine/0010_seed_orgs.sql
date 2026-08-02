-- Seed parent + subsidiary orgs (idempotent by slug)
insert into public.organizations (
  slug, name, kind, parent_id, icp_title_patterns, auto_expand_employees, auto_expand_cap
)
values
  (
    'tage',
    'Tage Venture Capital',
    'parent',
    null,
    array[
      'CEO', 'Founder', 'President', 'COO', 'CFO', 'CTO', 'Partner', 'Managing Director'
    ],
    true,
    75
  )
on conflict (slug) do update
set name = excluded.name,
    kind = excluded.kind;

insert into public.organizations (
  slug, name, kind, parent_id, icp_title_patterns, auto_expand_employees, auto_expand_cap
)
select
  v.slug,
  v.name,
  'subsidiary',
  p.id,
  v.icp,
  true,
  75
from public.organizations p
cross join (
  values
    (
      'recruit619',
      'Recruit 619',
      array[
        'VP Talent', 'Head of Talent', 'Talent Acquisition', 'Director HR',
        'CHRO', 'People Ops', 'Recruiting Manager'
      ]::text[]
    ),
    (
      'signent',
      'Signent HR',
      array[
        'CHRO', 'VP HR', 'HR Director', 'People Ops', 'HRBP', 'Controller'
      ]::text[]
    ),
    (
      'instant_nda',
      'Instant NDA',
      array[
        'General Counsel', 'Legal Ops', 'CLO', 'VP Legal', 'Contracts Manager'
      ]::text[]
    )
) as v(slug, name, icp)
where p.slug = 'tage'
on conflict (slug) do update
set name = excluded.name,
    parent_id = excluded.parent_id,
    icp_title_patterns = excluded.icp_title_patterns;
