-- Bind ENT-R619 to production Gusto company UUID (non-secret).
-- Run AFTER Production Pre-Approval + prod OAuth; keep GUSTO_LIVE=0 until smoke.
update public.os_partner_entity_bindings
set
  external_account_id = '66321fd7-450e-4a85-8fa7-fae8d846ed31',
  status = 'configured',
  config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
    'company_uuid', '66321fd7-450e-4a85-8fa7-fae8d846ed31',
    'company_name', 'Recruit 619, LLC',
    'plan', 'Simple',
    'environment', 'production',
    'role', 'subsidiary_payroll'
  ),
  updated_at = now()
where partner_key = 'gusto' and entity_id = 'ENT-R619';
