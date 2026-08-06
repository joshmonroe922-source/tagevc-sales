/**
 * MyBasePay EOR ↔ Tage entity mapping (fail-closed).
 * Interim: Recruit 619 only until October API / other entities opt in.
 * Secrets never in bindings — admin credentials and future API keys live in env/vault.
 * See docs/MYBASEPAY_INTERIM_BRIDGE.md.
 */

import { listPartnerBindings } from '@/lib/partners/repo';

/** Canonical employers that may use MyBasePay. R619 is implement-now. */
export const MYBASEPAY_ENTITY_IDS = ['ENT-R619'] as const;

export type MyBasePayEntityId = (typeof MYBASEPAY_ENTITY_IDS)[number];

export type MyBasePayResolution = {
  entityId: MyBasePayEntityId | null;
  /** Non-secret external account / member id when known. */
  externalAccountId: string | null;
  baseUrl: string;
  source: 'binding' | 'env_entity' | 'missing';
  /** Entity is in the allow-list (currently ENT-R619). */
  allowed: boolean;
  /** Binding or env external id present. */
  ready: boolean;
  /** Admin session credentials present (interim bridge) — only when allowed. */
  adminCredentialsReady: boolean;
  /** Official API key present (October path) — only when allowed. */
  apiKeyReady: boolean;
  /** True when LIVE=1 would have enough credentials to attempt work. */
  credentialsReady: boolean;
  /** Interim admin-bridge vs future official API. */
  connectionMode: 'admin_bridge' | 'api' | 'unset';
  /** Masked consumers only — never log the password. */
  adminEmail: string | null;
  hasAdminPassword: boolean;
};

function env(name: string): string | null {
  const v = process.env[name]?.trim();
  return v || null;
}

export function canonicalizeMyBasePayEntityId(
  entityId: string | null | undefined,
): MyBasePayEntityId | null {
  if (!entityId) return null;
  return (MYBASEPAY_ENTITY_IDS as readonly string[]).includes(entityId)
    ? (entityId as MyBasePayEntityId)
    : null;
}

export function isMyBasePayLive(): boolean {
  return process.env.MYBASEPAY_LIVE?.trim() === '1';
}

export function mybasepayBaseUrl(): string {
  // Backoffice UI origin only — do not fall back to API host.
  return (env('MYBASEPAY_BASE_URL') || 'https://backoffice.mybasepay.com').replace(
    /\/+$/,
    '',
  );
}

export function mybasepayApiBase(): string {
  return (env('MYBASEPAY_API_BASE') || 'https://api.mybasepay.com').replace(
    /\/+$/,
    '',
  );
}

export function mybasepayLoginUrl(): string {
  return `${mybasepayBaseUrl()}/login`;
}

export function mybasepayAdminBridgeConfigured(): boolean {
  return Boolean(env('MYBASEPAY_ADMIN_EMAIL') && env('MYBASEPAY_ADMIN_PASSWORD'));
}

function envExternalAccountId(entityId: MyBasePayEntityId): string | null {
  if (entityId === 'ENT-R619') {
    return (
      env('MYBASEPAY_EXTERNAL_ACCOUNT_ID_R619') ||
      env('MYBASEPAY_EXTERNAL_ACCOUNT_ID')
    );
  }
  return null;
}

function missingResolution(): MyBasePayResolution {
  // Fail closed — do not expose credential posture for disallowed entities.
  return {
    entityId: null,
    externalAccountId: null,
    baseUrl: mybasepayBaseUrl(),
    source: 'missing',
    allowed: false,
    ready: false,
    adminCredentialsReady: false,
    apiKeyReady: false,
    credentialsReady: false,
    connectionMode: 'unset',
    adminEmail: null,
    hasAdminPassword: false,
  };
}

function finalize(
  entityId: MyBasePayEntityId,
  externalAccountId: string | null,
  source: MyBasePayResolution['source'],
): MyBasePayResolution {
  const adminEmail = env('MYBASEPAY_ADMIN_EMAIL');
  const hasAdminPassword = Boolean(env('MYBASEPAY_ADMIN_PASSWORD'));
  const adminCredentialsReady = Boolean(adminEmail && hasAdminPassword);
  const apiKeyReady = Boolean(env('MYBASEPAY_API_KEY'));
  const connectionMode: MyBasePayResolution['connectionMode'] = apiKeyReady
    ? 'api'
    : adminCredentialsReady
      ? 'admin_bridge'
      : 'unset';
  return {
    entityId,
    externalAccountId,
    baseUrl: mybasepayBaseUrl(),
    source,
    allowed: true,
    ready: Boolean(externalAccountId) || adminCredentialsReady || apiKeyReady,
    adminCredentialsReady,
    apiKeyReady,
    credentialsReady: adminCredentialsReady || apiKeyReady,
    connectionMode,
    adminEmail,
    hasAdminPassword,
  };
}

/**
 * Sync resolve from env only (bindings require async).
 * Prefer resolveMyBasePayEntity() when DB may hold the external id.
 */
export function resolveMyBasePayEntityFromEnv(
  entityId: string | null | undefined,
): MyBasePayResolution {
  const canon = canonicalizeMyBasePayEntityId(entityId);
  if (!canon) return missingResolution();
  const external = envExternalAccountId(canon);
  return finalize(canon, external, external ? 'env_entity' : 'missing');
}

/** @deprecated alias — prefer resolveMyBasePayEntityFromEnv */
export const resolveMyBasePayFromEnv = resolveMyBasePayEntityFromEnv;

/**
 * Resolve MyBasePay for an OS entity.
 * Order: partner binding external_account_id → per-entity env.
 * Unknown / non-R619 entityIds fail closed (no firm borrow).
 */
export async function resolveMyBasePayEntity(
  entityId: string | null | undefined,
): Promise<MyBasePayResolution> {
  const canon = canonicalizeMyBasePayEntityId(entityId);
  if (!canon) return missingResolution();

  try {
    const bindings = await listPartnerBindings(canon);
    const row = bindings.find(
      (b) => b.partner_key === 'mybasepay' && b.enabled !== false,
    );
    const fromBinding =
      row?.external_account_id?.trim() ||
      (typeof row?.config?.external_account_id === 'string'
        ? row.config.external_account_id.trim()
        : '') ||
      (typeof row?.config?.company_label === 'string'
        ? row.config.company_label.trim()
        : '') ||
      (typeof row?.config?.member_id === 'string'
        ? row.config.member_id.trim()
        : '') ||
      null;
    if (fromBinding) {
      return finalize(canon, fromBinding, 'binding');
    }
  } catch {
    /* fail-soft to env */
  }

  return resolveMyBasePayEntityFromEnv(canon);
}

/** @deprecated alias — prefer resolveMyBasePayEntity */
export const resolveMyBasePayAccount = resolveMyBasePayEntity;
