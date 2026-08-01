/**
 * New OS entity → inherit partner spine + marketing presence slots
 * + Vendor Management module (Phase 90).
 *
 * Honest status: scaffold bindings ≠ live partner hooks executed.
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

export type EntityProvisionStatus =
  | 'partial_scaffold'
  | 'ready'
  | 'failed';

export type EntityPartnerProvisionResult = {
  entityId: string;
  /** False until partner hooks execute live — scaffold alone is never success. */
  ok: boolean;
  status: EntityProvisionStatus;
  spineVersion: typeof PARTNER_SPINE_VERSION;
  bindingsCreated: number;
  presenceSlots: number;
  hooks: string[];
  hooksExecutedLive: number;
  readiness: {
    bindings: 'scaffolded' | 'live';
    marketingPresence: 'scaffolded' | 'live';
    lifecycleHooks: 'queued_labels' | 'executed_live';
    vendorMgmt: 'enabled' | 'failed';
  };
  vendorMgmt: {
    ok: boolean;
    spineVersion: typeof VM_SPINE_VERSION;
    code: string;
    error?: string;
  };
  blocking: string[];
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

  const blocking: string[] = [
    'Partner bindings scaffolded — LIVE adapters not executed',
    'Lifecycle hooks are queued labels until credentials + *_LIVE=1',
  ];
  if (!vendorMgmt.ok) {
    blocking.push(vendorMgmt.error || 'Vendor Management enablement failed');
  }

  const status: EntityProvisionStatus = vendorMgmt.ok
    ? 'partial_scaffold'
    : 'failed';
  const ok = false; // never claim success on scaffold-only provision

  await recordPartnerEvent({
    partner_key: 'apollo',
    entity_id: entityId,
    kind: 'provision',
    status: status === 'failed' ? 'failed' : 'processed',
    payload: {
      spine_version: PARTNER_SPINE_VERSION,
      bindings_created: created,
      presence_slots: presenceSlots,
      hooks,
      vendor_mgmt: vendorMgmt,
      provision_status: status,
      ok,
      live_complete: false,
    },
  });

  return {
    entityId,
    ok,
    status,
    spineVersion: PARTNER_SPINE_VERSION,
    bindingsCreated: created,
    presenceSlots,
    hooks,
    hooksExecutedLive: 0,
    readiness: {
      bindings: 'scaffolded',
      marketingPresence: 'scaffolded',
      lifecycleHooks: 'queued_labels',
      vendorMgmt: vendorMgmt.ok ? 'enabled' : 'failed',
    },
    vendorMgmt: {
      ok: vendorMgmt.ok,
      spineVersion: vendorMgmt.spineVersion,
      code: vendorMgmt.code,
      error: vendorMgmt.error,
    },
    blocking,
  };
}
