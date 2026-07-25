'use server';

import { revalidatePath } from 'next/cache';
import { getRealProfile, getSessionContext } from '@/lib/rbac/session';
import {
  searchProfilesForLiveLook,
  startLiveLookSession,
  stopLiveLookSession,
} from '@/lib/live-look/server';
import { clearImpersonationCookie } from '@/lib/rbac/impersonation';

export async function searchLiveLookUsersAction(query: string) {
  const ctx = await getSessionContext();
  if (!ctx || ctx.realRole !== 'visionary') {
    return { ok: false as const, error: 'Visionary only', users: [] };
  }
  const users = await searchProfilesForLiveLook(query);
  return { ok: true as const, users };
}

export async function startLiveLookAction(targetProfileId: string) {
  const real = await getRealProfile();
  if (!real || real.role !== 'visionary') {
    return { ok: false as const, error: 'Visionary only' };
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
  if (!real || real.role !== 'visionary') {
    return { ok: false as const, error: 'Visionary only' };
  }
  const result = await stopLiveLookSession({ viewer: real, reason: 'exit' });
  revalidatePath('/', 'layout');
  return result;
}
