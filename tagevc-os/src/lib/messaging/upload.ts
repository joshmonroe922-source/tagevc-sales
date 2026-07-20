import { createClient } from '@/lib/supabase/client';
import type { UploadedChatFile } from '@/lib/messaging/types';

const MAX_BYTES = 10 * 1024 * 1024;

export async function uploadChatFile(
  conversationId: string,
  file: File,
): Promise<{ ok: true; file: UploadedChatFile } | { ok: false; error: string }> {
  if (file.size <= 0) return { ok: false, error: 'Empty file' };
  if (file.size > MAX_BYTES) {
    return { ok: false, error: 'File must be 10 MB or smaller' };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const safeName = file.name.replace(/[^\w.\-()+ ]+/g, '_').slice(0, 120);
  const path = `${user.id}/${conversationId}/${crypto.randomUUID()}_${safeName}`;

  const { error } = await supabase.storage
    .from('chat-attachments')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    });

  if (error) {
    return {
      ok: false,
      error: error.message.includes('Bucket not found')
        ? 'Chat storage bucket missing. Apply Phase 13 SQL.'
        : error.message,
    };
  }

  return {
    ok: true,
    file: {
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size,
    },
  };
}
