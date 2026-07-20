import { cookies } from 'next/headers';
import {
  APP_ROLES,
  type AppRole,
  type Permission,
} from '@/lib/types/roles';

/** httpOnly cookie — only honored when the signed-in profile is Visionary. */
export const IMPERSONATION_COOKIE = 'tagevc_impersonate_role';

/**
 * High-stakes actions blocked while Visionary is impersonating another role.
 * Enforced in guardPermission / requirePermission and key server actions.
 */
export const BREAK_GLASS_PERMISSIONS: readonly Permission[] = [
  'action:ic_vote',
  'action:wire',
  'action:docusign_capital',
  'write:capital',
] as const;

export const BREAK_GLASS_MESSAGE =
  'Blocked while impersonating. Exit impersonation to perform capital, IC, wire, or capital DocuSign actions.';

const IMPERSONATABLE_ROLES = APP_ROLES.filter((r) => r !== 'visionary');

/** Exec stages that count as capital deploy / wire. */
export const BREAK_GLASS_EXEC_STAGES = ['Wired / Closed'] as const;

export function listImpersonatableRoles(): AppRole[] {
  return [...IMPERSONATABLE_ROLES];
}

export function isBreakGlassPermission(permission: Permission): boolean {
  return (BREAK_GLASS_PERMISSIONS as readonly string[]).includes(permission);
}

export function isBreakGlassExecStage(stage: string): boolean {
  return (BREAK_GLASS_EXEC_STAGES as readonly string[]).includes(stage);
}

export function parseImpersonationRole(
  value: string | undefined | null,
): AppRole | null {
  if (!value) return null;
  if (!(APP_ROLES as readonly string[]).includes(value)) return null;
  if (value === 'visionary') return null;
  return value as AppRole;
}

export async function readImpersonationCookie(): Promise<AppRole | null> {
  const jar = await cookies();
  return parseImpersonationRole(jar.get(IMPERSONATION_COOKIE)?.value);
}

export async function setImpersonationCookie(role: AppRole) {
  const parsed = parseImpersonationRole(role);
  if (!parsed) {
    throw new Error('Invalid impersonation role');
  }
  const jar = await cookies();
  jar.set(IMPERSONATION_COOKIE, parsed, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12, // 12h; cleared on exit / sign-out
  });
}

export async function clearImpersonationCookie() {
  const jar = await cookies();
  jar.delete(IMPERSONATION_COOKIE);
}
