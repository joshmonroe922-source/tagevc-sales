-- Soft-archive demo/test VC Deal Flow leads (LD-001..005, LD-007) + Orbit Data deal DE-001.
-- Idempotent: only rows with archived_at IS NULL are updated.
-- Prefer running scripts/archive-demo-vc-leads.mjs with service role; this SQL is the equivalent.

update public.os_leads
set
  archived_at = coalesce(archived_at, timestamptz '2026-07-26T17:00:00Z'),
  updated_at = greatest(updated_at, timestamptz '2026-07-26T17:00:00Z')
where lead_id in ('LD-001', 'LD-002', 'LD-003', 'LD-004', 'LD-005', 'LD-007')
  and archived_at is null;

update public.os_deals
set
  archived_at = coalesce(archived_at, timestamptz '2026-07-26T17:00:00Z'),
  updated_at = greatest(updated_at, timestamptz '2026-07-26T17:00:00Z')
where deal_id = 'DE-001'
  and archived_at is null;
