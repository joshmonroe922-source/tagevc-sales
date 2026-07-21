-- Phase 33 Stage 4e — MANUAL / OFFLINE SOFT RENAME GUIDANCE ONLY.
-- The application never executes this file and never drops os_store_snapshots.
--
-- Require written approval, verified backup/export, exact preflight row counts,
-- rollback owner, and a maintenance-window reference before any offline rename.
--
-- During the approved offline session:
--   1. lock public.os_store_snapshots in access exclusive mode;
--   2. rename it to os_store_snapshots_retired_YYYYMMDD;
--   3. insert a correlated stage='renamed' retirement event;
--   4. verify relation shape, rows, grants, RLS, and application health;
--   5. insert stage='rename_verified' with the same table and approver.
--
-- Set SNAPSHOT_SOFT_RENAMED_AT, SNAPSHOT_RETIRED_TABLE_NAME, and approval
-- environment values only after verification. Phase 33 starts a durable soak
-- epoch. An unhealthy observation, >8-hour observation gap, or rollback event
-- breaks qualification. Rollback remains an independently reviewed offline
-- rename plus a durable stage='rollback' event.

select
  'Phase 33 permits only reviewed offline soft rename; no rename or DROP statement is provided.'
  as phase33_stage4e_notice;
