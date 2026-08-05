/**
 * Workbook entity codes ↔ OS entity_id mapping.
 * Future entities: provisionVendorMgmtForEntity assigns a code + enablement row.
 */

import { entityDisplayName } from '@/lib/entities/display-name';
import type { VmEntityCode } from '@/lib/vendor-mgmt/types';

export const VM_ENTITY_SEED: ReadonlyArray<{
  code: VmEntityCode;
  entity_id: string;
  legal_name: string;
  shared_services_pct: number;
}> = [
  {
    code: 'TAGE',
    entity_id: 'ENT-FIRM',
    legal_name: 'Tage Venture Capital',
    shared_services_pct: 1,
  },
  {
    code: 'R619',
    entity_id: 'ENT-R619',
    legal_name: 'Recruit 619',
    shared_services_pct: 0.25,
  },
  {
    code: 'SHR',
    entity_id: 'ENT-SIGNENT',
    legal_name: 'Signent HR',
    shared_services_pct: 0.25,
  },
  {
    code: 'INDA',
    entity_id: 'ENT-INDA',
    legal_name: 'Instant NDA',
    shared_services_pct: 0.25,
  },
];

const CODE_BY_ENTITY = new Map(
  VM_ENTITY_SEED.map((e) => [e.entity_id, e.code] as const),
);
const ENTITY_BY_CODE = new Map(
  VM_ENTITY_SEED.map((e) => [e.code, e.entity_id] as const),
);

export function vmCodeForEntityId(entityId: string): string | null {
  return CODE_BY_ENTITY.get(entityId) ?? null;
}

/** Alias used by older call sites / redirects. */
export function entityCode(entityId: string): string | null {
  return vmCodeForEntityId(entityId);
}

export function vmEntityIdForCode(code: string): string | null {
  return ENTITY_BY_CODE.get(code as VmEntityCode) ?? null;
}

export function vmEntityLabel(entityId: string): string {
  const row = VM_ENTITY_SEED.find((e) => e.entity_id === entityId);
  return row?.legal_name ?? entityDisplayName(entityId);
}

/** Suggest a short code for a newly provisioned OS entity. */
export function suggestVmCodeForEntity(entityId: string, label?: string): string {
  const known = vmCodeForEntityId(entityId);
  if (known) return known;
  const cleaned = (label || entityId)
    .replace(/^ENT-/i, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 8);
  return cleaned || entityId.slice(0, 8).toUpperCase();
}

export const VM_CORE_ENTITY_IDS = VM_ENTITY_SEED.map((e) => e.entity_id);
