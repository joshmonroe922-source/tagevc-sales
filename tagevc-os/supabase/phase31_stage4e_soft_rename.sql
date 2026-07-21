-- Phase 31 Stage 4e — MANUAL / OFFLINE ONLY.
-- The application never runs this file and never renames or drops the table.
--
-- Required before rename:
--   1. Admin Stage 4e checklist green except rename-specific checks.
--   2. Written approval recorded outside the app.
--   3. Backup/export verified and rollback owner assigned.
--   4. Replace YYYYMMDD and APPROVER below.
--
-- begin;
-- lock table public.os_store_snapshots in access exclusive mode;
-- alter table public.os_store_snapshots
--   rename to os_store_snapshots_retired_YYYYMMDD;
-- insert into public.os_snapshot_retirement_events (
--   event_id, stage, retired_table_name, approved_by, detail
-- ) values (
--   'SRE-YYYYMMDD-RENAME',
--   'renamed',
--   'os_store_snapshots_retired_YYYYMMDD',
--   'APPROVER',
--   'Offline soft rename completed; no DROP performed'
-- );
-- commit;
--
-- Then set:
--   SNAPSHOT_SOFT_RENAMED_AT=<ISO timestamp>
--   SNAPSHOT_RETIRED_TABLE_NAME=os_store_snapshots_retired_YYYYMMDD
--   SNAPSHOT_SOFT_RENAME_APPROVED_AT=<ISO timestamp>
--   SNAPSHOT_SOFT_RENAME_APPROVED_BY=<written approver>
--
-- Rollback during rename soak:
-- alter table public.os_store_snapshots_retired_YYYYMMDD
--   rename to os_store_snapshots;
-- insert a stage='rollback' event with the written reason.
--
-- No DROP statement is intentionally provided in Phase 31.

select
  'Phase 31 refuses automatic action. Use the reviewed offline soft-rename block only.'
  as phase31_stage4e_notice;
