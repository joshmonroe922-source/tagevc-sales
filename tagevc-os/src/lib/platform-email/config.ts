/** Env helpers for platform email (Microsoft Graph + Resend). */

export type PlatformEmailGraphConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
  isConfigured: boolean;
};

function env(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

export function platformEmailAppUrl(): string {
  return (
    env('NEXT_PUBLIC_APP_URL') ||
    env('VERCEL_URL') ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

export function getPlatformEmailGraphConfig(): PlatformEmailGraphConfig {
  const appUrl = platformEmailAppUrl();
  const tenantId = env('AZURE_TENANT_ID', env('MS_GRAPH_TENANT_ID', 'common'));
  const clientId = env('AZURE_CLIENT_ID', env('MS_GRAPH_CLIENT_ID'));
  const clientSecret = env('AZURE_CLIENT_SECRET', env('MS_GRAPH_CLIENT_SECRET'));
  const redirectUri = env(
    'MS_GRAPH_REDIRECT_URI',
    `${appUrl}/api/platform-email/microsoft/callback`,
  );
  const scopes = env(
    'MS_GRAPH_SCOPES',
    'openid offline_access User.Read Mail.ReadWrite Mail.Send',
  );
  return {
    tenantId,
    clientId,
    clientSecret,
    redirectUri,
    scopes,
    isConfigured: Boolean(clientId && clientSecret && redirectUri),
  };
}

export function isResendConfigured(): boolean {
  return Boolean(env('RESEND_API_KEY'));
}
