-- Soft-void TEST Document Library seeds DOC-001 (Mutual NDA) + DOC-002 (COI).
-- Schema has no archived_at on os_documents; status = 'Voided' is the soft-delete.
-- Idempotent: only rows that are not already Voided are updated.
-- Prefer running scripts/archive-demo-documents.mjs with service role; this SQL is the equivalent.

update public.os_documents
   set status = 'Voided',
       notes = coalesce(
         nullif(trim(notes), ''),
         'Soft-archived TEST seed (Document Library cleanup 2026-07-26)'
       ),
       updated_at = timestamptz '2026-07-26T18:00:00Z'
 where doc_id in ('DOC-001', 'DOC-002')
   and status <> 'Voided';
