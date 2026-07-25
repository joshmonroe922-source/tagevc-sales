/**
 * IES / Intuit QuickBooks Online connection config.
 * Intuit Enterprise Suite books are accessed via the QBO Accounting API
 * (OAuth 2.0 + realmId per company in the shared IES environment).
 *
 * Required secrets (document in docs/IES_SETUP.md):
 * - IES_CLIENT_ID
 * - IES_CLIENT_SECRET
 * - IES_TOKEN_SECRET (>=16 chars; AES vault for tokens)
 * Optional:
 * - IES_ENVIRONMENT=sandbox|production (default sandbox)
 * - IES_REDIRECT_URI (defaults to {APP_URL}/api/finance/ies/oauth/callback)
 * - NEXT_PUBLIC_APP_URL
 */

export type IesEnvironment = 'sandbox' | 'production';

export const IES_SCOPE = 'com.intuit.quickbooks.accounting';
export const IES_MINOR_VERSION = '75';
export const PHASE70_IES_CONTRACT_VERSION = 'phase70-v1' as const;

export const IES_OPERATING_ENTITIES = [
  'ENT-FIRM',
  'ENT-R619',
  'ENT-INDA',
] as const;

export type IesOperatingEntityId = (typeof IES_OPERATING_ENTITIES)[number];

function appOrigin(): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    '';
  if (!base) return 'https://app.tagevc.com';
  return base.startsWith('http')
    ? base.replace(/\/$/, '')
    : `https://${base.replace(/\/$/, '')}`;
}

export function getIesEnvironment(): IesEnvironment {
  const raw = process.env.IES_ENVIRONMENT?.trim().toLowerCase();
  return raw === 'production' ? 'production' : 'sandbox';
}

export function getIesConfig(): {
  configured: boolean;
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string;
  environment: IesEnvironment;
  vaultReady: boolean;
  missing: string[];
} {
  const clientId = process.env.IES_CLIENT_ID?.trim() || null;
  const clientSecret = process.env.IES_CLIENT_SECRET?.trim() || null;
  const vaultReady = Boolean(
    process.env.IES_TOKEN_SECRET?.trim() &&
      (process.env.IES_TOKEN_SECRET?.trim().length ?? 0) >= 16,
  );
  const redirectUri =
    process.env.IES_REDIRECT_URI?.trim() ||
    `${appOrigin()}/api/finance/ies/oauth/callback`;
  const missing: string[] = [];
  if (!clientId) missing.push('IES_CLIENT_ID');
  if (!clientSecret) missing.push('IES_CLIENT_SECRET');
  if (!vaultReady) missing.push('IES_TOKEN_SECRET');
  return {
    configured: Boolean(clientId && clientSecret && vaultReady),
    clientId,
    clientSecret,
    redirectUri,
    environment: getIesEnvironment(),
    vaultReady,
    missing,
  };
}

export function iesApiBase(environment: IesEnvironment = getIesEnvironment()): string {
  return environment === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

export const IES_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
export const IES_TOKEN_URL =
  'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

export const IES_SECRETS_DOC = [
  'IES_CLIENT_ID — Intuit Developer app Client ID',
  'IES_CLIENT_SECRET — Intuit Developer app Client Secret',
  'IES_TOKEN_SECRET — >=16 char vault key for encrypting OAuth tokens at rest',
  'IES_ENVIRONMENT — sandbox (default) or production',
  'IES_REDIRECT_URI — optional override; must match Intuit app redirect list',
  'NEXT_PUBLIC_APP_URL — https://app.tagevc.com (redirect derivation)',
] as const;
