import { randomBytes } from 'crypto';

/** Opaque stable public_id for QR/NFC URLs. */
export function generatePublicId(): string {
  // 16 bytes → 22-char base64url-ish; alphanumeric for check constraint
  return randomBytes(12).toString('base64url').replace(/[^A-Za-z0-9_-]/g, 'x');
}
