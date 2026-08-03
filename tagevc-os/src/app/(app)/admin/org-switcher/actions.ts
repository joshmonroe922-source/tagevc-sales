'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  SPINE_ACTIVE_ORG_COOKIE,
  isSpineOrgSlug,
  type SpineOrgSlug,
} from '@/lib/spine/auth/active-org';

export async function setActiveOrgAction(
  slug: string,
): Promise<{ ok: true; slug: SpineOrgSlug } | { ok: false; error: string }> {
  if (!isSpineOrgSlug(slug)) {
    return { ok: false, error: 'invalid org slug' };
  }
  const jar = await cookies();
  jar.set(SPINE_ACTIVE_ORG_COOKIE, slug, {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath('/', 'layout');
  return { ok: true, slug };
}
