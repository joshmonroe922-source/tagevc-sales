-- Phase 28 Stage 4e — MANUAL ONLY. Do NOT apply in the normal SQL editor flow.
-- Soft rename is preferred before hard DROP. App never executes this.
--
-- Prerequisites (all must be true):
--   1. Admin Stage 4e checklist shows ready=true
--   2. SNAPSHOT_DROP_APPROVED_AT + SNAPSHOT_DROP_APPROVED_BY set on Vercel
--   3. ALLOW_SNAPSHOT_DROP=1 for this one-off ops session
--   4. Offsite archive retained ≥90 days
--   5. Written ops approval recorded
--
-- Soft retire (preferred):
-- alter table public.os_store_snapshots rename to os_store_snapshots_retired_YYYYMMDD;
--
-- Hard DROP (irreversible — only after soft rename soak):
-- drop table if exists public.os_store_snapshots_retired_YYYYMMDD cascade;
-- drop table if exists public.os_store_snapshots cascade;

select
  'Refusing to drop automatically. Prefer soft rename, then DROP after approval.'
  as phase28_stage4e_notice;
