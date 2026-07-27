/**
 * M&A Associate assignment — only targets/projects they own or are assigned to.
 * Owner field conventions: role labels ("Associate", "M&A Associate") or person name.
 */

import type { MaTarget } from '@/lib/types/entities';
import type { AppRole } from '@/lib/types/roles';

export const MA_ASSIGNMENT_SCOPED_ROLES: readonly AppRole[] = [
  'ma_associate',
] as const;

export function isMaAssignmentScopedRole(role: AppRole): boolean {
  return (MA_ASSIGNMENT_SCOPED_ROLES as readonly string[]).includes(role);
}

/** Role-label owners used in seeds / process library for M&A associates. */
const MA_ASSOCIATE_OWNER_LABELS = new Set([
  'associate',
  'm&a associate',
  'ma associate',
  'manda associate',
]);

export function maOwnerMatchesAssociate(
  owner: string | null | undefined,
  profileFullName?: string | null,
): boolean {
  const raw = (owner ?? '').trim();
  if (!raw) return false;
  const normalized = raw.toLowerCase();
  if (MA_ASSOCIATE_OWNER_LABELS.has(normalized)) return true;
  // "M&A Associate — Jane" / "Associate: Josh"
  if (
    /\bm&a\s*associate\b/.test(normalized) ||
    /\bma\s*associate\b/.test(normalized)
  ) {
    return true;
  }
  // Bare "Associate" (process library / seed convention) — not Partner/Counsel.
  if (normalized === 'associate' || /^associate\b/.test(normalized)) {
    return true;
  }
  const name = (profileFullName ?? '').trim().toLowerCase();
  if (name.length >= 2 && normalized.includes(name)) return true;
  return false;
}

export function isMaTargetAssignedToAssociate(input: {
  role: AppRole;
  profileFullName?: string | null;
  target: Pick<MaTarget, 'owner'>;
}): boolean {
  if (!isMaAssignmentScopedRole(input.role)) return true;
  return maOwnerMatchesAssociate(input.target.owner, input.profileFullName);
}

export function filterMaTargetsAssignedToAssociate<
  T extends Pick<MaTarget, 'owner'>,
>(
  targets: T[],
  input: {
    role: AppRole | null | undefined;
    profileFullName?: string | null;
  },
): T[] {
  if (!input.role || !isMaAssignmentScopedRole(input.role)) return targets;
  return targets.filter((target) =>
    isMaTargetAssignedToAssociate({
      role: input.role!,
      profileFullName: input.profileFullName,
      target,
    }),
  );
}
