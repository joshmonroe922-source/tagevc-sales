-- Phase 108: Think Tank Word/Excel storage MIME allowlist
-- Additive. Shared UDL (opdqybaatfbwkokbzwli). Idempotent.
-- Lets .doc/.docx/.xls/.xlsx/.csv land in the private os-think-tank bucket.

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/csv',
  'application/octet-stream',
  'application/zip',
  'application/vnd.ms-office'
]
where id = 'os-think-tank';
