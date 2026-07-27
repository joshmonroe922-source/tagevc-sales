-- Phase 80: Document Library role ACL (visible_roles)
-- Apply in Supabase SQL editor for tagevc-os before / after deploy.
-- App layer still enforces folder defaults + Visionary/Admin full library
-- even if this column is not yet present (sync omits the field on error).

alter table public.os_documents
  add column if not exists visible_roles jsonb;

comment on column public.os_documents.visible_roles is
  'AppRole[] allow-list for this file; null inherits folder default; [] = open';
