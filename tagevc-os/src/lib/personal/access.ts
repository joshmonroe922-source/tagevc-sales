import { redirect } from 'next/navigation';
import { canAccessPersonalSection } from '@/lib/net-worth/visibility';
import { getSessionContext } from '@/lib/rbac/session';

/**
 * Gate every /personal/* page — Josh / Visionary only.
 * Think Tank (Lauren), Live Look, and Role Switcher as non-Visionary redirect.
 */
export async function requirePersonalVisionary() {
  const ctx = await getSessionContext();
  if (
    !ctx ||
    !canAccessPersonalSection({
      role: ctx.profile.role,
      realRole: ctx.realRole,
      liveLookActive: ctx.liveLookActive,
    })
  ) {
    redirect('/entities');
  }
  return ctx;
}
