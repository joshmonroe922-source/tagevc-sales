/**
 * Entity OS switcher — one login session, every entity operating system.
 *
 * Firm-wide Visionary can move between the parent OS (Tage VC) and each
 * subsidiary OS (Recruit 619, Signent HR, Instant NDA, future entities)
 * without signing in again. Everyone else stays in the single OS they were
 * hired into (`profiles.entity_id`).
 *
 * Scope direction is always *narrowing*: Visionary already holds firm-wide
 * access, so selecting an entity restricts app-layer reads/writes and shell
 * branding to that entity. It can never grant access the profile lacks.
 *
 * Mutually exclusive with Role Switcher impersonation and Live Look — both of
 * those already rewrite the effective profile, so stacking scopes would make
 * the visible surface ambiguous.
 *
 * Pure module (no `next/headers`) so RBAC + nav can import it. Cookie I/O
 * lives in `@/lib/rbac/entity-os-cookie`.
 */

import { entityDisplayName, normalizeEntityId } from '@/lib/entities/display-name';
import { entitySelectLabel } from '@/lib/entities/display-order';
import { getCachedEntitySelectOptions } from '@/lib/entities/entity-select-cache';
import { isHiddenRegistryEntity } from '@/lib/entities/registry-visibility';
import type { AppRole } from '@/lib/types/roles';

/** Parent OS. Selecting it means "no entity lock" — full firm-wide view. */
export const FIRM_OS_ENTITY_ID = 'ENT-FIRM';

/** Compact brand-line labels for the sidebar eyebrow (full names in the menu). */
const ENTITY_OS_SHORT_LABELS: Record<string, string> = {
  'ENT-FIRM': 'Tage VC',
  'ENT-R619': 'Recruit 619',
  'ENT-SIGNENT': 'Signent HR',
  'ENT-INDA': 'Instant NDA',
};

export type EntityOsOption = {
  entityId: string;
  /** Menu label — full company name. */
  label: string;
  /** Sidebar brand-line label — compact company name. */
  shortLabel: string;
  isSubsidiary: boolean;
};

/**
 * Every operating system a firm-wide operator may enter, parent first.
 * Ordered by the canonical entity select order (Tage → R619 → Signent → INDA
 * → future entities A–Z); sample / legacy-alias rows are excluded.
 */
export function listEntityOsOptions(): EntityOsOption[] {
  const registry = getCachedEntitySelectOptions()
    .filter(
      (o) =>
        !isHiddenRegistryEntity({
          entity_id: o.value,
          canonical_name: o.label,
        }),
    )
    .map((o) => ({
      entityId: normalizeEntityId(o.value),
      label: entitySelectLabel(o.value),
      shortLabel: entityOsShortLabel(o.value),
      isSubsidiary: o.is_subsidiary,
    }));

  const seen = new Set<string>();
  const options: EntityOsOption[] = [];
  for (const option of registry) {
    if (!option.entityId || seen.has(option.entityId)) continue;
    seen.add(option.entityId);
    options.push(option);
  }

  // Registry can be empty on a cold clone — always offer the parent OS.
  if (!seen.has(FIRM_OS_ENTITY_ID)) {
    options.unshift({
      entityId: FIRM_OS_ENTITY_ID,
      label: entitySelectLabel(FIRM_OS_ENTITY_ID),
      shortLabel: entityOsShortLabel(FIRM_OS_ENTITY_ID),
      isSubsidiary: false,
    });
  }
  return options;
}

export function entityOsShortLabel(entityId: string | null | undefined): string {
  const id = normalizeEntityId(entityId);
  if (!id) return ENTITY_OS_SHORT_LABELS[FIRM_OS_ENTITY_ID];
  return ENTITY_OS_SHORT_LABELS[id] ?? entityDisplayName(id);
}

export function entityOsLabel(entityId: string | null | undefined): string {
  const id = normalizeEntityId(entityId);
  if (!id) return entitySelectLabel(FIRM_OS_ENTITY_ID);
  return entitySelectLabel(id);
}

/**
 * Cookie value → locked entity id. Returns null for the parent OS, unknown
 * ids, and malformed input so a stale cookie degrades to firm-wide.
 */
export function parseEntityOsId(
  value: string | null | undefined,
): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(raw)) return null;
  const id = normalizeEntityId(raw);
  if (!id || id === FIRM_OS_ENTITY_ID) return null;
  const known = listEntityOsOptions().some((o) => o.entityId === id);
  return known ? id : null;
}

/** True when the session is locked into a single subsidiary OS. */
export function isEntityOsScoped(
  activeEntityOs: string | null | undefined,
): boolean {
  const id = normalizeEntityId(activeEntityOs);
  return Boolean(id) && id !== FIRM_OS_ENTITY_ID;
}

/**
 * Only a real firm-wide Visionary sees the switcher, and only when no other
 * identity override is already in play.
 */
export function canSwitchEntityOs(input: {
  realRole: AppRole;
  impersonatingAs?: AppRole | null;
  liveLookActive?: boolean;
}): boolean {
  if (input.realRole !== 'visionary') return false;
  if (input.impersonatingAs) return false;
  if (input.liveLookActive) return false;
  return true;
}
