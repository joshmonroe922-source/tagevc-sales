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

/** When true, use /card/p/{id} on app host (subdomain not ready). */
export function useAppHostCardPaths(): boolean {
  const flag = process.env.DIGITAL_CARD_USE_APP_HOST?.trim();
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;
  // Default: app-host path until DNS for card.tagevc.com is confirmed live
  return process.env.DIGITAL_CARD_HOST_READY !== '1';
}

export function cardPublicBase(): string {
  if (useAppHostCardPaths()) {
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
