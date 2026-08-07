/**
 * QR helpers. Encode the live tagged profile URL only (not a static vCard blob).
 * Uses a lightweight external renderer for images; URL is the source of truth.
 */

import { taggedCardUrl } from './urls';

/** Image URL for a tagged profile QR (bright / high-contrast). */
export function qrImageUrl(
  publicId: string,
  source: string,
  size = 480,
): string {
  const data = taggedCardUrl(publicId, source);
  const params = new URLSearchParams({
    size: `${size}x${size}`,
    data,
    margin: '16',
    bgcolor: 'ffffff',
    color: '3B4559',
  });
  return `https://api.qrserver.com/v1/create-qr-code/?${params.toString()}`;
}

export function qrDownloadFilename(
  displayName: string,
  source: string,
): string {
  const safe = displayName
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40);
  return `${safe || 'card'}-qr-${source}.png`;
}

export const TAGGED_QR_SOURCES = [
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'email_sig', label: 'Email signature' },
  { id: 'nfc', label: 'NFC tag' },
  { id: 'wallet', label: 'Wallet' },
  { id: 'in_app', label: 'In-app' },
  { id: 'desk', label: 'Desk / office' },
  { id: 'direct', label: 'Direct link' },
] as const;
