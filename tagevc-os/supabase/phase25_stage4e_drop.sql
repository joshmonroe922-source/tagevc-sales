-- Phase 25 Stage 4e — MANUAL ONLY. Do NOT apply in the normal SQL editor flow.
-- Prerequisites (all must be true):
--   1. Admin Stage 4e checklist shows ready=true
--   2. SNAPSHOT_DROP_APPROVED_AT + SNAPSHOT_DROP_APPROVED_BY set on Vercel
--   3. ALLOW_SNAPSHOT_DROP=1 for this one-off ops session
--   4. Offsite archive retained ≥90 days
--
-- The application NEVER executes this. Run only from a controlled ops session
-- after written approval. Prefer renaming the table first for a soft cutover.

-- Soft retire (preferred before hard DROP):
-- alter table public.os_store_snapshots rename to os_store_snapshots_retired_YYYYMMDD;

-- Hard DROP (irreversible):
-- drop table if exists public.os_store_snapshots cascade;

select
  'Refusing to drop automatically. Uncomment and run rename/DROP only after ops approval.'
  as phase25_stage4e_notice;
