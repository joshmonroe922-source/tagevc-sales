/**
 * Bridge Vendor Management (Phase 90) → A&F AP vendor portal.
 * Suggests AP rows from vm_vendors without inventing tax status.
 */

import type { AfVendor, VendorTaxStatus } from '@/lib/af/ap/vendors';
import type { EntityCode } from '@/lib/af/types';
import type { VmVendor } from '@/lib/vendor-mgmt/types';

const ENTITY_TO_AF: Record<string, EntityCode> = {
  'ENT-FIRM': 'TVC',
  'ENT-R619': 'R619',
  'ENT-SIGNENT': 'SHR',
  'ENT-INDA': 'INDA',
};

export type VmAfVendorLink = {
  vmVendorId: string;
  afVendorId: string;
  name: string;
  entityCode: EntityCode | 'MULTI';
  category: string | null;
  monthlyUsdHint: number | null;
  href: string;
};

export function mapVmVendorToAfSuggestion(v: VmVendor): AfVendor {
  const entityCode = ENTITY_TO_AF[v.entity_id] ?? 'TVC';
  return {
    id: `VM-${v.id}`,
    entityCode,
    name: v.name,
    email: '',
    status: v.status === 'Active' ? 'Active' : 'Blocked',
    taxStatus: 'w9_missing' as VendorTaxStatus,
    eligible1099: true,
    ytdPayments: 0,
    requiresI9: false,
    i9OnFile: false,
    risk: 'medium',
  };
}

export function buildVmAfVendorLinks(vendors: VmVendor[]): VmAfVendorLink[] {
  return vendors
    .filter((v) => !v.archived_at && v.status === 'Active')
    .map((v) => ({
      vmVendorId: v.id,
      afVendorId: `VM-${v.id}`,
      name: v.name,
      entityCode: ENTITY_TO_AF[v.entity_id] ?? 'TVC',
      category: v.category,
      monthlyUsdHint: null,
      href: `/shared-services/ops/vendor-management/vendors/${v.id}`,
    }));
}
