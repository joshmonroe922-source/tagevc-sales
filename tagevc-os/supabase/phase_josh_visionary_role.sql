-- Josh Monroe is always Visionary. Re-apply if a new auth user bootstraps as associate.
update public.profiles
set
  role = 'visionary',
  updated_at = now()
where role is distinct from 'visionary'
  and (
    lower(email) in (
      'joshmonroe@tagevc.com',
      'josh@tagevc.com',
      'joshmonroe@recruit619.com'
    )
    or lower(trim(full_name)) = 'josh monroe'
  );
