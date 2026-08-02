/**
 * DocuSign account ↔ Tage entity mapping (D01).
 * Org account holds all 4 entities as DocuSign accounts.
 */

import { getDocuSignConfig } from '@/lib/docusign/config';

export const DOCUSIGN_ENTITY_IDS = [
  'ENT-FIRM',
  'ENT-R619',
  'ENT-SIGNENT',
  'ENT-INDA',
] as const;

export type DocuSignEntityId = (typeof DOCUSIGN_ENTITY_IDS)[number];

const ENV_BY_ENTITY: Record<DocuSignEntityId, string> = {
  'ENT-FIRM': 'DOCUSIGN_ACCOUNT_ID_FIRM',
  'ENT-R619': 'DOCUSIGN_ACCOUNT_ID_R619',
  'ENT-SIGNENT': 'DOCUSIGN_ACCOUNT_ID_SIGNENT',
  'ENT-INDA': 'DOCUSIGN_ACCOUNT_ID_INDA',
};

export type EntityDocuSignAccount = {
  entityId: DocuSignEntityId;
  accountId: string | null;
  source: 'env_entity' | 'env_default' | 'missing';
  ready: boolean;
};

function env(name: string): string | null {
  const v = process.env[name]?.trim();
  return v || null;
}

/** Resolve DocuSign account id for a Tage entity (env first). */
export function resolveDocuSignAccountId(
  entityId: string | null | undefined,
): EntityDocuSignAccount {
  const canon = (DOCUSIGN_ENTITY_IDS as readonly string[]).includes(
    entityId ?? '',
  )
    ? (entityId as DocuSignEntityId)
    : 'ENT-FIRM';

  const perEntity = env(ENV_BY_ENTITY[canon]);
  if (perEntity) {
    return {
      entityId: canon,
      accountId: perEntity,
      source: 'env_entity',
      ready: true,
    };
  }

  const cfg = getDocuSignConfig();
  if (cfg?.accountId && canon === 'ENT-FIRM') {
    return {
      entityId: canon,
      accountId: cfg.accountId,
      source: 'env_default',
      ready: true,
    };
  }

  // Fallback: shared DOCUSIGN_ACCOUNT_ID only counts for firm until per-entity set
  const shared = env('DOCUSIGN_ACCOUNT_ID');
  if (shared && canon === 'ENT-FIRM') {
    return {
      entityId: canon,
      accountId: shared,
      source: 'env_default',
      ready: true,
    };
  }

  return {
    entityId: canon,
    accountId: null,
    source: 'missing',
    ready: false,
  };
}

export function listEntityDocuSignAccounts(): EntityDocuSignAccount[] {
  return DOCUSIGN_ENTITY_IDS.map((id) => resolveDocuSignAccountId(id));
}

export function docusignEntityMappingReady(): {
  ready: boolean;
  mapped: number;
  total: number;
  missing: DocuSignEntityId[];
} {
  const rows = listEntityDocuSignAccounts();
  const missing = rows.filter((r) => !r.ready).map((r) => r.entityId);
  return {
    ready: missing.length === 0,
    mapped: rows.length - missing.length,
    total: rows.length,
    missing,
  };
}
