-- Extra Josh login emails (allowlist). Safe to re-run.
insert into public.sales_users (email, full_name, role, active)
values
  ('josh@tagevc.com', 'Josh Monroe', 'admin', true),
  ('hello@tagevc.com', 'Josh Monroe', 'admin', true),
  ('joshmonroe922@gmail.com', 'Josh Monroe', 'admin', true),
  ('joshmonroe@tagevc.com', 'Josh Monroe', 'admin', true)
on conflict (email) do update
  set full_name = excluded.full_name,
      role = 'admin',
      active = true;
