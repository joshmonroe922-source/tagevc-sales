/**
 * Canonical company / entity order for ALL scope dropdowns.
 * Consolidated → Tage Venture Capital → Recruit 619 → Signent HR → Instant NDA → rest A–Z.
 */

import {
  entityDisplayName,
  normalizeEntityId,
} from '@/lib/entities/display-name';

/** Select value used for multi-entity rollup when the control supports it. */
export const CONSOLIDATED_SELECT_VALUE = 'consolidated' as const;

export const CONSOLIDATED_SELECT_LABEL = 'Consolidated';

/**
 * Fixed priority entity ids (after Consolidated).
 * Signent may be omitted from lists until provisioned — relative order still holds.
 */
export const ENTITY_SELECT_PRIORITY_IDS = [
  'ENT-FIRM',
  'ENT-R619',
  'ENT-SIGNENT',
  'ENT-INDA',
] as const;

/** Primary labels for the five named slots (never raw ENT-* in UI). */
export const ENTITY_SELECT_LABELS: Record<string, string> = {
  [CONSOLIDATED_SELECT_VALUE]: CONSOLIDATED_SELECT_LABEL,
  'ENT-FIRM': 'Tage Venture Capital',
  'ENT-R619': 'Recruit 619',
  'ENT-SIGNENT': 'Signent HR',
  'ENT-INDA': 'Instant NDA',
};

export type EntitySelectLike = {
  entity_id?: string | null;
  value?: string | null;
  id?: string | null;
  name?: string | null;
  label?: string | null;
  canonical_name?: string | null;
  company_name?: string | null;
};

function entityKey(item: EntitySelectLike | string): string {
  if (typeof item === 'string') return normalizeEntityId(item);
  const raw =
    item.entity_id ?? item.value ?? item.id ?? '';
  return normalizeEntityId(String(raw));
}

function displayLabel(item: EntitySelectLike | string): string {
  if (typeof item === 'string') {
    const id = normalizeEntityId(item);
    return ENTITY_SELECT_LABELS[id] ?? entityDisplayName(id);
  }
  const id = entityKey(item);
  if (id === CONSOLIDATED_SELECT_VALUE || id === '') {
    return (
      clean(item.label) ||
      clean(item.name) ||
      CONSOLIDATED_SELECT_LABEL
    );
  }
  return (
    ENTITY_SELECT_LABELS[id] ||
    clean(item.label) ||
    clean(item.name) ||
    clean(item.canonical_name) ||
    clean(item.company_name) ||
    entityDisplayName(id)
  );
}

function clean(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

function priorityRank(id: string): number {
  if (id === CONSOLIDATED_SELECT_VALUE || id === '') return 0;
  const idx = ENTITY_SELECT_PRIORITY_IDS.indexOf(
    id as (typeof ENTITY_SELECT_PRIORITY_IDS)[number],
  );
  if (idx >= 0) return idx + 1;
  return 1000;
}

/**
 * Sort entities for select / filter UI.
 * Consolidated (if present) always first; then the five named companies in
 * fixed order; any future entities append A–Z by display name.
 */
export function sortEntitiesForSelect<T extends EntitySelectLike | string>(
  entities: readonly T[],
): T[] {
  return [...entities].sort((a, b) => {
    const idA = entityKey(a);
    const idB = entityKey(b);
    const rankA = priorityRank(idA);
    const rankB = priorityRank(idB);
    if (rankA !== rankB) return rankA - rankB;
    if (rankA < 1000) return 0;
    return displayLabel(a).localeCompare(displayLabel(b), undefined, {
      sensitivity: 'base',
    });
  });
}

/** Resolve the preferred select label for an entity id (or consolidated). */
export function entitySelectLabel(
  entityId: string | null | undefined,
): string {
  const id = (entityId ?? '').trim();
  if (!id || id === CONSOLIDATED_SELECT_VALUE) {
    return CONSOLIDATED_SELECT_LABEL;
  }
  const canon = normalizeEntityId(id);
  return ENTITY_SELECT_LABELS[canon] ?? entityDisplayName(canon);
}

/**
 * Default company options for forms (no Consolidated — use allowConsolidated
 * on CompanySelect when rollup is supported).
 * Signent omitted until product policy provisions it in the registry.
 */
export const DEFAULT_COMPANY_SELECT_OPTIONS: Array<{
  value: string;
  label: string;
}> = sortEntitiesForSelect([
  { value: 'ENT-FIRM', label: ENTITY_SELECT_LABELS['ENT-FIRM'] },
  { value: 'ENT-R619', label: ENTITY_SELECT_LABELS['ENT-R619'] },
  { value: 'ENT-INDA', label: ENTITY_SELECT_LABELS['ENT-INDA'] },
  // Sample Closed Co (ENT-001) / Sample Indy SFR (ENT-003) intentionally omitted —
  // registry-visibility hides them from operating pickers.
]).map((o) => ({
  value: String((o as { value: string }).value),
  label: String((o as { label: string }).label),
}));
