-- Phase 110 — COO of Subsidiaries: assign all three operating subsidiaries.
--
-- Assets → Businesses is lead-scoped for the `coo` and `sub_lead` roles via
-- isAssignedToLeadEntity() in src/lib/entities/assignment-lead.ts. For a COO the
-- row is hidden outright when entities.coo_owner is null, and shown when the
-- owner string matches /\bcoo\b/ (seed convention 'COO — Ops Lead').
--
-- ENT-R619 already carried that value, so Recruit 619 was the only company the
-- COO could see. Signent HR and Instant NDA were left null and silently
-- filtered out. Set them to the same convention so all three real subsidiaries
-- appear.
--
-- ENT-001 / ENT-002 / ENT-003 / ENT-RE-001 are intentionally untouched: they are
-- sample and legacy-alias rows already removed by isHiddenRegistryEntity().

update public.entities
   set coo_owner = 'COO — Ops Lead',
       updated_at = now()
 where entity_id in ('ENT-SIGNENT', 'ENT-INDA')
   and entity_type = 'Subsidiary'
   and coalesce(coo_owner, '') = '';

-- Verify: expect three rows, each with a coo_owner matching the COO convention.
--   select entity_id, canonical_name, coo_owner
--     from public.entities
--    where entity_type = 'Subsidiary'
--      and entity_id in ('ENT-R619', 'ENT-SIGNENT', 'ENT-INDA')
--    order by canonical_name;
