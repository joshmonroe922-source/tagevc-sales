/**
 * Live Look — read-only observation of another user's OS.
 * Restricted to joshmonroe@tagevc.com as Visionary (see access.ts).
 * Distinct from role impersonation (which can act). No notify to target.
 */

import { cookies } from 'next/headers';

export const LIVE_LOOK_COOKIE = 'tagevc_live_look_user';

export const LIVE_LOOK_BLOCK_MESSAGE =
  'Live Look is read-only. Exit Live Look to make changes.';

export type LiveLookTarget = {
  profileId: string;
  email: string;
  fullName: string | null;
  role: string;
  entityId: string | null;
};

export async function readLiveLookCookie(): Promise<string | null> {
  const jar = await cookies();
  const v = jar.get(LIVE_LOOK_COOKIE)?.value?.trim();
  if (!v) return null;
  // UUID-ish profile ids
  if (!/^[0-9a-f-]{36}$/i.test(v)) return null;
  return v;
}

export async function setLiveLookCookie(profileId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(profileId)) {
    throw new Error('Invalid Live Look target');
  }
  const jar = await cookies();
  jar.set(LIVE_LOOK_COOKIE, profileId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 4, // 4h
  });
}

export async function clearLiveLookCookie() {
  const jar = await cookies();
  jar.delete(LIVE_LOOK_COOKIE);
}
