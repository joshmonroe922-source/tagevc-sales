/**
 * Non-secret Marketing brand presence config per entity.
 * Page URLs / GA4 / GBP ids only — never OAuth secrets.
 * Fill linkedin_company_url after Company Pages are live.
 */

import { ENTITY_SELECT_PRIORITY_IDS } from '@/lib/entities/display-order';
import { entityLabel } from '@/lib/entities/display-name';

export type EntityBrandPresence = {
  entity_id: string;
  label: string;
  website_url: string;
  /** Public Company Page URL — empty until Page is renamed/created */
  linkedin_company_url: string;
  /** urn:li:organization:… when known */
  linkedin_organization_urn: string;
  /** GA4 property id (digits) when bound */
  ga4_property_id: string;
  /** Google Business location / place id when bound */
  gbp_location_id: string;
  /** Recruit: update existing GBP only; others: create */
  gbp_mode: 'update' | 'create';
};

/**
 * Canonical placeholders — update strings as Pages/GBP/GA4 go live.
 * Env overrides (optional) win at runtime for CI without code edits.
 */
const DEFAULTS: Record<string, Omit<EntityBrandPresence, 'entity_id' | 'label'>> =
  {
    'ENT-FIRM': {
      website_url: 'https://tagevc.com',
      linkedin_company_url:
        process.env.NEXT_PUBLIC_LINKEDIN_COMPANY_URL_FIRM?.trim() ||
        'https://www.linkedin.com/company/tage-global/',
      linkedin_organization_urn:
        process.env.LINKEDIN_ORG_URN_FIRM?.trim() ||
        'urn:li:organization:105187955',
      ga4_property_id: process.env.GA4_PROPERTY_ID_FIRM ?? '',
      gbp_location_id: process.env.GBP_LOCATION_ID_FIRM ?? '',
      gbp_mode: 'create',
    },
    'ENT-R619': {
      website_url: 'https://recruit619.com',
      linkedin_company_url:
        process.env.NEXT_PUBLIC_LINKEDIN_COMPANY_URL_R619?.trim() ||
        'https://www.linkedin.com/company/619-recruiting/',
      linkedin_organization_urn: process.env.LINKEDIN_ORG_URN_R619 ?? '',
      ga4_property_id: process.env.GA4_PROPERTY_ID_R619 ?? '',
      gbp_location_id: process.env.GBP_LOCATION_ID_R619 ?? '',
      gbp_mode: 'update',
    },
    'ENT-SIGNENT': {
      website_url: 'https://signenthr.com',
      linkedin_company_url:
        process.env.NEXT_PUBLIC_LINKEDIN_COMPANY_URL_SIGNENT?.trim() ||
        'https://www.linkedin.com/company/signent-outsourced-hr/',
      linkedin_organization_urn: process.env.LINKEDIN_ORG_URN_SIGNENT ?? '',
      ga4_property_id: process.env.GA4_PROPERTY_ID_SIGNENT ?? '',
      gbp_location_id: process.env.GBP_LOCATION_ID_SIGNENT ?? '',
      gbp_mode: 'create',
    },
    'ENT-INDA': {
      website_url: 'https://instantnda.us',
      linkedin_company_url: process.env.NEXT_PUBLIC_LINKEDIN_COMPANY_URL_INDA ?? '',
      linkedin_organization_urn: process.env.LINKEDIN_ORG_URN_INDA ?? '',
      ga4_property_id: process.env.GA4_PROPERTY_ID_INDA ?? '',
      gbp_location_id: process.env.GBP_LOCATION_ID_INDA ?? '',
      gbp_mode: 'create',
    },
  };

/** Consolidated → Tage → Recruit → Signent → Instant NDA */
export function entityBrandPresenceOrder(): string[] {
  return [...ENTITY_SELECT_PRIORITY_IDS];
}

export function getEntityBrandPresence(
  entityId: string,
): EntityBrandPresence | null {
  const row = DEFAULTS[entityId];
  if (!row) return null;
  return {
    entity_id: entityId,
    label: entityLabel(entityId),
    ...row,
  };
}

export function listEntityBrandPresence(): EntityBrandPresence[] {
  return entityBrandPresenceOrder()
    .map((id) => getEntityBrandPresence(id))
    .filter((r): r is EntityBrandPresence => r != null);
}

export function linkedInCompanyUrlForEntity(entityId: string): string {
  return getEntityBrandPresence(entityId)?.linkedin_company_url?.trim() ?? '';
}

export type PresenceChannelHealth = {
  kind: 'linkedin_company' | 'google_analytics' | 'google_business';
  label: string;
  connected: boolean;
  external_id: string | null;
  page_url: string | null;
  detail: string;
};

export function summarizePresenceHealth(input: {
  entity_id: string;
  linkedin?: { external_id?: string | null; config?: Record<string, unknown> };
  ga4?: { external_id?: string | null; config?: Record<string, unknown> };
  gbp?: { external_id?: string | null; config?: Record<string, unknown> };
}): PresenceChannelHealth[] {
  const brand = getEntityBrandPresence(input.entity_id);
  const liUrl =
    stringConfig(input.linkedin?.config, 'page_url') ||
    brand?.linkedin_company_url ||
    null;
  const liId =
    input.linkedin?.external_id ||
    brand?.linkedin_organization_urn ||
    null;
  const gaId =
    input.ga4?.external_id || brand?.ga4_property_id || null;
  const gbpId =
    input.gbp?.external_id || brand?.gbp_location_id || null;

  return [
    {
      kind: 'linkedin_company',
      label: 'LinkedIn Company Page',
      connected: Boolean(liId || liUrl),
      external_id: liId,
      page_url: liUrl,
      detail: liUrl
        ? liUrl
        : liId
          ? `URN ${liId}`
          : 'Not connected — rebrand/create Page then attach URL',
    },
    {
      kind: 'google_analytics',
      label: 'Google Analytics (GA4)',
      connected: Boolean(gaId),
      external_id: gaId,
      page_url: null,
      detail: gaId
        ? `Property ${gaId}`
        : 'Not connected — create GA4 property then attach id',
    },
    {
      kind: 'google_business',
      label: 'Google Business Profile',
      connected: Boolean(gbpId),
      external_id: gbpId,
      page_url: null,
      detail: gbpId
        ? `Location ${gbpId}`
        : brand?.gbp_mode === 'update'
          ? 'Not attached — update existing Recruit GBP then bind id'
          : 'Not connected — create GBP then attach location id',
    },
  ];
}

function stringConfig(
  config: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const v = config?.[key];
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t || null;
}
