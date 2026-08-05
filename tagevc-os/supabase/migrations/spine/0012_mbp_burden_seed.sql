-- Phase 54 — MyBasePay EOR burden by state (sheet 57). Additive seed only.
create table if not exists public.mbp_burden (
  state text primary key,
  markup_under_40 numeric(8, 4) not null,
  markup_at_or_above_40 numeric(8, 4) not null,
  source text not null default 'MBP schedule',
  schedule_version text not null default 'MBP-2026.1',
  effective_date date not null default '2026-01-01',
  updated_at timestamptz not null default now()
);

insert into public.mbp_burden (state, markup_under_40, markup_at_or_above_40) values
  ('Alabama', 0.2022, 0.2013),
  ('Alaska', 0.2024, 0.2017),
  ('Arizona', 0.2089, 0.2038),
  ('Arkansas', 0.2024, 0.2003),
  ('California', 0.2126, 0.207),
  ('Colorado', 0.2532, 0.2297),
  ('Connecticut', 0.2087, 0.2043),
  ('Delaware', 0.2, 0.1994),
  ('Florida', 0.2014, 0.2006),
  ('Georgia', 0.203, 0.2018),
  ('Hawaii', 0.2047, 0.2036),
  ('Idaho', 0.2089, 0.2062),
  ('Illinois', 0.2093, 0.2043),
  ('Indiana', 0.2135, 0.2062),
  ('Iowa', 0.2115, 0.2056),
  ('Kansas', 0.2168, 0.2077),
  ('Kentucky', 0.2009, 0.2002),
  ('Louisiana', 0.2049, 0.2027),
  ('Maine', 0.219, 0.2096),
  ('Maryland', 0.206, 0.2026),
  ('Massachusetts', 0.2196, 0.2092),
  ('Michigan', 0.2287, 0.2134),
  ('Minnesota', 0.2947, 0.2487),
  ('Mississippi', 0.2011, 0.2004),
  ('Missouri', 0.2051, 0.2024),
  ('Montana', 0.2156, 0.2091),
  ('Nebraska', 0.2053, 0.2025),
  ('Nevada', 0.2202, 0.2105),
  ('New Hampshire', 0.2067, 0.203),
  ('New Jersey', 0.2528, 0.2281),
  ('New Mexico', 0.2555, 0.2265),
  ('New York', 0.2145, 0.207),
  ('North Carolina', 0.2142, 0.2066),
  ('North Dakota', 0.2001, 0.1995),
  ('Ohio', 0.2, 0.1994),
  ('Oklahoma', 0.2035, 0.2018),
  ('Oregon', 0.2321, 0.2205),
  ('Pennsylvania', 0.2, 0.1996),
  ('Rhode Island', 0.2104, 0.2059),
  ('South Carolina', 0.2025, 0.2017),
  ('South Dakota', 0.2011, 0.2004),
  ('Tennessee', 0.2032, 0.2013),
  ('Texas', 0.2138, 0.2016),
  ('Utah', 0.2064, 0.2053),
  ('Vermont', 0.2031, 0.2016),
  ('Virginia', 0.2057, 0.2024),
  ('Washington', 0.2001, 0.1949),
  ('West Virginia', 0.2163, 0.2074),
  ('Wisconsin', 0.2124, 0.206),
  ('Wyoming', 0.2, 0.1994)
on conflict (state) do update
set markup_under_40 = excluded.markup_under_40,
    markup_at_or_above_40 = excluded.markup_at_or_above_40,
    schedule_version = excluded.schedule_version,
    updated_at = now();

alter table public.mbp_burden enable row level security;
drop policy if exists mbp_burden_select on public.mbp_burden;
create policy mbp_burden_select on public.mbp_burden
  for select to authenticated using (true);
grant select on public.mbp_burden to authenticated;
