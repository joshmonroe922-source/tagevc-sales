import { randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  DIGITAL_CARD_PHOTO_BUCKET,
  validateDigitalCardPhoto,
} from '@/lib/digital-cards/photo-upload-shared';

export {
  DIGITAL_CARD_PHOTO_BUCKET,
  DIGITAL_CARD_PHOTO_MAX_BYTES,
  DIGITAL_CARD_PHOTO_MIME,
  validateDigitalCardPhoto,
} from '@/lib/digital-cards/photo-upload-shared';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function uploadDigitalCardPhoto(input: {
  userId: string;
  personaId: string;
  bytes: Buffer;
  mimeType: string;
}): Promise<{ ok: true; publicUrl: string } | { ok: false; error: string }> {
  const mime = input.mimeType.toLowerCase().split(';')[0]?.trim() || '';
  const guard = validateDigitalCardPhoto({
    mimeType: mime,
    sizeBytes: input.bytes.length,
  });
  if (!guard.ok) return guard;

  const ext = EXT_BY_MIME[mime] || 'jpg';
  const path = `digital-cards/${input.userId}/${input.personaId}/${randomUUID()}.${ext}`;

  try {
    const sb = await createPersistClient();
    const { error } = await sb.storage
      .from(DIGITAL_CARD_PHOTO_BUCKET)
      .upload(path, input.bytes, { contentType: mime, upsert: true });
    if (error) {
      return {
        ok: false,
        error: error.message.includes('Bucket not found')
          ? 'Photo storage unavailable'
          : 'Could not upload photo',
      };
    }
    const { data } = sb.storage
      .from(DIGITAL_CARD_PHOTO_BUCKET)
      .getPublicUrl(path);
    const publicUrl = data.publicUrl;
    if (!publicUrl) {
      return { ok: false, error: 'Could not resolve photo URL' };
    }
    return { ok: true, publicUrl };
  } catch {
    return { ok: false, error: 'Could not upload photo' };
  }
}
