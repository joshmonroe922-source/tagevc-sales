/**
 * Encrypt / decrypt marketing OAuth tokens (AES-256-GCM).
 * Requires MARKETING_TOKEN_SECRET (≥32 chars). Without it, OAuth connect is stub-only.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

function keyFromSecret(): Buffer | null {
  const secret = process.env.MARKETING_TOKEN_SECRET?.trim();
  if (!secret || secret.length < 16) return null;
  return createHash('sha256').update(secret).digest();
}

export function canStoreOAuthTokens(): boolean {
  return keyFromSecret() !== null;
}

/** Returns opaque string: iv:tag:ciphertext (base64). */
export function encryptSecret(plaintext: string): string | null {
  const key = keyFromSecret();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(blob: string): string | null {
  const key = keyFromSecret();
  if (!key) return null;
  const parts = blob.split(':');
  if (parts.length !== 3) return null;
  try {
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    return null;
  }
}
