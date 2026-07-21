-- Phase 30 Stage 4e — MANUAL ONLY. Soft rename preferred. App never executes this.
-- Prerequisites: Stage 4e checklist ready + SNAPSHOT_DROP_APPROVED_* + written approval.
--
-- Soft retire (preferred):
-- alter table public.os_store_snapshots rename to os_store_snapshots_retired_YYYYMMDD;
-- Then set SNAPSHOT_SOFT_RENAMED_AT=YYYY-MM-DD on Vercel for checklist visibility.
--
-- Hard DROP only after soft-rename soak (irreversible):
-- drop table if exists public.os_store_snapshots_retired_YYYYMMDD cascade;

select
  'Refusing to drop automatically. Soft rename first; then DROP after approval.'
  as phase30_stage4e_notice;
