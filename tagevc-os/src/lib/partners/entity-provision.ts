/**
 * New OS entity → inherit partner spine + marketing presence slots
 * + Vendor Management module (Phase 90).
 */

import { entityDisplayName } from '@/lib/multi-sub/entity-registry';
import {
  ensureEntityPartnerBindings,
  ensureMarketingPresenceSlots,
  recordPartnerEvent,
} from '@/lib/partners/repo';
import { PARTNER_SPINE_VERSION } from '@/lib/partners/registry';
import { provisionVendorMgmtForEntity } from '@/lib/vendor-mgmt/provision';
import { VM_SPINE_VERSION } from '@/lib/vendor-mgmt/types';

export type EntityPartnerProvisionResult = {
  entityId: string;
  spineVersion: typeof PARTNER_SPINE_VERSION;
  bindingsCreated: number;
  presenceSlots: number;
  hooks: string[];
  vendorMgmt: {
    ok: boolean;
    spineVersion: typeof VM_SPINE_VERSION;
    code: string;
    error?: string;
  };
};

export async function provisionPartnerSpineForEntity(
  entityId: string,
): Promise<EntityPartnerProvisionResult> {
  const label = entityDisplayName(entityId) || entityId;
  const { created, plan } = await ensureEntityPartnerBindings(entityId);
  const presenceSlots = await ensureMarketingPresenceSlots(entityId, label);
  const hooks = plan
    .map((p) => p.lifecycle_hook)
    .filter((h): h is string => Boolean(h));

  const vendorMgmt = await provisionVendorMgmtForEntity(entityId);

  await recordPartnerEvent({
    partner_key: 'apollo',
    entity_id: entityId,
    kind: 'provision',
    status: 'processed',
    payload: {
      spine_version: PARTNER_SPINE_VERSION,
      bindings_created: created,
      presence_slots: presenceSlots,
      hooks,
      vendor_mgmt: vendorMgmt,
    },
  });

  return {
    entityId,
    spineVersion: PARTNER_SPINE_VERSION,
    bindingsCreated: created,
    presenceSlots,
    hooks,
    vendorMgmt: {
      ok: vendorMgmt.ok,
      spineVersion: vendorMgmt.spineVersion,
      code: vendorMgmt.code,
      error: vendorMgmt.error,
    },
  };
}
