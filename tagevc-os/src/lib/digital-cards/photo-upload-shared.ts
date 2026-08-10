/** Shared limits for digital-card headshots (safe for client + server). */

export const DIGITAL_CARD_PHOTO_BUCKET = 'os-uploads';
export const DIGITAL_CARD_PHOTO_MAX_BYTES = 5_000_000;
export const DIGITAL_CARD_PHOTO_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export function validateDigitalCardPhoto(input: {
  mimeType: string;
  sizeBytes: number;
}): { ok: true } | { ok: false; error: string } {
  const mime = input.mimeType.toLowerCase().split(';')[0]?.trim() || '';
  if (!DIGITAL_CARD_PHOTO_MIME.has(mime)) {
    return {
      ok: false,
      error: 'Use a JPEG, PNG, or WebP image',
    };
  }
  if (input.sizeBytes <= 0) {
    return { ok: false, error: 'Empty file' };
  }
  if (input.sizeBytes > DIGITAL_CARD_PHOTO_MAX_BYTES) {
    return { ok: false, error: 'Photo must be 5 MB or smaller' };
  }
  return { ok: true };
}
