import { isEntityOsScoped } from '@/lib/rbac/entity-os';
import type { AppRole } from '@/lib/types/roles';

const FIRM_WIDE_ROLES: readonly AppRole[] = [
  'visionary',
  'think_tank',
  'admin',
  'partner',
  'associate',
  'coo',
  'counsel_ops',
  'service_lead',
  'ssc_finance',
  'ssc_hr',
  'ssc_legal',
  'ssc_it',
  'ssc_marketing',
] as const;

export type EntityParentIndex = Map<string, string | null | undefined>;

/** soft = null entity_id visible to all; hide = subsidiary roles only see scoped rows. */
export type PipelineNullEntityMode = 'soft' | 'hide';

export function getPipelineNullEntityMode(): PipelineNullEntityMode {
  const raw = (process.env.PIPELINE_NULL_ENTITY_MODE ?? 'hide')
    .trim()
    .toLowerCase();
  return raw === 'soft' ? 'soft' : 'hide';
}

/**
 * Firm-wide operators (or unset / ENT-FIRM profile) see all entities.
 *
 * `activeEntityOs` is the Entity OS switcher lock (Visionary only). While it
 * is set, a firm-wide operator is deliberately narrowed to that subsidiary's
 * operating system, so firm-wide reads are off until they exit.
 */
export function isFirmWideAccess(
  role: AppRole,
  entityId: string | null | undefined,
  activeEntityOs?: string | null,
): boolean {
  // Subsidiary Leader is always single-company scoped (never firm-wide).
  if (role === 'sub_lead') return false;
  if (isEntityOsScoped(activeEntityOs)) return false;
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
  activeEntityOs?: string | null,
): boolean {
  if (isFirmWideAccess(role, profileEntityId, activeEntityOs)) return true;
  if (!targetEntityId) return true; // unscoped rows (master-data soft)
  if (!profileEntityId) return false;
  if (profileEntityId === targetEntityId) return true;
  if (parentByEntityId) {
    const parent = parentByEntityId.get(targetEntityId);
    if (parent && parent === profileEntityId) return true;
  }
  return false;
}

/**
 * Pipeline row scope. Phase 19 default: hide null-entity rows from subsidiary roles.
 * Set PIPELINE_NULL_ENTITY_MODE=soft to restore Phase 18 visibility.
 */
export function canAccessPipelineEntity(
  role: AppRole,
  profileEntityId: string | null | undefined,
  rowEntityId: string | null | undefined,
  parentByEntityId?: EntityParentIndex,
  nullMode: PipelineNullEntityMode = getPipelineNullEntityMode(),
  activeEntityOs?: string | null,
): boolean {
  if (isFirmWideAccess(role, profileEntityId, activeEntityOs)) return true;
  if (!rowEntityId) {
    return nullMode === 'soft';
  }
  return canAccessEntityId(
    role,
    profileEntityId,
    rowEntityId,
    parentByEntityId,
    activeEntityOs,
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
