/**
 * App-only Graph token (client credentials) for shared-mailbox / alias send.
 * Reuses MS_GRAPH_* / AZURE_* env. Fail-soft when unset.
 */

let cached: { token: string; expiresAt: number } | null = null;

export async function getMsGraphAppToken(): Promise<string | null> {
  const tenant =
    process.env.AZURE_TENANT_ID?.trim() ||
    process.env.MS_GRAPH_TENANT_ID?.trim();
  const clientId =
    process.env.AZURE_CLIENT_ID?.trim() ||
    process.env.MS_GRAPH_CLIENT_ID?.trim();
  const clientSecret =
    process.env.AZURE_CLIENT_SECRET?.trim() ||
    process.env.MS_GRAPH_CLIENT_SECRET?.trim();
  if (!tenant || !clientId || !clientSecret) return null;

  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) return null;
  cached = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cached.token;
}
