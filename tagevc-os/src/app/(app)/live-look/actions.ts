'use server';

import { revalidatePath } from 'next/cache';
import { getRealProfile, getSessionContext } from '@/lib/rbac/session';
import {
  canUseLiveLook,
  isLiveLookOperator,
  liveLookViewerMode,
} from '@/lib/live-look/access';
import {
  searchProfilesForLiveLook,
  startLiveLookSession,
  stopLiveLookSession,
} from '@/lib/live-look/server';
import {
  clearImpersonationCookie,
  readImpersonationCookie,
} from '@/lib/rbac/impersonation';

const LIVE_LOOK_DENIED =
  'Live Look is restricted to Visionary Josh or Think Tank';

export async function searchLiveLookUsersAction(query: string) {
  const ctx = await getSessionContext();
  const mode = ctx
    ? liveLookViewerMode({
        email: ctx.profile.email,
        realRole: ctx.realRole,
        effectiveRole: ctx.liveLookActive
          ? ctx.impersonatingAs === 'think_tank'
            ? 'think_tank'
            : ctx.realRole === 'think_tank'
              ? 'think_tank'
              : 'visionary'
          : ctx.profile.role,
        impersonatingAs: ctx.impersonatingAs,
      })
    : null;
  if (
    !ctx ||
    !mode ||
    !canUseLiveLook({
      email: ctx.profile.email,
      realRole: ctx.realRole,
      effectiveRole: ctx.liveLookActive
        ? mode === 'think_tank_scoped'
          ? 'think_tank'
          : 'visionary'
        : ctx.profile.role,
      impersonatingAs: ctx.impersonatingAs,
    })
  ) {
    return { ok: false as const, error: LIVE_LOOK_DENIED, users: [] };
  }
  const users = await searchProfilesForLiveLook(query, 25, mode);
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

  const mode = liveLookViewerMode({
    email: real.email,
    realRole: ctx.realRole,
    effectiveRole: ctx.profile.role,
    impersonatingAs: ctx.impersonatingAs,
  });

  // Visionary full mode: exit Role Switcher when entering Live Look.
  // Think Tank preview: keep think_tank impersonation so operator status holds.
  if (mode === 'visionary_full') {
    try {
      await clearImpersonationCookie();
    } catch {
      /* ignore */
    }
  } else if (ctx.impersonatingAs && ctx.impersonatingAs !== 'think_tank') {
    try {
      await clearImpersonationCookie();
    } catch {
      /* ignore */
    }
  }

  const result = await startLiveLookSession({
    viewer: real,
    targetProfileId,
    effectiveRole:
      mode === 'think_tank_scoped' ? 'think_tank' : 'visionary',
    impersonatingAs:
      mode === 'think_tank_scoped' ? 'think_tank' : null,
  });
  revalidatePath('/', 'layout');
  return result;
}

export async function stopLiveLookAction() {
  const real = await getRealProfile();
  const impersonatingAs = real ? await readImpersonationCookie() : null;
  if (
    !real ||
    !isLiveLookOperator({
      email: real.email,
      realRole: real.role,
      impersonatingAs,
    })
  ) {
    return { ok: false as const, error: LIVE_LOOK_DENIED };
  }
  const result = await stopLiveLookSession({
    viewer: real,
    reason: 'exit',
    impersonatingAs,
  });
  revalidatePath('/', 'layout');
  return result;
}
