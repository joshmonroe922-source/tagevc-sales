-- Phase 25: Marketing engagement metadata, DocuSign file_kind, Stage 4e prep (no DROP)
-- Safe to re-run.

-- ─── Marketing: denormalized external post id ────────────────────────────────
alter table public.os_marketing_content
  add column if not exists external_post_id text;
create index if not exists os_mkt_content_external_post_idx
  on public.os_marketing_content (external_post_id)
  where external_post_id is not null;

-- ─── DocuSign: combined vs certificate ───────────────────────────────────────
alter table public.os_docusign_signed_files
  add column if not exists file_kind text not null default 'combined';
create index if not exists os_docusign_signed_kind_idx
  on public.os_docusign_signed_files (file_kind, received_at desc);

-- ─── Comments ────────────────────────────────────────────────────────────────
comment on column public.os_marketing_content.external_post_id is
  'Platform post id from last successful publish / engagement pull (Phase 25)';
comment on column public.os_docusign_signed_files.file_kind is
  'combined | certificate (CoC)';
