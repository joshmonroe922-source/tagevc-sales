-- Bind OS entities → Dialpad offices (non-secret IDs only).
-- One company (Tage Venture Capital); subsidiaries are offices.
-- Secrets stay in env (DIALPAD_API_KEY / DIALPAD_WEBHOOK_SECRET / DIALPAD_LIVE).
-- Docs: docs/DIALPAD_MULTI_ENTITY.md

insert into public.os_partner_entity_bindings (
  partner_key, entity_id, enabled, status, external_account_id, config, updated_at
)
values
  (
    'dialpad', 'ENT-FIRM', true, 'configured', '5312888585003008',
    jsonb_build_object(
      'office_id', '5312888585003008',
      'office_name', 'Tage Venture Capital',
      'main_line', '+16193590371',
      'company_id', '5390437239431168',
      'role', 'firm_office'
    ),
    now()
  ),
  (
    'dialpad', 'ENT-R619', true, 'configured', '5109894981558272',
    jsonb_build_object(
      'office_id', '5109894981558272',
      'office_name', 'Recruit 619',
      'main_line', '+12094545611',
      'company_id', '5390437239431168',
      'role', 'subsidiary_office'
    ),
    now()
  ),
  (
    'dialpad', 'ENT-SIGNENT', true, 'configured', '4968987070242816',
    jsonb_build_object(
      'office_id', '4968987070242816',
      'office_name', 'Signent HR',
      'main_line', '+12095090641',
      'company_id', '5390437239431168',
      'role', 'subsidiary_office'
    ),
    now()
  ),
  (
    'dialpad', 'ENT-INDA', true, 'configured', '5633477826781184',
    jsonb_build_object(
      'office_id', '5633477826781184',
      'office_name', 'Instant NDA',
      'main_line', '+12073475325',
      'company_id', '5390437239431168',
      'role', 'subsidiary_office'
    ),
    now()
  )
on conflict (partner_key, entity_id) do update
set
  enabled = excluded.enabled,
  status = excluded.status,
  external_account_id = excluded.external_account_id,
  config = coalesce(os_partner_entity_bindings.config, '{}'::jsonb) || excluded.config,
  updated_at = now();
