-- Soft-archive sample RE Deal Flow assets (RE-001 1842 Maple, RE-002 Carmel Flex).
-- Idempotent: only rows with archived_at IS NULL are updated.
-- Prefer running scripts/archive-demo-re-deals.mjs with service role; this SQL is the equivalent.

update public.os_re_deals
set
  archived_at = coalesce(archived_at, timestamptz '2026-07-26T17:00:00Z'),
  updated_at = greatest(updated_at, timestamptz '2026-07-26T17:00:00Z')
where re_id in ('RE-001', 'RE-002')
  and archived_at is null;
