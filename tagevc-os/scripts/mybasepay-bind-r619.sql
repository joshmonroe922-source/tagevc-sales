-- MyBasePay ENT-R619 binding (non-secret). Apply after phase89 partner spine.
-- external_account_id = company label from backoffice company profile.

update public.os_partner_entity_bindings
set
  enabled = true,
  status = 'configured',
  external_account_id = 'Recruit 619',
  config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
    'company_label', 'Recruit 619',
    'connection', 'admin_bridge',
    'base_url', 'https://backoffice.mybasepay.com',
    'role', 'eor_r619',
    'interim_until', '2026-10'
  ),
  updated_at = now()
where partner_key = 'mybasepay'
  and entity_id = 'ENT-R619';

-- Keep other entities disabled until explicit opt-in.
update public.os_partner_entity_bindings
set enabled = false, updated_at = now()
where partner_key = 'mybasepay'
  and entity_id <> 'ENT-R619';
