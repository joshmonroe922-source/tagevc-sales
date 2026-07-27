-- Phase 82: Firm page registry cleanup — soft-archive sample / legacy companies.
-- Additive, idempotent, non-destructive. Safe to re-apply.
--
-- Goal: keep only the real operating subsidiaries on the Firm page
--   Active companies + Registry companies lists:
--     KEEP  : ENT-FIRM (parent), ENT-R619 (Recruit 619),
--             ENT-INDA (Instant NDA), ENT-SIGNENT (Signent HR — IES map only)
--     ARCHIVE: ENT-001 (Sample Closed Co), ENT-003 / ENT-RE-001 (Sample Indy SFR)
--     ARCHIVE: ENT-002 (Instant NDA LEGACY alias — canonical record is ENT-INDA)
--
-- The application also enforces this in code
--   (src/lib/entities/registry-visibility.ts), so visibility is guaranteed on
--   deploy regardless of whether this migration has been applied. This SQL just
--   keeps the durable data layer honest (status = archived) for data hygiene.
--
-- IMPORTANT: os_ies_entity_map (SSC / IES entity dropdown) is NOT touched here.
--   ENT-FIRM, ENT-R619, ENT-SIGNENT, ENT-INDA remain active in that table.

-- Soft-archive the sample companies.
update public.entities
   set status = 'Dissolved',
       updated_at = now()
 where entity_id in ('ENT-001', 'ENT-003', 'ENT-RE-001')
   and status <> 'Dissolved';

-- Soft-archive the legacy Instant NDA alias (canonical record is ENT-INDA).
update public.entities
   set status = 'Inactive',
       updated_at = now()
 where entity_id = 'ENT-002'
   and status <> 'Inactive';
