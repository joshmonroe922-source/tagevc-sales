/**
 * Think Tank thread attachments — private `os-think-tank` bucket.
 * Extracted text is thread-only AI context (never leaked across threads).
 */
import { createClient } from '@/lib/supabase/server';
import { extractDocumentText } from '@/lib/platform/think-tank/extract-text';
import { suggestThinkTankTitle } from '@/lib/platform/think-tank/scope';
import {
  THINK_TANK_ALLOWED_EXTENSIONS,
  THINK_TANK_ATTACHMENT_CONTEXT_CHARS,
  THINK_TANK_BUCKET,
  THINK_TANK_DEFAULT_TITLE,
  THINK_TANK_MAX_ATTACHMENTS,
  THINK_TANK_MAX_FILE_BYTES,
  type ThinkTankAttachmentDto,
} from '@/lib/platform/think-tank/types';

type AttachmentRow = {
  id: string;
  conversation_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number | null;
  extracted_text?: string | null;
  extract_error?: string | null;
  storage_bucket: string;
  storage_path: string;
  created_at: string;
};

function allowedFile(fileName: string, mimeType: string): boolean {
  const lower = fileName.toLowerCase();
  if (THINK_TANK_ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
  return [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'text/csv',
    'text/html',
  ].includes(mimeType);
}

function safeFileName(name: string): string {
  const base = name.replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(0, 80);
  return base || 'document';
}

async function ownedConversationId(opts: {
  portalKey: string;
  profileId: string;
  entityOs: string;
  conversationId: string;
}): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('os_think_tank_conversations')
    .select('id')
    .eq('id', opts.conversationId)
    .eq('portal_key', opts.portalKey)
    .eq('profile_id', opts.profileId)
    .eq('entity_os', opts.entityOs)
    .maybeSingle();
  return data?.id ?? null;
}

export async function listThinkTankAttachments(
  conversationId: string,
): Promise<ThinkTankAttachmentDto[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('os_think_tank_attachments')
    .select(
      'id, conversation_id, file_name, mime_type, size_bytes, extract_error, storage_bucket, storage_path, created_at',
    )
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(THINK_TANK_MAX_ATTACHMENTS);

  const rows = (data ?? []) as AttachmentRow[];
  const out: ThinkTankAttachmentDto[] = [];
  for (const row of rows) {
    let signedUrl: string | null = null;
    try {
      const { data: signed } = await supabase.storage
        .from(row.storage_bucket || THINK_TANK_BUCKET)
        .createSignedUrl(row.storage_path, 60 * 30);
      signedUrl = signed?.signedUrl ?? null;
    } catch {
      signedUrl = null;
    }
    out.push({
      id: row.id,
      conversationId: row.conversation_id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes ?? 0),
      createdAt: row.created_at,
      signedUrl,
      extractError: row.extract_error,
    });
  }
  return out;
}

export async function formatThreadAttachmentContext(
  conversationId: string,
): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('os_think_tank_attachments')
    .select('file_name, extracted_text, extract_error')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(THINK_TANK_MAX_ATTACHMENTS);

  const parts: string[] = [];
  let remaining = THINK_TANK_ATTACHMENT_CONTEXT_CHARS;
  for (const row of data ?? []) {
    if (remaining <= 0) break;
    const name = String(row.file_name ?? 'document');
    const text = String(row.extracted_text ?? '').trim();
    if (text) {
      const slice = text.slice(0, remaining);
      parts.push(`--- ${name} ---\n${slice}`);
      remaining -= slice.length;
      continue;
    }
    const err = String(row.extract_error ?? '').trim();
    if (err) parts.push(`--- ${name} ---\n(unreadable: ${err})`);
  }
  return parts.join('\n\n');
}

export async function uploadThinkTankAttachment(opts: {
  portalKey: string;
  profileId: string;
  entityId: string;
  entityOs: string;
  roleHint: string;
  conversationId?: string | null;
  file: File;
}): Promise<
  | {
      conversationId: string;
      attachment: ThinkTankAttachmentDto;
    }
  | { error: string }
> {
  if (!allowedFile(opts.file.name, opts.file.type || '')) {
    return { error: 'Upload a PDF, DOC, DOCX, TXT, MD, CSV, or HTML file.' };
  }
  if (opts.file.size > THINK_TANK_MAX_FILE_BYTES) {
    return { error: 'File must be under 10MB.' };
  }

  let conversationId = opts.conversationId?.trim() || null;
  if (conversationId) {
    conversationId = await ownedConversationId({
      portalKey: opts.portalKey,
      profileId: opts.profileId,
      entityOs: opts.entityOs,
      conversationId,
    });
  }
  if (!conversationId) {
    const supabase = await createClient();
    const title = suggestThinkTankTitle(
      opts.file.name.replace(/\.[^.]+$/, ''),
      THINK_TANK_DEFAULT_TITLE,
    );
    const { data, error } = await supabase
      .from('os_think_tank_conversations')
      .insert({
        portal_key: opts.portalKey,
        entity_id: opts.entityId,
        entity_os: opts.entityOs,
        profile_id: opts.profileId,
        title,
        role_hint: opts.roleHint,
      })
      .select('id')
      .maybeSingle();
    if (error || !data?.id) {
      return { error: error?.message ?? 'Could not create Think Tank thread.' };
    }
    conversationId = data.id as string;
  }

  const supabase = await createClient();
  const { count } = await supabase
    .from('os_think_tank_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);
  if ((count ?? 0) >= THINK_TANK_MAX_ATTACHMENTS) {
    return { error: `Max ${THINK_TANK_MAX_ATTACHMENTS} documents per thread.` };
  }

  const bytes = new Uint8Array(await opts.file.arrayBuffer());
  const extracted = extractDocumentText({
    fileName: opts.file.name,
    bytes,
  });
  const path = `${opts.profileId}/${opts.portalKey}/${conversationId}/${crypto.randomUUID()}_${safeFileName(opts.file.name)}`;

  const { error: upErr } = await supabase.storage
    .from(THINK_TANK_BUCKET)
    .upload(path, bytes, {
      contentType: opts.file.type || 'application/octet-stream',
      upsert: false,
    });
  if (upErr) return { error: upErr.message };

  const { data, error } = await supabase
    .from('os_think_tank_attachments')
    .insert({
      conversation_id: conversationId,
      profile_id: opts.profileId,
      storage_bucket: THINK_TANK_BUCKET,
      storage_path: path,
      file_name: opts.file.name,
      mime_type: opts.file.type || 'application/octet-stream',
      size_bytes: opts.file.size,
      extracted_text: extracted.text,
      extract_error: extracted.error ?? null,
    })
    .select(
      'id, conversation_id, file_name, mime_type, size_bytes, extract_error, storage_bucket, storage_path, created_at',
    )
    .maybeSingle();

  if (error || !data) {
    await supabase.storage.from(THINK_TANK_BUCKET).remove([path]);
    return { error: error?.message ?? 'Could not save attachment.' };
  }

  await supabase
    .from('os_think_tank_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  let signedUrl: string | null = null;
  try {
    const { data: signed } = await supabase.storage
      .from(THINK_TANK_BUCKET)
      .createSignedUrl(path, 60 * 30);
    signedUrl = signed?.signedUrl ?? null;
  } catch {
    signedUrl = null;
  }

  const row = data as AttachmentRow;
  return {
    conversationId,
    attachment: {
      id: row.id,
      conversationId,
      fileName: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes ?? 0),
      createdAt: row.created_at,
      signedUrl,
      extractError: row.extract_error,
    },
  };
}

export async function removeThinkTankAttachment(opts: {
  portalKey: string;
  profileId: string;
  entityOs: string;
  attachmentId: string;
}): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('os_think_tank_attachments')
    .select('id, conversation_id, storage_bucket, storage_path')
    .eq('id', opts.attachmentId)
    .eq('profile_id', opts.profileId)
    .maybeSingle();
  if (!data) return { error: 'Attachment not found.' };

  const owned = await ownedConversationId({
    portalKey: opts.portalKey,
    profileId: opts.profileId,
    entityOs: opts.entityOs,
    conversationId: data.conversation_id as string,
  });
  if (!owned) return { error: 'Attachment not found.' };

  await supabase.storage
    .from((data.storage_bucket as string) || THINK_TANK_BUCKET)
    .remove([data.storage_path as string]);
  const { error } = await supabase
    .from('os_think_tank_attachments')
    .delete()
    .eq('id', opts.attachmentId);
  if (error) return { error: error.message };
  return { ok: true };
}
