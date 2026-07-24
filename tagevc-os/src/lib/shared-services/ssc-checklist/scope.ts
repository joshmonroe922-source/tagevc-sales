/** Company scope resolution for SSC checklists (Tage only). */

import { ENTITY_REGISTRY_SEED } from '@/lib/multi-sub/entity-registry';
import { entityDisplayNameFromId } from '@/lib/entities/display-name';
import type { SscScopeMode } from './types';

export const SSC_PARENT_ENTITY = 'ENT-FIRM';

export type SscScopedCompany = {
  entity_id: string;
  company_name: string;
  is_subsidiary: boolean;
};

export function listSscCompanies(): SscScopedCompany[] {
  return ENTITY_REGISTRY_SEED.map((e) => ({
    entity_id: e.entity_code,
    company_name: e.canonical_name,
    is_subsidiary: e.is_subsidiary,
  }));
}

export function resolveScopeEntityIds(
  scopeMode: SscScopeMode,
  singleEntityId?: string | null,
): string[] {
  const all = listSscCompanies();
  if (scopeMode === 'parent') return [SSC_PARENT_ENTITY];
  if (scopeMode === 'subs') {
    return all.filter((c) => c.is_subsidiary).map((c) => c.entity_id);
  }
  if (scopeMode === 'parent_subs') {
    return all.map((c) => c.entity_id);
  }
  const id = singleEntityId?.trim();
  if (!id) return [SSC_PARENT_ENTITY];
  return [id];
}

export function companyName(entityId: string | null | undefined): string {
  if (!entityId) return 'Firm-wide';
  return entityDisplayNameFromId(entityId);
}
