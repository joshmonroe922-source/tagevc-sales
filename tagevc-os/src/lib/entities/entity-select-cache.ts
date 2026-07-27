/**
 * Cached entity options for SSC / scope dropdowns.
 * Avoid refetching the full directory on every function navigation.
 */

import { ENTITY_REGISTRY_SEED } from '@/lib/multi-sub/entity-registry';
import {
  DEFAULT_COMPANY_SELECT_OPTIONS,
  sortEntitiesForSelect,
  entitySelectLabel,
} from '@/lib/entities/display-order';

export type CachedEntityOption = {
  value: string;
  label: string;
  is_subsidiary: boolean;
};

let cache: { at: number; options: CachedEntityOption[] } | null = null;
const TTL_MS = 5 * 60 * 1000;

function buildFromRegistry(): CachedEntityOption[] {
  const fromSeed = ENTITY_REGISTRY_SEED.map((e) => ({
    value: e.entity_code,
    label: entitySelectLabel(e.entity_code),
    is_subsidiary: e.is_subsidiary,
  }));
  return sortEntitiesForSelect(fromSeed).map((o) => ({
    value: String((o as CachedEntityOption).value),
    label: String((o as CachedEntityOption).label),
    is_subsidiary: Boolean((o as CachedEntityOption).is_subsidiary),
  }));
}

/** Sync read of known operating entities (registry seed + defaults). */
export function getCachedEntitySelectOptions(): CachedEntityOption[] {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.options;
  const options = buildFromRegistry();
  cache = { at: now, options };
  return options;
}

/** Invalidate after admin entity provisioning (rare). */
export function invalidateEntitySelectCache(): void {
  cache = null;
}

/** Fallback static options when registry is empty. */
export function getDefaultEntitySelectOptions(): Array<{
  value: string;
  label: string;
}> {
  return DEFAULT_COMPANY_SELECT_OPTIONS.filter((o) =>
    ['ENT-FIRM', 'ENT-R619', 'ENT-INDA'].includes(o.value),
  );
}
