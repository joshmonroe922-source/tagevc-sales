-- phase111_os_uploads_bucket.sql
--
-- Creates the `os-uploads` bucket, which three shipped features have been
-- writing to even though nothing ever created it. Every digital-card headshot
-- upload failed with "Bucket not found" -> "Photo storage unavailable", for
-- every user, since phase98. Help-desk and shared-services intake attachments
-- fail-soft to null on the same bucket, so they were silently dropping files.
--
-- Public on purpose: all three call sites resolve URLs with getPublicUrl, and a
-- card headshot has to load for anonymous visitors on /card/p/{public_id}.
-- Object names embed a randomUUID, so paths are unguessable, but note that
-- unguessable is not access control — see the comment on the select policy.
--
-- Idempotent: safe to re-run, and repairs an existing bucket that was created
-- private or with a narrower MIME list.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'os-uploads',
  'os-uploads',
  true,
  10485760, -- 10 MB; the card path caps itself at 5 MB in app code
  array[
    -- Card headshots. Kept in sync with DIGITAL_CARD_PHOTO_MIME.
    'image/jpeg',
    'image/png',
    'image/webp',
    -- Help-desk screenshots and shared-services intake documents.
    'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
    'application/octet-stream'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Reads are open because published cards are anonymous traffic. Anything that
-- must not be world-readable does not belong in this bucket: put it in
-- hris-private, csuite-private, or os-think-tank instead.
drop policy if exists os_uploads_storage_select on storage.objects;
create policy os_uploads_storage_select
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'os-uploads');

-- Writes require a signed-in user. Server actions normally run as service_role
-- (which bypasses RLS entirely), but createPersistClient falls back to the
-- caller's JWT when SUPABASE_SERVICE_ROLE_KEY is absent, so without these the
-- upload would break again in any deployment missing that key.
drop policy if exists os_uploads_storage_insert on storage.objects;
create policy os_uploads_storage_insert
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'os-uploads');

drop policy if exists os_uploads_storage_update on storage.objects;
create policy os_uploads_storage_update
  on storage.objects for update
  to authenticated
  using (bucket_id = 'os-uploads')
  with check (bucket_id = 'os-uploads');

-- Replacing a headshot uploads a fresh UUID rather than deleting the old one,
-- so delete stays service-role only and is intentionally not granted here.
