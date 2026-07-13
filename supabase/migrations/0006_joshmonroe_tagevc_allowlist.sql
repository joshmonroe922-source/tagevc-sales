-- joshmonroe@tagevc.com portal login (allowlist). Safe to re-run.
insert into public.sales_users (email, full_name, role, active)
values
  ('joshmonroe@tagevc.com', 'Josh Monroe', 'admin', true)
on conflict (email) do update
  set full_name = excluded.full_name,
      role = 'admin',
      active = true;
