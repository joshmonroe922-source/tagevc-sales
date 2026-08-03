/**
 * Server-only active org cookie reader.
 */

import { cookies } from 'next/headers';
import {
  SPINE_ACTIVE_ORG_COOKIE,
  isSpineOrgSlug,
  type SpineOrgSlug,
} from '@/lib/spine/auth/active-org';

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
