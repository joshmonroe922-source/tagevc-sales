/**
 * Assets list assignment — COO (subsidiaries) / Subsidiary Leader only see
 * companies & RE they are assigned to lead (`coo_owner` / profile entity).
 */

import { normalizeEntityId } from '@/lib/entities/display-name';
import type { Entity } from '@/lib/types/entities';
import type { AppRole } from '@/lib/types/roles';

export const LEAD_SCOPED_ASSET_ROLES: readonly AppRole[] = [
  'coo',
  'sub_lead',
] as const;

/** Demo / impersonation default when Visionary switches to Subsidiary Leader. */
export const DEFAULT_SUBSIDIARY_LEADER_ENTITY_ID = 'ENT-R619';

export function isLeadScopedAssetRole(role: AppRole): boolean {
  return (LEAD_SCOPED_ASSET_ROLES as readonly string[]).includes(role);
}

/**
 * Resolve the single company a Subsidiary Leader is leading.
 * Firm / empty profile entity (common when Visionary impersonates) → Recruit 619.
 */
export function resolveSubsidiaryLeaderEntityId(
  profileEntityId: string | null | undefined,
): string {
  const id = normalizeEntityId(profileEntityId);
  if (!id || id === 'ENT-FIRM') return DEFAULT_SUBSIDIARY_LEADER_ENTITY_ID;
  return id;
}

function cooOwnerMatchesProfile(
  cooOwner: string,
  profileFullName: string | null | undefined,
): boolean {
  const owner = cooOwner.trim().toLowerCase();
  if (!owner) return false;
  // Seed / ops convention: "COO — Ops Lead", "COO: Recruit", etc.
  if (/\bcoo\b/.test(owner)) return true;
  const name = (profileFullName ?? '').trim().toLowerCase();
  if (name.length >= 2 && owner.includes(name)) return true;
  return false;
}

/**
 * True when this operator should see the entity under Assets → Businesses / Real Estate.
 * Callers still apply sample/registry hide filters separately.
 */
export function isAssignedToLeadEntity(input: {
  role: AppRole;
  profileEntityId: string | null | undefined;
  profileFullName?: string | null;
  entity: Pick<Entity, 'entity_id' | 'coo_owner' | 'parent_entity_id'>;
}): boolean {
  const { role, profileEntityId, profileFullName, entity } = input;

  if (role === 'sub_lead') {
    const led = resolveSubsidiaryLeaderEntityId(profileEntityId);
    return led === normalizeEntityId(entity.entity_id);
  }

  if (role === 'coo') {
    const owner = (entity.coo_owner ?? '').trim();
    if (!owner) return false; // unassigned — hide
    return cooOwnerMatchesProfile(owner, profileFullName);
  }

  return true;
}

export function filterEntitiesAssignedToLead<
  T extends Pick<Entity, 'entity_id' | 'coo_owner' | 'parent_entity_id'>,
>(
  entities: T[],
  input: {
    role: AppRole | null | undefined;
    profileEntityId: string | null | undefined;
    profileFullName?: string | null;
  },
): T[] {
  if (!input.role || !isLeadScopedAssetRole(input.role)) return entities;
  return entities.filter((entity) =>
    isAssignedToLeadEntity({
      role: input.role!,
      profileEntityId: input.profileEntityId,
      profileFullName: input.profileFullName,
      entity,
    }),
  );
}
