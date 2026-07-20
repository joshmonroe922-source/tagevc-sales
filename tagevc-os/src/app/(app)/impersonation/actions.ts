'use server';

import { revalidatePath } from 'next/cache';
import { logActivity } from '@/lib/data/activity';
import {
  clearImpersonationCookie,
  listImpersonatableRoles,
  parseImpersonationRole,
  setImpersonationCookie,
} from '@/lib/rbac/impersonation';
import { getRealProfile } from '@/lib/rbac/session';
import { APP_ROLE_LABELS, type AppRole } from '@/lib/types/roles';

export type ImpersonationResult =
  | { ok: true; role?: AppRole; message?: string }
  | { ok: false; error: string };

async function requireVisionary() {
  const real = await getRealProfile();
  if (!real) return { ok: false as const, error: 'Not signed in' };
  if (real.role !== 'visionary') {
    return {
      ok: false as const,
      error: 'Only Visionary can use role impersonation',
    };
  }
  return { ok: true as const, profile: real };
}

export async function startImpersonationAction(
  role: string,
): Promise<ImpersonationResult> {
  const gate = await requireVisionary();
  if (!gate.ok) return gate;

  const target = parseImpersonationRole(role);
  if (!target || !listImpersonatableRoles().includes(target)) {
    return { ok: false, error: 'Invalid role' };
  }

  await setImpersonationCookie(target);

  void logActivity({
    module: 'auth',
    action: 'impersonation_start',
    title: `Viewing as ${APP_ROLE_LABELS[target]}`,
    detail: `Visionary ${gate.profile.email} started impersonation`,
    ref_type: 'role',
    ref_id: target,
  });

  revalidatePath('/', 'layout');
  return {
    ok: true,
    role: target,
    message: `Now viewing as ${APP_ROLE_LABELS[target]}`,
  };
}

export async function stopImpersonationAction(): Promise<ImpersonationResult> {
  const gate = await requireVisionary();
  if (!gate.ok) {
    // Always clear cookie even if role changed — safe cleanup.
    await clearImpersonationCookie();
    revalidatePath('/', 'layout');
    return gate;
  }

  await clearImpersonationCookie();

  void logActivity({
    module: 'auth',
    action: 'impersonation_stop',
    title: 'Exited role impersonation',
    detail: `Returned to Visionary (${gate.profile.email})`,
    ref_type: 'role',
    ref_id: 'visionary',
  });

  revalidatePath('/', 'layout');
  return { ok: true, message: 'Returned to Visionary' };
}
