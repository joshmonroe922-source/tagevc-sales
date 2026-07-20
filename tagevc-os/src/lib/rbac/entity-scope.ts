import type { AppRole } from '@/lib/types/roles';

const FIRM_WIDE_ROLES: readonly AppRole[] = [
  'visionary',
  'admin',
  'partner',
  'associate',
  'coo',
  'counsel_ops',
  'service_lead',
] as const;

/** Firm-wide operators (or unset / ENT-FIRM profile) see all entities. */
export function isFirmWideAccess(
  role: AppRole,
  entityId: string | null | undefined,
): boolean {
  if (FIRM_WIDE_ROLES.includes(role)) return true;
  if (!entityId || entityId === 'ENT-FIRM') return true;
  return false;
}

/**
 * App-layer entity scope check (defense in depth with Phase 17 RLS).
 * Subsidiary-scoped roles may only touch their entity (and children via SQL).
 */
export function canAccessEntityId(
  role: AppRole,
  profileEntityId: string | null | undefined,
  targetEntityId: string | null | undefined,
): boolean {
  if (isFirmWideAccess(role, profileEntityId)) return true;
  if (!targetEntityId) return true; // unscoped rows (firm tickets/docs)
  if (!profileEntityId) return false;
  return profileEntityId === targetEntityId;
}

export function entityScopeDeniedMessage(targetEntityId: string): string {
  return `You do not have access to entity ${targetEntityId}`;
}
