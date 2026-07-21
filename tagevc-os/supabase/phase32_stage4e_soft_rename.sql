-- Phase 32 Stage 4e — MANUAL / OFFLINE SOFT RENAME ONLY.
-- The application never runs this file and never drops os_store_snapshots.
--
-- Before the maintenance window, record and retain:
--   * written approval identity + timestamp
--   * backup/export location and verification owner
--   * live row count by collection and schema signature
--   * exact retired name: os_store_snapshots_retired_YYYYMMDD
--   * rollback owner and maintenance-window reference
--
-- Review and execute the following only in an approved offline session:
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
--   'Approval APPROVAL-ID; backup EVIDENCE-ID; preflight rows=N; no destructive action'
-- );
-- commit;
--
-- Verify relation presence, row counts, collections, privileges, RLS, and
-- application reads. Then record stage='rename_verified' using the same exact
-- table and approver. Set the four SNAPSHOT_SOFT_RENAME_* environment values
-- only after database verification succeeds.
--
-- Rollback during soak is another reviewed offline rename to the original
-- relation name plus a stage='rollback' event. A rollback resets the soak.

select
  'Phase 32 permits only a reviewed offline soft rename; no destructive statement is provided.'
  as phase32_stage4e_notice;
