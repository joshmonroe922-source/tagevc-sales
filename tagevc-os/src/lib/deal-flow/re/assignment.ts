/**
 * Sourcer (re_sourcer) assignment — RE leads/assets they own through
 * completion and handoff. Owner field: role labels ("RE Sourcer", "Sourcer")
 * or person name.
 */

import type { ReDeal } from '@/lib/types/entities';
import type { AppRole } from '@/lib/types/roles';

export const RE_ASSIGNMENT_SCOPED_ROLES: readonly AppRole[] = [
  're_sourcer',
] as const;

export function isReAssignmentScopedRole(role: AppRole): boolean {
  return (RE_ASSIGNMENT_SCOPED_ROLES as readonly string[]).includes(role);
}

/** Role-label owners used in seeds / process library for RE sourcers. */
const RE_SOURCER_OWNER_LABELS = new Set([
  'sourcer',
  're sourcer',
  're sources',
  're sourcer — resi',
  're sourcer — cre',
  're sourcer - resi',
  're sourcer - cre',
]);

export function reSourcerMatchesAssignee(
  sourcer: string | null | undefined,
  profileFullName?: string | null,
): boolean {
  const raw = (sourcer ?? '').trim();
  if (!raw) return false;
  const normalized = raw.toLowerCase();
  if (RE_SOURCER_OWNER_LABELS.has(normalized)) return true;
  if (/\bre\s*sourcer\b/.test(normalized) || /\bsourcer\b/.test(normalized)) {
    return true;
  }
  const name = (profileFullName ?? '').trim().toLowerCase();
  if (name.length >= 2 && normalized.includes(name)) return true;
  return false;
}

export function isReDealAssignedToSourcer(input: {
  role: AppRole;
  profileFullName?: string | null;
  deal: Pick<ReDeal, 'sourcer'>;
}): boolean {
  if (!isReAssignmentScopedRole(input.role)) return true;
  return reSourcerMatchesAssignee(input.deal.sourcer, input.profileFullName);
}

export function filterReDealsAssignedToSourcer<
  T extends Pick<ReDeal, 'sourcer'>,
>(
  deals: T[],
  input: {
    role: AppRole | null | undefined;
    profileFullName?: string | null;
  },
): T[] {
  if (!input.role || !isReAssignmentScopedRole(input.role)) return deals;
  return deals.filter((deal) =>
    isReDealAssignedToSourcer({
      role: input.role!,
      profileFullName: input.profileFullName,
      deal,
    }),
  );
}
