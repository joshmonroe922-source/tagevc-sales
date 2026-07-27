'use server';

import { revalidatePath } from 'next/cache';
import { getRealProfile, getSessionContext } from '@/lib/rbac/session';
import {
  canUseLiveLook,
  isLiveLookOperator,
} from '@/lib/live-look/access';
import {
  searchProfilesForLiveLook,
  startLiveLookSession,
  stopLiveLookSession,
} from '@/lib/live-look/server';
import { clearImpersonationCookie } from '@/lib/rbac/impersonation';

const LIVE_LOOK_DENIED = 'Live Look is restricted to the Visionary operator';

export async function searchLiveLookUsersAction(query: string) {
  const ctx = await getSessionContext();
  if (
    !ctx ||
    !canUseLiveLook({
      email: ctx.profile.email,
      realRole: ctx.realRole,
      effectiveRole: ctx.profile.role,
      impersonatingAs: ctx.impersonatingAs,
    })
  ) {
    return { ok: false as const, error: LIVE_LOOK_DENIED, users: [] };
  }
  const users = await searchProfilesForLiveLook(query);
  return { ok: true as const, users };
}

export async function startLiveLookAction(targetProfileId: string) {
  const ctx = await getSessionContext();
  const real = await getRealProfile();
  if (
    !ctx ||
    !real ||
    !canUseLiveLook({
      email: real.email,
      realRole: ctx.realRole,
      effectiveRole: ctx.profile.role,
      impersonatingAs: ctx.impersonatingAs,
    })
  ) {
    return { ok: false as const, error: LIVE_LOOK_DENIED };
  }
  // Exit role impersonation when entering Live Look
  try {
    await clearImpersonationCookie();
  } catch {
    /* ignore */
  }
  const result = await startLiveLookSession({
    viewer: real,
    targetProfileId,
  });
  revalidatePath('/', 'layout');
  return result;
}

export async function stopLiveLookAction() {
  const real = await getRealProfile();
  if (!real || !isLiveLookOperator({ email: real.email, realRole: real.role })) {
    return { ok: false as const, error: LIVE_LOOK_DENIED };
  }
  const result = await stopLiveLookSession({ viewer: real, reason: 'exit' });
  revalidatePath('/', 'layout');
  return result;
}
