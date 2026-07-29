/**
 * PDF / attachment upload store for go-live ENT-06 and invoice defaults.
 */

import { createHash, randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import type { EntityCode } from '@/lib/af/types';

const BUCKET = 'af-attachments';

export type AfUploadedFile = {
  id: string;
  attachmentDefaultId?: string | null;
  entityCode: EntityCode | 'PERS' | 'ORG';
  documentType: string;
  displayName: string;
  fileName: string;
  mimeType: string;
  storagePath: string;
  byteSize: number;
  sha256?: string | null;
  createdAt: string;
};

function sanitizeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

export async function uploadAfAttachment(input: {
  entityCode: EntityCode | 'PERS' | 'ORG';
  documentType: string;
  displayName: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  attachmentDefaultId?: string | null;
  uploadedBy?: string | null;
}): Promise<{ file: AfUploadedFile | null; error?: string }> {
  const supabase = await createPersistClient();
  if (!supabase) {
    return { file: null, error: 'Supabase client unavailable' };
  }

  const mime = input.mimeType || 'application/pdf';
  if (!mime.includes('pdf') && !mime.startsWith('image/')) {
    return { file: null, error: 'Only PDF or image uploads allowed' };
  }

  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const path = `af/${input.entityCode}/${input.documentType}/${Date.now()}-${randomUUID().slice(0, 8)}-${sanitizeName(input.fileName)}`;

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, input.bytes, {
    contentType: mime,
    upsert: false,
  });
  if (upErr) {
    // Bucket may not exist yet — still record metadata path for retry
    console.error('uploadAfAttachment storage', upErr.message);
  }

  const { data, error } = await supabase
    .from('os_af_attachment_files')
    .insert({
      attachment_default_id: input.attachmentDefaultId ?? null,
      entity_code: input.entityCode,
      document_type: input.documentType,
      display_name: input.displayName,
      file_name: input.fileName,
      mime_type: mime,
      storage_path: path,
      byte_size: input.bytes.length,
      sha256,
      uploaded_by: input.uploadedBy ?? null,
    })
    .select('*')
    .single();

  if (error || !data) {
    return { file: null, error: error?.message ?? 'Insert failed' };
  }

  return {
    file: {
      id: String(data.id),
      attachmentDefaultId: (data.attachment_default_id as string) ?? null,
      entityCode: data.entity_code as EntityCode,
      documentType: String(data.document_type),
      displayName: String(data.display_name),
      fileName: String(data.file_name),
      mimeType: String(data.mime_type),
      storagePath: String(data.storage_path),
      byteSize: Number(data.byte_size),
      sha256: (data.sha256 as string) ?? null,
      createdAt: String(data.created_at),
    },
  };
}

export async function listAfAttachments(
  entityCode?: string | null,
): Promise<AfUploadedFile[]> {
  try {
    const supabase = await createPersistClient();
    if (!supabase) return [];
    let q = supabase
      .from('os_af_attachment_files')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (entityCode) q = q.eq('entity_code', entityCode);
    const { data, error } = await q;
    if (error || !data) return [];
    return data.map((r) => ({
      id: String(r.id),
      attachmentDefaultId: (r.attachment_default_id as string) ?? null,
      entityCode: r.entity_code as EntityCode,
      documentType: String(r.document_type),
      displayName: String(r.display_name),
      fileName: String(r.file_name),
      mimeType: String(r.mime_type),
      storagePath: String(r.storage_path),
      byteSize: Number(r.byte_size),
      sha256: (r.sha256 as string) ?? null,
      createdAt: String(r.created_at),
    }));
  } catch {
    return [];
  }
}

export async function signedAfAttachmentUrl(
  storagePath: string,
  expiresIn = 60 * 30,
): Promise<string | null> {
  try {
    const supabase = await createPersistClient();
    if (!supabase) return null;
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, expiresIn);
    if (error) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}
