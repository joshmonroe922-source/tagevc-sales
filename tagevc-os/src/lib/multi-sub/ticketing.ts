/** Multi-subsidiary ticketing helpers (P2) — context links + fail-closed entity. */

import {
  entityIdsEquivalent,
  resolveCanonicalEntityId,
} from '@/lib/multi-sub/entity-registry';

export const MS_P2_CONTRACT_VERSION = 'ms-p2-v1' as const;

export const RECRUIT_CONTEXT_LINK_TYPES = [
  'r619_account',
  'r619_person',
  'r619_job',
  'r619_placement',
  'r619_application',
  'r619_offer',
] as const;

export const INDA_CONTEXT_LINK_TYPES = [
  'inda_customer',
  'inda_subscription',
  'inda_lead',
  'inda_support_case',
  'inda_usage_event',
] as const;

export type ContextLinkType =
  | (typeof RECRUIT_CONTEXT_LINK_TYPES)[number]
  | (typeof INDA_CONTEXT_LINK_TYPES)[number];

export type TicketContextLink = {
  link_type: ContextLinkType | string;
  external_ref: string;
  label?: string;
  href?: string;
};

const LINK_ENTITY: Record<string, string> = {
  r619_account: 'ENT-R619',
  r619_person: 'ENT-R619',
  r619_job: 'ENT-R619',
  r619_placement: 'ENT-R619',
  r619_application: 'ENT-R619',
  r619_offer: 'ENT-R619',
  inda_customer: 'ENT-INDA',
  inda_subscription: 'ENT-INDA',
  inda_lead: 'ENT-INDA',
  inda_support_case: 'ENT-INDA',
  inda_usage_event: 'ENT-INDA',
};

export function contextLinkEntity(linkType: string): string | null {
  return LINK_ENTITY[linkType] ?? null;
}

export function validateContextLinksForEntity(
  entityId: string,
  links: TicketContextLink[],
): { ok: true } | { ok: false; error: string } {
  const canon = resolveCanonicalEntityId(entityId);
  if (!canon) return { ok: false, error: 'entity_id required for context links' };
  for (const link of links) {
    const expected = contextLinkEntity(link.link_type);
    if (!expected) {
      return { ok: false, error: `Unknown context link type: ${link.link_type}` };
    }
    if (!entityIdsEquivalent(expected, canon)) {
      return {
        ok: false,
        error: `Link type ${link.link_type} belongs to ${expected}, not ${canon}`,
      };
    }
    if (!link.external_ref?.trim()) {
      return { ok: false, error: 'external_ref required on context links' };
    }
  }
  return { ok: true };
}

/**
 * Fail-closed entity requirement for new ticket creates.
 * Accepts legacy ENT-002 and normalizes to ENT-INDA.
 */
export function requireTicketEntityId(
  entityId: string | null | undefined,
  opts?: { allowFirmDefault?: boolean },
): { ok: true; entity_id: string } | { ok: false; error: string } {
  const raw = entityId?.trim();
  if (!raw) {
    if (opts?.allowFirmDefault) {
      return { ok: true, entity_id: 'ENT-FIRM' };
    }
    return {
      ok: false,
      error:
        'entity_id is required (fail-closed). Use ENT-R619, ENT-INDA, ENT-FIRM, or a registered entity code.',
    };
  }
  const canon = resolveCanonicalEntityId(raw);
  if (!canon || !/^ENT-[A-Z0-9-]{1,32}$/.test(canon)) {
    return { ok: false, error: `Invalid entity_id: ${raw}` };
  }
  return { ok: true, entity_id: canon };
}

export function filterTicketsByEntityAndService<
  T extends { entity_id?: string | null; service?: string },
>(
  tickets: T[],
  opts: { entityId?: string | null; service?: string | null },
): T[] {
  return tickets.filter((t) => {
    if (opts.entityId) {
      if (!entityIdsEquivalent(t.entity_id, opts.entityId)) return false;
    }
    if (opts.service && t.service !== opts.service) return false;
    return true;
  });
}
