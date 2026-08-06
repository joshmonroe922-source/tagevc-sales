/**
 * Gusto company ↔ Tage entity mapping (fail-closed).
 * One Gusto company + OAuth grant per OS employer entity.
 * Never fall back to ENT-FIRM / global token for subsidiaries.
 * See docs/GUSTO_MULTI_ENTITY.md.
 */

import { listPartnerBindings } from '@/lib/partners/repo';

export const GUSTO_ENTITY_IDS = [
  'ENT-FIRM',
  'ENT-R619',
  'ENT-SIGNENT',
  'ENT-INDA',
] as const;

export type GustoEntityId = (typeof GUSTO_ENTITY_IDS)[number];

/** Env suffix for per-entity bootstrap vars (GUSTO_COMPANY_UUID_R619, …). */
const ENV_SUFFIX_BY_ENTITY: Record<GustoEntityId, string> = {
  'ENT-FIRM': 'FIRM',
  'ENT-R619': 'R619',
  'ENT-SIGNENT': 'SIGNENT',
  'ENT-INDA': 'INDA',
};

export type GustoCompanyResolution = {
  entityId: GustoEntityId;
  companyUuid: string | null;
  accessToken: string | null;
  /** Where company UUID came from. */
  source: 'binding' | 'env_entity' | 'env_default' | 'missing';
  /** Where access token came from (independent of UUID source). */
  tokenSource: 'env_entity' | 'env_default' | 'missing';
  ready: boolean;
  /** True when UUID+token both present for this entity (no cross-entity borrow). */
  credentialsReady: boolean;
};

function env(name: string): string | null {
  const v = process.env[name]?.trim();
  return v || null;
}

export function canonicalizeGustoEntityId(
  entityId: string | null | undefined,
): GustoEntityId | null {
  if (!entityId) return null;
  return (GUSTO_ENTITY_IDS as readonly string[]).includes(entityId)
    ? (entityId as GustoEntityId)
    : null;
}

function envCompanyUuid(entityId: GustoEntityId): {
  uuid: string | null;
  source: 'env_entity' | 'env_default' | 'missing';
} {
  const suffix = ENV_SUFFIX_BY_ENTITY[entityId];
  const perEntity = env(`GUSTO_COMPANY_UUID_${suffix}`);
  if (perEntity) {
    return { uuid: perEntity, source: 'env_entity' };
  }
  // Bare global UUID is ENT-FIRM-only — never for subsidiaries.
  if (entityId === 'ENT-FIRM') {
    const shared = env('GUSTO_COMPANY_UUID');
    if (shared) return { uuid: shared, source: 'env_default' };
  }
  return { uuid: null, source: 'missing' };
}

function envAccessToken(entityId: GustoEntityId): {
  token: string | null;
  source: 'env_entity' | 'env_default' | 'missing';
} {
  const suffix = ENV_SUFFIX_BY_ENTITY[entityId];
  const perEntity =
    env(`GUSTO_ACCESS_TOKEN_${suffix}`) || env(`GUSTO_API_TOKEN_${suffix}`);
  if (perEntity) {
    return { token: perEntity, source: 'env_entity' };
  }
  // Bare global token is ENT-FIRM-only — never for subsidiaries.
  if (entityId === 'ENT-FIRM') {
    const shared = env('GUSTO_API_TOKEN') || env('GUSTO_ACCESS_TOKEN');
    if (shared) return { token: shared, source: 'env_default' };
  }
  return { token: null, source: 'missing' };
}

function finalize(
  entityId: GustoEntityId,
  companyUuid: string | null,
  source: GustoCompanyResolution['source'],
): GustoCompanyResolution {
  const token = envAccessToken(entityId);
  const ready = Boolean(companyUuid);
  return {
    entityId,
    companyUuid,
    accessToken: token.token,
    source,
    tokenSource: token.source,
    ready,
    credentialsReady: ready && Boolean(token.token),
  };
}

/**
 * Sync resolve from env only (bindings require async).
 * Prefer resolveGustoCompany() when DB may hold the UUID.
 */
export function resolveGustoCompanyFromEnv(
  entityId: string | null | undefined,
): GustoCompanyResolution {
  const canon = canonicalizeGustoEntityId(entityId);
  if (!canon) {
    return missingResolution();
  }
  const company = envCompanyUuid(canon);
  return finalize(canon, company.uuid, company.source);
}

function missingResolution(): GustoCompanyResolution {
  // Fail closed — do not coerce unknown entity_ids onto ENT-FIRM credentials.
  return {
    entityId: 'ENT-FIRM',
    companyUuid: null,
    accessToken: null,
    source: 'missing',
    tokenSource: 'missing',
    ready: false,
    credentialsReady: false,
  };
}

/**
 * Resolve Gusto company for an OS entity.
 * Order: partner binding external_account_id → per-entity env → firm-only global env.
 * Unknown / non-canonical entityIds fail closed (no firm fallback).
 */
export async function resolveGustoCompany(
  entityId: string | null | undefined,
): Promise<GustoCompanyResolution> {
  const canon = canonicalizeGustoEntityId(entityId);
  if (!canon) {
    return missingResolution();
  }

  try {
    const bindings = await listPartnerBindings(canon);
    const gusto = bindings.find(
      (b) => b.partner_key === 'gusto' && b.enabled !== false,
    );
    const fromBinding =
      gusto?.external_account_id?.trim() ||
      (typeof gusto?.config?.company_uuid === 'string'
        ? gusto.config.company_uuid.trim()
        : '') ||
      null;
    if (fromBinding) {
      return finalize(canon, fromBinding, 'binding');
    }
  } catch {
    /* fail-soft to env */
  }

  return resolveGustoCompanyFromEnv(canon);
}

/**
 * Map webhook / API company UUID → entity_id via bindings, then env.
 */
export async function resolveEntityIdFromGustoCompanyUuid(
  companyUuid: string | null | undefined,
): Promise<GustoEntityId | null> {
  const uuid = companyUuid?.trim();
  if (!uuid) return null;

  try {
    const bindings = await listPartnerBindings();
    for (const b of bindings) {
      if (b.partner_key !== 'gusto') continue;
      const bound =
        b.external_account_id?.trim() ||
        (typeof b.config?.company_uuid === 'string'
          ? b.config.company_uuid.trim()
          : '');
      if (bound && bound === uuid) {
        return canonicalizeGustoEntityId(b.entity_id);
      }
    }
  } catch {
    /* fall through to env */
  }

  for (const entityId of GUSTO_ENTITY_IDS) {
    const row = resolveGustoCompanyFromEnv(entityId);
    if (row.companyUuid === uuid) return entityId;
  }
  return null;
}

export function extractGustoCompanyUuidFromPayload(
  payload: Record<string, unknown>,
): string | null {
  const direct = [
    payload.company_uuid,
    payload.company_id,
    payload.companyUuid,
  ];
  for (const v of direct) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const company = payload.company;
  if (company && typeof company === 'object' && !Array.isArray(company)) {
    const c = company as Record<string, unknown>;
    for (const key of ['uuid', 'id', 'company_uuid', 'company_id'] as const) {
      const v = c[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  const resource = payload.resource;
  if (resource && typeof resource === 'object' && !Array.isArray(resource)) {
    const r = resource as Record<string, unknown>;
    for (const key of ['company_uuid', 'company_id', 'uuid'] as const) {
      const v = r[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return null;
}

export function listEntityGustoCompaniesFromEnv(): GustoCompanyResolution[] {
  return GUSTO_ENTITY_IDS.map((id) => resolveGustoCompanyFromEnv(id));
}

export function gustoEntityMappingReadyFromEnv(): {
  ready: boolean;
  mapped: number;
  total: number;
  missing: GustoEntityId[];
} {
  const rows = listEntityGustoCompaniesFromEnv();
  const missing = rows.filter((r) => !r.ready).map((r) => r.entityId);
  return {
    ready: missing.length === 0,
    mapped: rows.length - missing.length,
    total: rows.length,
    missing,
  };
}

export function isGustoLive(): boolean {
  return process.env.GUSTO_LIVE?.trim() === '1';
}
