/**
 * DocuSign JWT / REST configuration (Phase 21).
 * When incomplete, the app falls back to mock envelope IDs (dev / demo).
 */

export type DocuSignConfig = {
  integrationKey: string;
  userId: string;
  accountId: string;
  privateKey: string;
  /** e.g. account-d.docusign.com or account.docusign.com */
  oauthHost: string;
  /** e.g. https://demo.docusign.net or https://na4.docusign.net */
  basePath: string;
  webhookSecret: string | null;
};

function normalizePrivateKey(raw: string): string {
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

export function getDocuSignConfig(): DocuSignConfig | null {
  const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY?.trim();
  const userId = process.env.DOCUSIGN_USER_ID?.trim();
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID?.trim();
  const privateKeyRaw = process.env.DOCUSIGN_PRIVATE_KEY?.trim();
  if (!integrationKey || !userId || !accountId || !privateKeyRaw) return null;

  const oauthHost = (
    process.env.DOCUSIGN_OAUTH_HOST?.trim() || 'account-d.docusign.com'
  ).replace(/^https?:\/\//, '');
  const basePath = (
    process.env.DOCUSIGN_BASE_PATH?.trim() || 'https://demo.docusign.net'
  ).replace(/\/$/, '');

  return {
    integrationKey,
    userId,
    accountId,
    privateKey: normalizePrivateKey(privateKeyRaw),
    oauthHost,
    basePath,
    webhookSecret: process.env.DOCUSIGN_WEBHOOK_SECRET?.trim() || null,
  };
}

export function isDocuSignConfigured(): boolean {
  return getDocuSignConfig() !== null;
}

export function getDocuSignMode(): 'live' | 'mock' {
  return isDocuSignConfigured() ? 'live' : 'mock';
}
