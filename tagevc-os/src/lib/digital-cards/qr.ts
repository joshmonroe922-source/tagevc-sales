/**
 * QR helpers. Encode the live tagged profile URL only (not a static vCard blob).
 * Images are rendered by the self-hosted /api/card/qr route.
 */

import { taggedCardUrl } from './urls';

/** Image URL for a tagged profile QR (bright / high-contrast). */
export function qrImageUrl(
  publicId: string,
  source: string,
  size = 480,
): string {
  const params = new URLSearchParams({
    src: source,
    size: String(size),
  });
  return `/api/card/qr/${encodeURIComponent(publicId)}?${params.toString()}`;
}

/** Absolute QR image URL (for email signatures / external embeds). */
export function qrImageAbsoluteUrl(
  publicId: string,
  source: string,
  size = 480,
): string {
  const path = qrImageUrl(publicId, source, size);
  const app =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ||
    'https://app.tagevc.com';
  // Prefer app host so QR always resolves even when card subdomain is CDN-only
  return `${app}${path}`;
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

/** @deprecated Prefer qrImageUrl — kept for tests/docs referencing the old helper. */
export function legacyExternalQrImageUrl(
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
