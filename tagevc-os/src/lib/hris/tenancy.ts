/**
 * HRIS tenancy model — one operational HRIS platform for Tage + all entities.
 *
 * Signent HR is a fractional/outsourced HR subsidiary that sells HR services
 * and segments **client** workforces on this same spine (multi-tenant clients),
 * not a separate HRIS product.
 *
 * No fake client rows — seams only until Signent onboards real clients.
 */

import type { HrisAudience } from '@/lib/hris/types';

export const HRIS_TENANCY_CONTRACT = 'hris-tenancy-v1' as const;

/** Operating entities that inherit the firm HRIS. */
export const HRIS_OPERATING_ENTITY_IDS = [
  'ENT-FIRM',
  'ENT-R619',
  'ENT-SIGNENT',
  'ENT-INDA',
] as const;

export type HrisOperatingEntityId =
  (typeof HRIS_OPERATING_ENTITY_IDS)[number];

/**
 * Tenant kind on the shared HRIS:
 * - `operating` — Tage / subsidiary employees (entity_id = OS entity)
 * - `signent_client` — external Signent HR customer workforce (client_org_id)
 */
export type HrisTenantKind = 'operating' | 'signent_client';

export type HrisTenantRef =
  | {
      kind: 'operating';
      entityId: HrisOperatingEntityId | string;
      clientOrgId?: null;
    }
  | {
      kind: 'signent_client';
      /** Always ENT-SIGNENT — Signent operates the engagement. */
      entityId: 'ENT-SIGNENT';
      /** Opaque client org id (UUID) when provisioned — never invent. */
      clientOrgId: string;
    };

export function isHrisOperatingEntity(entityId: string | null | undefined): boolean {
  return Boolean(
    entityId &&
      (HRIS_OPERATING_ENTITY_IDS as readonly string[]).includes(entityId),
  );
}

/** Signent client segmentation uses ENT-SIGNENT + client_org_id. */
export function isSignentClientTenant(ref: HrisTenantRef): boolean {
  return ref.kind === 'signent_client' && Boolean(ref.clientOrgId);
}

export function hrisAudienceForEntity(
  entityId: string | null | undefined,
): HrisAudience {
  if (entityId === 'ENT-R619') return 'recruit619';
  if (entityId === 'ENT-SIGNENT') return 'signent';
  if (entityId === 'ENT-FIRM') return 'parent';
  return 'all';
}

/**
 * Filter predicate for roster queries — operating entity OR (Signent + client).
 * Callers pass clientOrgId only when a real Signent client is selected.
 */
export function hrisTenantMatchSqlHint(ref: HrisTenantRef): {
  entity_id: string;
  client_org_id: string | null;
} {
  if (ref.kind === 'signent_client') {
    return { entity_id: 'ENT-SIGNENT', client_org_id: ref.clientOrgId };
  }
  return { entity_id: ref.entityId, client_org_id: null };
}

export const SIGNENT_HRIS_MODEL = {
  product: 'Same Tage HRIS platform (not a fork)',
  seller: 'Signent HR (ENT-SIGNENT) — wholly owned Tage Global subsidiary',
  segmentation: 'client_org_id under ENT-SIGNENT',
  firmEmployees: 'entity_id = ENT-SIGNENT without client_org_id',
  portalUrl: 'https://portal.signenthr.com',
  marketingUrl: 'https://www.signenthr.com',
  hiring: 'Tage OS HR Shared Services process; employed by Signent HR',
} as const;
