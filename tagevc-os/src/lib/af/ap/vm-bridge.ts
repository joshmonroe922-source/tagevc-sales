/**
 * Bridge Vendor Management (Phase 90) → A&F AP vendor portal.
 * D05=B: Auto-create AP vendor when VM vendor is Active (W-9 still missing).
 */

import type { AfVendor, VendorTaxStatus } from '@/lib/af/ap/vendors';
import type { EntityCode } from '@/lib/af/types';
import { ENTITY_INVOICE_INBOXES } from '@/lib/af/ap/invoice-inbox';
import type { VmVendor } from '@/lib/vendor-mgmt/types';
import { createPersistClient } from '@/lib/supabase/persist-client';

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
  apCreated?: boolean;
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

function invoiceAliasFor(entityCode: EntityCode): string | null {
  return (
    ENTITY_INVOICE_INBOXES.find((i) => i.entityCode === entityCode)
      ?.suggestedAddress ?? null
  );
}

/**
 * Persist AP vendor row for an Active VM vendor (idempotent upsert by af_vendor_key).
 * Fail-soft when SQL not applied.
 */
export async function ensureApVendorFromVm(
  v: VmVendor,
): Promise<{ ok: boolean; afVendorKey: string; created: boolean; error?: string }> {
  const afVendorKey = `VM-${v.id}`;
  if (v.status !== 'Active' || v.archived_at) {
    return {
      ok: false,
      afVendorKey,
      created: false,
      error: 'VM vendor must be Active',
    };
  }
  const entityCode = ENTITY_TO_AF[v.entity_id] ?? 'TVC';
  try {
    const sb = await createPersistClient();
    const { data: existing } = await sb
      .from('os_af_ap_vendors')
      .select('id')
      .eq('af_vendor_key', afVendorKey)
      .maybeSingle();

    if (existing?.id) {
      await sb
        .from('os_af_ap_vendors')
        .update({
          name: v.name,
          status: 'Active',
          entity_code: entityCode,
          invoice_inbox_alias: invoiceAliasFor(entityCode),
          updated_at: new Date().toISOString(),
        })
        .eq('af_vendor_key', afVendorKey);
      return { ok: true, afVendorKey, created: false };
    }

    const { error } = await sb.from('os_af_ap_vendors').insert({
      af_vendor_key: afVendorKey,
      vm_vendor_id: v.id,
      entity_code: entityCode,
      name: v.name,
      email: '',
      status: 'Active',
      tax_status: 'w9_missing',
      eligible_1099: true,
      invoice_inbox_alias: invoiceAliasFor(entityCode),
    });
    if (error) {
      return { ok: false, afVendorKey, created: false, error: error.message };
    }
    return { ok: true, afVendorKey, created: true };
  } catch (e) {
    return {
      ok: false,
      afVendorKey,
      created: false,
      error: e instanceof Error ? e.message : 'AP vendor upsert failed',
    };
  }
}

/** Best-effort: ensure AP rows for all Active VM vendors in a list. */
export async function syncActiveVmVendorsToAp(vendors: VmVendor[]): Promise<{
  created: number;
  updated: number;
  errors: string[];
}> {
  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  for (const v of vendors.filter((x) => x.status === 'Active' && !x.archived_at)) {
    const res = await ensureApVendorFromVm(v);
    if (!res.ok) {
      if (res.error) errors.push(`${v.name}: ${res.error}`);
      continue;
    }
    if (res.created) created += 1;
    else updated += 1;
  }
  return { created, updated, errors };
}
