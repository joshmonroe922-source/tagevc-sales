/** Messaging multi-entity helpers (P3). */

import {
  entityIdsEquivalent,
  resolveCanonicalEntityId,
  type EntityPolicySpine,
  DEFAULT_ENTITY_POLICY,
} from '@/lib/multi-sub/entity-registry';

export const MS_P3_CONTRACT_VERSION = 'ms-p3-v1' as const;

export type DirectoryProfileWithBadge = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
  active: boolean;
  entity_id: string | null;
  entity_badge: string | null;
  is_home?: boolean;
};

export type CrossEntityDecision = {
  allowed: boolean;
  reason: string;
  actor_entity_id: string | null;
  peer_entity_id: string | null;
  kind: string;
  policy: EntityPolicySpine['cross_entity_messaging'];
  money_auto_approve: false;
  contract_version: typeof MS_P3_CONTRACT_VERSION;
};

export function decideCrossEntityMessage(input: {
  actorEntityId: string | null | undefined;
  peerEntityId: string | null | undefined;
  kind?: 'dm' | 'group' | 'channel' | string;
  firmWideOperator?: boolean;
  policy?: EntityPolicySpine['cross_entity_messaging'];
}): CrossEntityDecision {
  const actor = resolveCanonicalEntityId(input.actorEntityId);
  const peer = resolveCanonicalEntityId(input.peerEntityId);
  const kind = (input.kind || 'dm').toLowerCase();
  const policy = input.policy ?? DEFAULT_ENTITY_POLICY.cross_entity_messaging;

  if (input.firmWideOperator) {
    return {
      allowed: true,
      reason: 'firm_wide_operator',
      actor_entity_id: actor,
      peer_entity_id: peer,
      kind,
      policy,
      money_auto_approve: false,
      contract_version: MS_P3_CONTRACT_VERSION,
    };
  }
  if (entityIdsEquivalent(actor, peer)) {
    return {
      allowed: true,
      reason: 'same_entity',
      actor_entity_id: actor,
      peer_entity_id: peer,
      kind,
      policy,
      money_auto_approve: false,
      contract_version: MS_P3_CONTRACT_VERSION,
    };
  }
  if (policy === 'deny') {
    return {
      allowed: false,
      reason: 'policy_deny',
      actor_entity_id: actor,
      peer_entity_id: peer,
      kind,
      policy,
      money_auto_approve: false,
      contract_version: MS_P3_CONTRACT_VERSION,
    };
  }
  if (policy === 'firm_wide_operators') {
    return {
      allowed: false,
      reason: 'operators_only',
      actor_entity_id: actor,
      peer_entity_id: peer,
      kind,
      policy,
      money_auto_approve: false,
      contract_version: MS_P3_CONTRACT_VERSION,
    };
  }
  if (kind === 'dm' && (policy === 'dm_opt_in_rooms_deny' || policy === 'opt_in')) {
    return {
      allowed: true,
      reason: 'dm_opt_in',
      actor_entity_id: actor,
      peer_entity_id: peer,
      kind,
      policy,
      money_auto_approve: false,
      contract_version: MS_P3_CONTRACT_VERSION,
    };
  }
  if (kind !== 'dm' && policy === 'dm_opt_in_rooms_deny') {
    return {
      allowed: false,
      reason: 'rooms_deny_cross_entity',
      actor_entity_id: actor,
      peer_entity_id: peer,
      kind,
      policy,
      money_auto_approve: false,
      contract_version: MS_P3_CONTRACT_VERSION,
    };
  }
  if (policy === 'opt_in') {
    return {
      allowed: true,
      reason: 'opt_in',
      actor_entity_id: actor,
      peer_entity_id: peer,
      kind,
      policy,
      money_auto_approve: false,
      contract_version: MS_P3_CONTRACT_VERSION,
    };
  }
  return {
    allowed: false,
    reason: 'default_deny',
    actor_entity_id: actor,
    peer_entity_id: peer,
    kind,
    policy,
    money_auto_approve: false,
    contract_version: MS_P3_CONTRACT_VERSION,
  };
}

export function subsidiaryMessagesDeepLink(entityId: string | null | undefined): {
  tage_messages: string;
  portal_messages: string | null;
  todo: string | null;
} {
  const canon = resolveCanonicalEntityId(entityId);
  const tage = 'https://app.tagevc.com/messages';
  if (canon === 'ENT-R619') {
    return {
      tage_messages: tage,
      portal_messages: 'https://portal.recruit619.com/messages',
      todo: null,
    };
  }
  if (canon === 'ENT-INDA') {
    return {
      tage_messages: tage,
      portal_messages: null,
      // TODO: Instant NDA portal URL for SSO deep-links
      todo: 'TODO: Instant NDA portal URL for SSO deep-links',
    };
  }
  return { tage_messages: tage, portal_messages: null, todo: null };
}

export const DEFAULT_CHANNELS_BY_ENTITY: Record<
  string,
  Array<{ channel_key: string; title: string }>
> = {
  'ENT-R619': [
    { channel_key: 'general', title: 'Recruit 619 · General' },
    { channel_key: 'shared-services', title: 'Recruit 619 · Shared Services' },
  ],
  'ENT-INDA': [
    { channel_key: 'general', title: 'Instant NDA · General' },
    { channel_key: 'support', title: 'Instant NDA · Support' },
  ],
  'ENT-FIRM': [
    { channel_key: 'shared-services', title: 'Tage · Shared Services' },
  ],
};
