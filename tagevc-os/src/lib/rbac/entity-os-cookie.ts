/**
 * Entity OS cookie I/O. Split from `@/lib/rbac/entity-os` so RBAC and nav can
 * import the pure helpers without pulling in `next/headers`.
 */

import { cookies } from 'next/headers';
import {
  FIRM_OS_ENTITY_ID,
  parseEntityOsId,
} from '@/lib/rbac/entity-os';

/** httpOnly cookie — only honored when the signed-in profile is Visionary. */
export const ENTITY_OS_COOKIE = 'tagevc_entity_os';

export async function readEntityOsCookie(): Promise<string | null> {
  const jar = await cookies();
  return parseEntityOsId(jar.get(ENTITY_OS_COOKIE)?.value);
}

export async function setEntityOsCookie(entityId: string) {
  const parsed = parseEntityOsId(entityId);
  if (!parsed) {
    throw new Error('Invalid entity operating system');
  }
  const jar = await cookies();
  jar.set(ENTITY_OS_COOKIE, parsed, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12, // 12h; cleared on exit / sign-out
  });
}

export async function clearEntityOsCookie() {
  const jar = await cookies();
  jar.delete(ENTITY_OS_COOKIE);
}

/** Selecting the parent OS clears the lock rather than storing ENT-FIRM. */
export async function applyEntityOsSelection(entityId: string) {
  if (!parseEntityOsId(entityId) || entityId === FIRM_OS_ENTITY_ID) {
    await clearEntityOsCookie();
    return null;
  }
  await setEntityOsCookie(entityId);
  return parseEntityOsId(entityId);
}
