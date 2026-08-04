/**
 * Entity inheritance — new OS entities get partner enablement rows + marketing presence slots.
 */

import {
  PARTNER_CATALOG,
  PARTNER_SPINE_CONTRACT_VERSION,
  defaultEnabledForEntity,
  type PartnerKey,
} from '@/lib/partners/catalog';
import { entityDisplayName as resolveEntityDisplayName } from '@/lib/entities/display-name';
import type { MarketingPresenceKind } from '@/lib/partners/types';

export type PartnerSpineProvisionPlan = {
  contract_version: typeof PARTNER_SPINE_CONTRACT_VERSION;
  entity_id: string;
  enablements: Array<{
    partner_key: PartnerKey;
    enabled: boolean;
    status: 'scaffold';
  }>;
  marketing_presence: Array<{
    kind: MarketingPresenceKind;
    display_name: string;
    status: 'scaffold';
  }>;
  lifecycle_hooks: {
    joiner: string[];
    leaver: string[];
  };
};

const PRESENCE_KINDS: MarketingPresenceKind[] = [
  'google_business',
  'google_analytics',
  'linkedin_company',
];

const PRESENCE_LABELS: Record<MarketingPresenceKind, string> = {
  google_business: 'Google Business Profile',
  google_analytics: 'GA4 property',
  linkedin_company: 'LinkedIn Company Page',
};

export function buildPartnerSpineProvisionPlan(
  entityId: string,
  companyName?: string,
): PartnerSpineProvisionPlan {
  const label = companyName?.trim() || resolveEntityDisplayName(entityId);
  return {
    contract_version: PARTNER_SPINE_CONTRACT_VERSION,
    entity_id: entityId,
    enablements: PARTNER_CATALOG.map((p) => ({
      partner_key: p.key,
      enabled: defaultEnabledForEntity(p.key, entityId),
      status: 'scaffold' as const,
    })),
    marketing_presence: PRESENCE_KINDS.map((kind) => ({
      kind,
      display_name: `${label} — ${PRESENCE_LABELS[kind]}`,
      status: 'scaffold' as const,
    })),
    lifecycle_hooks: {
      joiner: [
        'partner_spine_enablements_ensure',
        'marketing_presence_slots_ensure',
        'gusto_employee_stub_if_internal',
        'dialpad_user_stub_if_phone',
        'docusign_template_scope_note',
      ],
      leaver: [
        'dialpad_revoke_stub',
        'gusto_terminate_stub',
        'marketing_presence_editor_revoke_stub',
        'apollo_user_revoke_stub',
      ],
    },
  };
}

/** Pure SQL-friendly payload for service upserts. */
export function provisionPlanRows(plan: PartnerSpineProvisionPlan) {
  return {
    bindings: plan.enablements.map((e) => ({
      partner_key: e.partner_key,
      entity_id: plan.entity_id,
      enabled: e.enabled,
      status: 'scaffolded' as const,
    })),
    presence: plan.marketing_presence.map((p) => ({
      kind: p.kind,
      entity_id: plan.entity_id,
      label: p.display_name,
      status: 'scaffolded' as const,
    })),
  };
}
