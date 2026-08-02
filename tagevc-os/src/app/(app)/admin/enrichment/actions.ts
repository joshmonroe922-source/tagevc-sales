'use server';

import { getSessionContext, getSessionUser } from '@/lib/rbac/session';
import { ensureAdminMemberships } from '@/lib/spine/auth/entra-claims';

export async function actionEnsureSpineMemberships() {
  const session = await getSessionContext();
  if (!session) return { ok: false as const, error: 'Unauthorized' };
  if (session.realRole !== 'visionary' && session.profile.role !== 'visionary') {
    return { ok: false as const, error: 'Visionary only' };
  }

  const user = await getSessionUser();
  const entraOid = user?.id || `supabase:${session.profile.id}`;

  return ensureAdminMemberships({
    email: session.profile.email,
    entraOid,
    displayName: session.profile.full_name || session.profile.email,
  });
}
