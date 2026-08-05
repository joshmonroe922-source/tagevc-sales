/**
 * User-facing company names. Prefer these over raw entity codes (ENT-*).
 * Entity IDs remain for routing, RBAC, and admin/debug only.
 *
 * UI rule: never use entity_id / ENT-* as the primary human label.
 * Use `entityDisplayName` / `entityLabel` (or `<EntityBadge />`) everywhere
 * entities appear in the product UI.
 */

const KNOWN_ENTITY_NAMES: Record<string, string> = {
  'ENT-FIRM': 'Tage Venture Capital',
  'ENT-R619': 'Recruit 619',
  'ENT-INDA': 'Instant NDA',
  'ENT-SIGNENT': 'Signent HR',
  'ENT-002': 'Instant NDA', // legacy alias
  'ENT-001': 'Sample Closed Co',
  'ENT-003': 'Sample Indy SFR',
};

/** Normalize legacy aliases to the canonical registry code. */
export function normalizeEntityId(
  entityId: string | null | undefined,
): string {
  const raw = (entityId ?? '').trim();
  if (!raw) return '';
  if (raw === 'ENT-002') return 'ENT-INDA';
  return raw;
}

export type EntityDisplayFields = {
  entity_id?: string | null;
  canonical_name?: string | null;
  legal_name?: string | null;
  company_name?: string | null;
  display_name?: string | null;
  name?: string | null;
};

export type EntityDisplayInput =
  | EntityDisplayFields
  | string
  | null
  | undefined;

/**
 * Human-readable company name for UI surfaces.
 * Accepts a string entity id or an object with name fields.
 * Never returns blank — falls back to known map, then a soft label.
 * Never returns a raw ENT-* id as the label when a known name exists.
 */
export function entityDisplayName(
  input: EntityDisplayInput,
  fallback = 'Unknown company',
): string {
  if (input == null) return fallback;
  if (typeof input === 'string') {
    return entityDisplayName({ entity_id: input }, fallback);
  }

  const fromFields =
    clean(input.canonical_name) ||
    clean(input.display_name) ||
    clean(input.company_name) ||
    clean(input.legal_name) ||
    clean(input.name);
  if (fromFields) return fromFields;

  const id = normalizeEntityId(input.entity_id);
  if (id && KNOWN_ENTITY_NAMES[id]) return KNOWN_ENTITY_NAMES[id];
  if (input.entity_id && KNOWN_ENTITY_NAMES[input.entity_id.trim()]) {
    return KNOWN_ENTITY_NAMES[input.entity_id.trim()];
  }
  return fallback;
}

/**
 * Alias for `entityDisplayName` — prefer this name in new UI code.
 * Values stay as entity ids for APIs/RLS; labels come from here.
 */
export function entityLabel(
  input: EntityDisplayInput,
  fallback = 'Unknown company',
): string {
  return entityDisplayName(input, fallback);
}

/** Resolve a display name when only an entity id string is available. */
export function entityDisplayNameFromId(
  entityId: string | null | undefined,
  fallback = 'Unknown company',
): string {
  return entityDisplayName(entityId, fallback);
}

/** PageHeader / filter chip context: "Entity · Recruit 619". */
export function entityScopeContext(
  entityId: string | null | undefined,
  firmWideFallback = 'Firm-wide',
): string {
  const id = (entityId ?? '').trim();
  if (!id) return firmWideFallback;
  return `Entity · ${entityDisplayName(id)}`;
}

/** Optional muted secondary line for admin/debug (entity code). */
export function entityCodeHint(
  entityId: string | null | undefined,
): string | null {
  const id = (entityId ?? '').trim();
  if (!id) return null;
  return id;
}

/**
 * Compact label for secondary UI (tables, muted lines).
 * Null/empty entity → `emptyLabel` (e.g. "firm" / "firm-wide").
 */
export function entityLabelOrFirm(
  entityId: string | null | undefined,
  emptyLabel = 'firm',
): string {
  const id = (entityId ?? '').trim();
  if (!id) return emptyLabel;
  return entityDisplayName(id);
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
