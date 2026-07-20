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

export type EntityParentIndex = Map<string, string | null | undefined>;

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
 * App-layer entity scope (defense in depth with Phase 17/18 RLS).
 * Optional parent index mirrors SQL can_access_entity (direct child).
 */
export function canAccessEntityId(
  role: AppRole,
  profileEntityId: string | null | undefined,
  targetEntityId: string | null | undefined,
  parentByEntityId?: EntityParentIndex,
): boolean {
  if (isFirmWideAccess(role, profileEntityId)) return true;
  if (!targetEntityId) return true; // unscoped rows
  if (!profileEntityId) return false;
  if (profileEntityId === targetEntityId) return true;
  if (parentByEntityId) {
    const parent = parentByEntityId.get(targetEntityId);
    if (parent && parent === profileEntityId) return true;
  }
  return false;
}

/** Soft scope for pipeline rows: null entity_id is visible to everyone. */
export function canAccessPipelineEntity(
  role: AppRole,
  profileEntityId: string | null | undefined,
  rowEntityId: string | null | undefined,
  parentByEntityId?: EntityParentIndex,
): boolean {
  if (isFirmWideAccess(role, profileEntityId)) return true;
  if (!rowEntityId) return true;
  return canAccessEntityId(
    role,
    profileEntityId,
    rowEntityId,
    parentByEntityId,
  );
}

export function entityScopeDeniedMessage(targetEntityId: string): string {
  return `You do not have access to entity ${targetEntityId}`;
}

export function buildParentIndex(
  entities: Array<{ entity_id: string; parent_entity_id: string | null }>,
): EntityParentIndex {
  return new Map(entities.map((e) => [e.entity_id, e.parent_entity_id]));
}
