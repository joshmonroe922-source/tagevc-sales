/**
 * Live Look is locked to a single operator identity — not all Visionaries.
 * Nav + server actions must use the same gate.
 */

import type { AppRole } from '@/lib/types/roles';

/** Only this signed-in account may use Live Look (even among Visionaries). */
export const LIVE_LOOK_OPERATOR_EMAIL = 'joshmonroe@tagevc.com';

export function normalizeLiveLookEmail(
  email: string | null | undefined,
): string {
  return (email ?? '').trim().toLowerCase();
}

/**
 * Real identity may hold Live Look cookies / stop sessions.
 * Does not require effective role Visionary (needed while observing).
 */
export function isLiveLookOperator(input: {
  email?: string | null;
  realRole?: AppRole | string | null;
}): boolean {
  if (input.realRole !== 'visionary') return false;
  return (
    normalizeLiveLookEmail(input.email) === LIVE_LOOK_OPERATOR_EMAIL
  );
}

/**
 * May open / search Live Look from nav and start APIs.
 * Requires operator email + real Visionary + effective Visionary
 * (hides during Role Switcher impersonation of other roles).
 */
export function canUseLiveLook(input: {
  email?: string | null;
  realRole?: AppRole | string | null;
  /** Effective (UI) role — must be visionary when provided. */
  effectiveRole?: AppRole | string | null;
  impersonatingAs?: AppRole | string | null;
}): boolean {
  if (!isLiveLookOperator(input)) return false;
  if (input.impersonatingAs) return false;
  if (
    input.effectiveRole != null &&
    input.effectiveRole !== 'visionary'
  ) {
    return false;
  }
  return true;
}
