/**
 * Active org cookie for org switcher (C2 UX).
 * Cookie is the UX switch; JWT org_ids[] remains the RLS source of truth.
 */

import { cookies } from 'next/headers';

export const SPINE_ACTIVE_ORG_COOKIE = 'spine_active_org';

export const SPINE_ORG_OPTIONS = [
  { slug: 'tage', label: 'Tage VC', entityId: 'ENT-FIRM' },
  { slug: 'recruit619', label: 'Recruit 619', entityId: 'ENT-R619' },
  { slug: 'signent', label: 'Signent HR', entityId: 'ENT-SIGNENT' },
  { slug: 'instant_nda', label: 'Instant NDA', entityId: 'ENT-INDA' },
] as const;

export type SpineOrgSlug = (typeof SPINE_ORG_OPTIONS)[number]['slug'];

export function isSpineOrgSlug(v: string): v is SpineOrgSlug {
  return SPINE_ORG_OPTIONS.some((o) => o.slug === v);
}

export async function getActiveOrgSlug(
  fallback: SpineOrgSlug = 'tage',
): Promise<SpineOrgSlug> {
  try {
    const jar = await cookies();
    const raw = jar.get(SPINE_ACTIVE_ORG_COOKIE)?.value || '';
    if (isSpineOrgSlug(raw)) return raw;
  } catch {
    /* cookies() unavailable outside request */
  }
  return fallback;
}
