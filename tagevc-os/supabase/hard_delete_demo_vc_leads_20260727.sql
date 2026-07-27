-- Hard-delete prelaunch demo VC leads LD-001..LD-007 so Lead Intake
-- Recent intake is empty (soft-archive alone still showed them as archived).
-- os_lead_tasks cascade on lead_id. Prefer scripts/hard-delete-demo-vc-leads.mjs
-- with service role; this SQL is the equivalent.

-- Demo Orbit Data deal (linked to LD-005). Instant NDA DE-LAU-01 is retained.
delete from public.os_deal_tasks where deal_id = 'DE-001';
delete from public.os_ic_reviews where deal_id = 'DE-001';
delete from public.os_ic_audits where deal_id = 'DE-001';
delete from public.os_deals where deal_id = 'DE-001';

delete from public.os_leads
where lead_id in (
  'LD-001',
  'LD-002',
  'LD-003',
  'LD-004',
  'LD-005',
  'LD-006',
  'LD-007'
);
