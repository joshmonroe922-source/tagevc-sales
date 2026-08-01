/** Multi-subsidiary readiness — entity registry + alias helpers (P1). */

import { entityDisplayName as resolveEntityDisplayName } from '@/lib/entities/display-name';

export const MS_P1_CONTRACT_VERSION = 'ms-p1-v1' as const;

export const CANONICAL_SUBSIDIARY_CODES = ['ENT-R619', 'ENT-SIGNENT', 'ENT-INDA'] as const;
export type CanonicalSubsidiaryCode =
  (typeof CANONICAL_SUBSIDIARY_CODES)[number];

/** Legacy Instant NDA seed code → canonical ENT-INDA. */
export const ENTITY_ALIASES: Record<string, string> = {
  'ENT-002': 'ENT-INDA',
};

export const ENTITY_REGISTRY_SEED = [
  {
    entity_code: 'ENT-FIRM',
    canonical_name: 'Tage Venture Capital',
    status: 'Active' as const,
    portal_url: 'https://app.tagevc.com',
    desk_url: null as string | null,
    portal_url_todo: null as string | null,
    is_subsidiary: false,
  },
  {
    entity_code: 'ENT-R619',
    canonical_name: 'Recruit 619',
    status: 'Active' as const,
    portal_url: 'https://portal.recruit619.com',
    /** Day-to-day recruiter UX (My Recruiting Desk on portal). */
    desk_url: 'https://portal.recruit619.com/desk/my-recruiting-desk' as string | null,
    portal_url_todo: null as string | null,
    is_subsidiary: true,
  },
  {
    entity_code: 'ENT-SIGNENT',
    canonical_name: 'Signent HR',
    status: 'Active' as const,
    /** Uses Tage HRIS with client segmentation — portal desk scaffolds separately. */
    portal_url: 'https://app.tagevc.com',
    desk_url: null as string | null,
    portal_url_todo:
      'Signent client portal SSO — HRIS tenancy is shared with Tage (see docs/HRIS_SPINE.md)' as string | null,
    is_subsidiary: true,
  },
  {
    entity_code: 'ENT-INDA',
    canonical_name: 'Instant NDA',
    status: 'Active' as const,
    portal_url: 'https://portal.instantnda.us',
    desk_url: null as string | null,
    portal_url_todo: null as string | null,
    is_subsidiary: true,
  },
] as const;

export type EntityPolicySpine = {
  directory_visibility:
    | 'home_only'
    | 'home_plus_firm'
    | 'firm_wide'
    | 'cross_entity_opt_in';
  cross_entity_messaging:
    | 'deny'
    | 'dm_opt_in_rooms_deny'
    | 'opt_in'
    | 'firm_wide_operators';
  ticket_visibility_default:
    | 'entity_scoped'
    | 'entity_plus_unscoped_soft'
    | 'firm_wide';
  contract_version: typeof MS_P1_CONTRACT_VERSION;
  money_auto_approve: false;
};

export const DEFAULT_ENTITY_POLICY: EntityPolicySpine = {
  directory_visibility: 'home_plus_firm',
  cross_entity_messaging: 'dm_opt_in_rooms_deny',
  ticket_visibility_default: 'entity_scoped',
  contract_version: MS_P1_CONTRACT_VERSION,
  money_auto_approve: false,
};

export function resolveCanonicalEntityId(
  entityId: string | null | undefined,
): string | null {
  const raw = entityId?.trim();
  if (!raw) return null;
  return ENTITY_ALIASES[raw] ?? raw;
}

export function entityIdsEquivalent(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return resolveCanonicalEntityId(a) === resolveCanonicalEntityId(b);
}

export function entityDisplayName(entityId: string | null | undefined): string {
  const canon = resolveCanonicalEntityId(entityId);
  if (!canon) return 'Unscoped';
  return resolveEntityDisplayName(canon, canon);
}

export function isRegisteredSubsidiary(
  entityId: string | null | undefined,
): boolean {
  const canon = resolveCanonicalEntityId(entityId);
  return (
    canon === 'ENT-R619' ||
    canon === 'ENT-SIGNENT' ||
    canon === 'ENT-INDA' ||
    Boolean(
      ENTITY_REGISTRY_SEED.find(
        (e) => e.entity_code === canon && e.is_subsidiary,
      ),
    )
  );
}

export function parentVsSubsidiaryLabel(
  entityId: string | null | undefined,
): 'parent' | 'subsidiary' | 'unscoped' {
  const canon = resolveCanonicalEntityId(entityId);
  if (!canon) return 'unscoped';
  if (canon === 'ENT-FIRM') return 'parent';
  if (isRegisteredSubsidiary(canon)) return 'subsidiary';
  return 'subsidiary';
}
