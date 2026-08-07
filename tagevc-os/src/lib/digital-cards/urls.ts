/**
 * Public card URL builders. Prefer card.tagevc.com; fall back to app host.
 */

import type { SourceChannel } from './types';

const APP_HOST =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ||
  'https://app.tagevc.com';

const CARD_HOST =
  process.env.NEXT_PUBLIC_CARD_HOST?.replace(/\/$/, '') ||
  process.env.DIGITAL_CARD_HOST?.replace(/\/$/, '') ||
  'https://card.tagevc.com';

function envFlag(
  ...keys: Array<string | undefined>
): string | undefined {
  for (const key of keys) {
    const v = key?.trim();
    if (v) return v;
  }
  return undefined;
}

/** When true, use /card/p/{id} on app host (subdomain fallback). */
export function appHostCardPathsEnabled(): boolean {
  // Prefer NEXT_PUBLIC_* so client components (My Card) match server URLs.
  const flag = envFlag(
    process.env.NEXT_PUBLIC_DIGITAL_CARD_USE_APP_HOST,
    process.env.DIGITAL_CARD_USE_APP_HOST,
  );
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;

  const ready = envFlag(
    process.env.NEXT_PUBLIC_DIGITAL_CARD_HOST_READY,
    process.env.DIGITAL_CARD_HOST_READY,
  );
  if (ready === '1' || ready === 'true') return false;
  if (ready === '0' || ready === 'false') return true;

  // Default: canonical card.tagevc.com (DNS live). Opt into app-host via flag.
  return false;
}

export function cardPublicBase(): string {
  if (appHostCardPathsEnabled()) {
    return `${APP_HOST}/card`;
  }
  return CARD_HOST;
}

export function publicCardPath(publicId: string): string {
  return `/p/${encodeURIComponent(publicId)}`;
}

export function publicCardUrl(
  publicId: string,
  opts?: {
    src?: string | null;
    utm_source?: string | null;
    pathAlias?: string | null;
  },
): string {
  const base = cardPublicBase();
  let path = `${base}${publicCardPath(publicId)}`;
  if (opts?.pathAlias) {
    path = `${path}/l/${encodeURIComponent(opts.pathAlias)}`;
  }
  const params = new URLSearchParams();
  if (opts?.src) params.set('src', opts.src);
  if (opts?.utm_source) params.set('utm_source', opts.utm_source);
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}

export function taggedCardUrl(
  publicId: string,
  source: SourceChannel | string,
): string {
  return publicCardUrl(publicId, { src: source });
}

export function nfcUrl(publicId: string): string {
  return taggedCardUrl(publicId, 'nfc');
}

export function parseSourceChannel(
  raw: string | null | undefined,
  pathAlias?: string | null,
): string {
  if (pathAlias?.trim()) {
    const a = pathAlias.trim().toLowerCase();
    if (a === 'linkedin') return 'linkedin';
    if (a.startsWith('event_') || a.startsWith('event-')) {
      return a.replace(/-/g, '_');
    }
    return a.slice(0, 64);
  }
  const s = (raw ?? '').trim().toLowerCase().slice(0, 64);
  if (!s) return 'direct';
  if (/^event[_-]/.test(s)) return s.replace(/-/g, '_');
  return s;
}

export function myCardPath(personaId?: string | null): string {
  if (personaId) return `/my-card?persona=${encodeURIComponent(personaId)}`;
  return '/my-card';
}

export function portalMyCardDeepLink(portalBase: string): string {
  const spine = `${APP_HOST}/my-card`;
  return `${portalBase.replace(/\/$/, '')}/os-link?to=${encodeURIComponent(spine)}`;
}
