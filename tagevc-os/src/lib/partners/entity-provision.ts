/**
 * New OS entity → inherit partner spine + marketing presence slots.
 */

import { entityDisplayName } from '@/lib/multi-sub/entity-registry';
import {
  ensureEntityPartnerBindings,
  ensureMarketingPresenceSlots,
  recordPartnerEvent,
} from '@/lib/partners/repo';
import { PARTNER_SPINE_VERSION } from '@/lib/partners/registry';

export type EntityPartnerProvisionResult = {
  entityId: string;
  spineVersion: typeof PARTNER_SPINE_VERSION;
  bindingsCreated: number;
  presenceSlots: number;
  hooks: string[];
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
    },
  });

  return {
    entityId,
    spineVersion: PARTNER_SPINE_VERSION,
    bindingsCreated: created,
    presenceSlots,
    hooks,
  };
}
