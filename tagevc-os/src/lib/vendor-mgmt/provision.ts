/**
 * Future OS entities inherit Vendor Management via this provisioner.
 * Wired alongside Phase 89 partner spine.
 */

import { entityDisplayName } from '@/lib/multi-sub/entity-registry';
import { suggestVmCodeForEntity } from '@/lib/vendor-mgmt/entities';
import {
  appendAuditEvent,
  ensureVmEntityEnablement,
} from '@/lib/vendor-mgmt/repo';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { VM_SPINE_VERSION } from '@/lib/vendor-mgmt/types';

export type VmProvisionResult = {
  entityId: string;
  code: string;
  spineVersion: typeof VM_SPINE_VERSION;
  enabled: boolean;
  ok: boolean;
  error?: string;
};

/**
 * Upsert entity code alias + module enablement for a new OS entity.
 * Does not invent vendors — empty stack ready for CRUD in the portal.
 */
export async function provisionVendorMgmtForEntity(
  entityId: string,
  opts?: { code?: string; legalName?: string; sharedServicesPct?: number },
): Promise<VmProvisionResult> {
  const label = opts?.legalName || entityDisplayName(entityId) || entityId;
  const code = opts?.code || suggestVmCodeForEntity(entityId, label);

  try {
    const sb = await createPersistClient();
    await sb.from('vm_entity_codes').upsert(
      {
        code,
        entity_id: entityId,
        legal_name: label,
        entity_type: entityId === 'ENT-FIRM' ? 'Parent' : 'Subsidiary',
        parent_code: entityId === 'ENT-FIRM' ? null : 'TAGE',
        status: 'Active',
        currency: 'USD',
        shared_services_pct: opts?.sharedServicesPct ?? 0.25,
        notes: 'Provisioned via Vendor Management spine',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'code' },
    );

    await sb.from('vm_revenue_inputs').upsert({
      entity_id: entityId,
      ttm_revenue: 0,
      updated_at: new Date().toISOString(),
    });
  } catch {
    // fail-soft — enablement row still attempted
  }

  const enabled = await ensureVmEntityEnablement(entityId, code);
  await appendAuditEvent({
    action: 'vendor.module.provision',
    entity_id: entityId,
    object_type: 'entity_module',
    object_id: entityId,
    new_value: code,
  });

  return {
    entityId,
    code,
    spineVersion: VM_SPINE_VERSION,
    enabled,
    ok: enabled,
    error: enabled ? undefined : 'enablement upsert failed',
  };
}
