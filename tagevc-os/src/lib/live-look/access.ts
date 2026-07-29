/**
 * Live Look operators:
 * 1. Visionary Josh Monroe — view everyone in the tenant
 * 2. Think Tank (real or Role Switcher preview) — everyone except Josh
 */

import type { AppRole } from '@/lib/types/roles';

/** Josh’s Visionary account — sole full-tenant Live Look operator among Visionaries. */
export const LIVE_LOOK_OPERATOR_EMAIL = 'joshmonroe@tagevc.com';

/** Think Tank cannot observe this identity. */
export const LIVE_LOOK_EXCLUDED_EMAIL = LIVE_LOOK_OPERATOR_EMAIL;

export type LiveLookViewerMode = 'visionary_full' | 'think_tank_scoped';

export function normalizeLiveLookEmail(
  email: string | null | undefined,
): string {
  return (email ?? '').trim().toLowerCase();
}

export function isJoshMonroeLiveLookEmail(
  email: string | null | undefined,
): boolean {
  return normalizeLiveLookEmail(email) === LIVE_LOOK_OPERATOR_EMAIL;
}

/** @deprecated Prefer isJoshMonroeLiveLookEmail — same Josh identity. */
export function isLiveLookExcludedTarget(
  email: string | null | undefined,
): boolean {
  return isJoshMonroeLiveLookEmail(email);
}

/**
 * Which Live Look policy applies for this viewer, or null if denied.
 */
export function liveLookViewerMode(input: {
  email?: string | null;
  realRole?: AppRole | string | null;
  effectiveRole?: AppRole | string | null;
  impersonatingAs?: AppRole | string | null;
}): LiveLookViewerMode | null {
  const real = input.realRole ?? null;
  const effective = input.effectiveRole ?? null;
  const imp = input.impersonatingAs ?? null;

  // Real Think Tank assignment
  if (real === 'think_tank') {
    if (imp && imp !== 'think_tank') return null;
    if (effective != null && effective !== 'think_tank') return null;
    return 'think_tank_scoped';
  }

  // Visionary Josh only (not other Visionary accounts)
  if (
    real === 'visionary' &&
    isJoshMonroeLiveLookEmail(input.email)
  ) {
    // Role Switcher → Think Tank preview uses Think Tank target rules
    if (imp === 'think_tank' || effective === 'think_tank') {
      return 'think_tank_scoped';
    }
    // Other Role Switcher personas: no Live Look
    if (imp) return null;
    if (effective != null && effective !== 'visionary') return null;
    return 'visionary_full';
  }

  return null;
}

/**
 * Real identity may hold Live Look cookies / stop sessions.
 */
export function isLiveLookOperator(input: {
  email?: string | null;
  realRole?: AppRole | string | null;
  impersonatingAs?: AppRole | string | null;
  effectiveRole?: AppRole | string | null;
}): boolean {
  return liveLookViewerMode(input) != null;
}

/**
 * May open / search Live Look from nav and start APIs.
 */
export function canUseLiveLook(input: {
  email?: string | null;
  realRole?: AppRole | string | null;
  effectiveRole?: AppRole | string | null;
  impersonatingAs?: AppRole | string | null;
}): boolean {
  return liveLookViewerMode(input) != null;
}

/**
 * Target filter by viewer mode.
 * Visionary Josh: all tenant users (self still blocked at start).
 * Think Tank: everyone except Josh Monroe.
 */
export function canLiveLookTarget(
  email: string | null | undefined,
  mode: LiveLookViewerMode | null | undefined,
): boolean {
  if (!email?.trim() || !mode) return false;
  if (mode === 'think_tank_scoped' && isJoshMonroeLiveLookEmail(email)) {
    return false;
  }
  return true;
}
