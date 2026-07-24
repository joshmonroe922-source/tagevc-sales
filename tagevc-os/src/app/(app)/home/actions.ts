'use server';

import { generateHomeBriefing } from '@/lib/home/briefing';
import { getSessionContext } from '@/lib/rbac/session';

export async function refreshHomeBriefingAction() {
  const session = await getSessionContext();
  if (!session) return { ok: false as const, error: 'Not signed in' };
  const briefing = await generateHomeBriefing(session);
  return { ok: true as const, briefing };
}
