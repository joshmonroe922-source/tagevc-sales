/** Microsoft Graph OAuth + calendar helpers for edge functions. */

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const DEFAULT_SCOPES = [
  'openid',
  'offline_access',
  'User.Read',
  'Calendars.Read',
].join(' ');

export type MsConfig = {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  redirectUri: string;
  encryptionKey: string | null;
  configured: boolean;
};

export function getMsConfig(): MsConfig {
  const clientId = (Deno.env.get('MS_GRAPH_CLIENT_ID') ?? '').trim();
  const clientSecret = (Deno.env.get('MS_GRAPH_CLIENT_SECRET') ?? '').trim();
  const tenantId =
    (Deno.env.get('MS_GRAPH_TENANT_ID') ?? '').trim() || 'common';
  const redirectUri = (Deno.env.get('MS_GRAPH_REDIRECT_URI') ?? '').trim();
  const encryptionKey =
    (Deno.env.get('MS_TOKEN_ENCRYPTION_KEY') ?? '').trim() || null;

  return {
    clientId,
    clientSecret,
    tenantId,
    redirectUri,
    encryptionKey,
    configured: Boolean(clientId && clientSecret && redirectUri),
  };
}

export function oauthScopes(): string {
  return (Deno.env.get('MS_GRAPH_SCOPES') ?? '').trim() || DEFAULT_SCOPES;
}

export function portalBaseUrl(): string {
  return (
    (Deno.env.get('SALES_PORTAL_URL') ?? '').trim().replace(/\/$/, '') ||
    'https://portal.tagevc.com'
  );
}

function authority(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}`;
}

export function buildAuthorizeUrl(opts: {
  config: MsConfig;
  state: string;
  loginHint?: string | null;
}): string {
  const params = new URLSearchParams({
    client_id: opts.config.clientId,
    response_type: 'code',
    redirect_uri: opts.config.redirectUri,
    response_mode: 'query',
    scope: oauthScopes(),
    state: opts.state,
    prompt: 'select_account',
  });
  if (opts.loginHint) {
    params.set('login_hint', opts.loginHint);
  }
  return `${authority(opts.config.tenantId)}/oauth2/v2.0/authorize?${params}`;
}

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
};

export async function exchangeCodeForTokens(
  config: MsConfig,
  code: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
    scope: oauthScopes(),
  });

  const res = await fetch(
    `${authority(config.tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
  );

  const json = (await res.json()) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(
      json.error_description ?? json.error ?? 'Token exchange failed',
    );
  }
  return json;
}

export async function refreshAccessToken(
  config: MsConfig,
  refreshToken: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: oauthScopes(),
  });

  const res = await fetch(
    `${authority(config.tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
  );

  const json = (await res.json()) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(
      json.error_description ?? json.error ?? 'Token refresh failed',
    );
  }
  return json;
}

export type GraphUser = {
  id: string;
  mail?: string | null;
  userPrincipalName?: string | null;
  displayName?: string | null;
};

export async function fetchMe(accessToken: string): Promise<GraphUser> {
  const res = await fetch(`${GRAPH_BASE}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph /me failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphUser;
}

export type GraphEvent = {
  id: string;
  subject: string | null;
  bodyPreview?: string | null;
  isAllDay?: boolean;
  showAs?: string | null;
  webLink?: string | null;
  location?: { displayName?: string | null } | null;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  organizer?: {
    emailAddress?: { name?: string | null; address?: string | null };
  } | null;
};

export async function fetchCalendarView(
  accessToken: string,
  startIso: string,
  endIso: string,
): Promise<GraphEvent[]> {
  const params = new URLSearchParams({
    startDateTime: startIso,
    endDateTime: endIso,
    $orderby: 'start/dateTime',
    $top: '250',
    $select:
      'id,subject,bodyPreview,isAllDay,showAs,webLink,location,start,end,organizer',
  });

  const events: GraphEvent[] = [];
  let url: string | null =
    `${GRAPH_BASE}/me/calendarView?${params.toString()}`;

  while (url) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'outlook.timezone="UTC"',
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Graph calendarView failed: ${res.status} ${text}`);
    }
    const json = (await res.json()) as {
      value?: GraphEvent[];
      '@odata.nextLink'?: string;
    };
    events.push(...(json.value ?? []));
    url = json['@odata.nextLink'] ?? null;
  }

  return events;
}

/** AES-GCM encrypt; returns `iv_b64:cipher_b64`. Requires 32-byte key (hex or base64). */
export async function encryptSecret(
  plaintext: string,
  keyMaterial: string | null,
): Promise<string> {
  if (!keyMaterial) {
    // Prefix so we never confuse plaintext with ciphertext
    return `plain:${plaintext}`;
  }
  const key = await importAesKey(keyMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return `${b64(iv)}:${b64(new Uint8Array(cipher))}`;
}

export async function decryptSecret(
  blob: string,
  keyMaterial: string | null,
): Promise<string> {
  if (blob.startsWith('plain:')) {
    return blob.slice('plain:'.length);
  }
  if (!keyMaterial) {
    throw new Error('MS_TOKEN_ENCRYPTION_KEY required to decrypt stored tokens');
  }
  const [ivB64, cipherB64] = blob.split(':');
  if (!ivB64 || !cipherB64) {
    throw new Error('Invalid encrypted token blob');
  }
  const key = await importAesKey(keyMaterial);
  const iv = fromB64(ivB64);
  const cipher = fromB64(cipherB64);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    cipher,
  );
  return new TextDecoder().decode(plain);
}

async function importAesKey(material: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  if (/^[0-9a-fA-F]{64}$/.test(material)) {
    raw = hexToBytes(material);
  } else {
    raw = fromB64(material);
  }
  if (raw.length !== 32) {
    throw new Error(
      'MS_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)',
    );
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function randomStateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export type SalesUserRow = {
  id: string;
  email: string;
  work_email: string | null;
  role: string;
  active: boolean;
};

export async function requireActiveSalesUser(
  // deno-lint-ignore no-explicit-any
  service: any,
  authEmail: string,
): Promise<SalesUserRow | null> {
  const { data } = await service
    .from('sales_users')
    .select('id, email, work_email, role, active')
    .eq('email', authEmail.toLowerCase())
    .eq('active', true)
    .maybeSingle();
  return (data as SalesUserRow | null) ?? null;
}

export function preferredWorkEmail(user: SalesUserRow): string {
  return (user.work_email ?? user.email).trim().toLowerCase();
}

export type ConnectionRow = {
  id: string;
  sales_user_id: string;
  microsoft_email: string | null;
  microsoft_user_id: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  scopes: string;
  connected_at: string | null;
  last_synced_at: string | null;
  last_error: string | null;
};

/** Load connection + ensure a valid access token (refresh if needed). */
export async function getValidAccessToken(
  // deno-lint-ignore no-explicit-any
  service: any,
  config: MsConfig,
  salesUserId: string,
): Promise<{ accessToken: string; connection: ConnectionRow }> {
  const { data, error } = await service
    .from('microsoft_calendar_connections')
    .select('*')
    .eq('sales_user_id', salesUserId)
    .maybeSingle();

  if (error || !data) {
    throw new Error('Calendar not connected');
  }

  const connection = data as ConnectionRow;
  if (!connection.refresh_token_enc && !connection.access_token_enc) {
    throw new Error('Calendar not connected');
  }

  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime()
    : 0;
  const stillValid =
    connection.access_token_enc &&
    expiresAt > Date.now() + 60_000;

  if (stillValid && connection.access_token_enc) {
    const accessToken = await decryptSecret(
      connection.access_token_enc,
      config.encryptionKey,
    );
    return { accessToken, connection };
  }

  if (!connection.refresh_token_enc) {
    throw new Error('Reconnect required — missing refresh token');
  }

  const refreshToken = await decryptSecret(
    connection.refresh_token_enc,
    config.encryptionKey,
  );
  const tokens = await refreshAccessToken(config, refreshToken);
  const accessEnc = await encryptSecret(tokens.access_token, config.encryptionKey);
  const refreshEnc = tokens.refresh_token
    ? await encryptSecret(tokens.refresh_token, config.encryptionKey)
    : connection.refresh_token_enc;
  const tokenExpiresAt = new Date(
    Date.now() + (tokens.expires_in ?? 3600) * 1000,
  ).toISOString();

  const { data: updated, error: upErr } = await service
    .from('microsoft_calendar_connections')
    .update({
      access_token_enc: accessEnc,
      refresh_token_enc: refreshEnc,
      token_expires_at: tokenExpiresAt,
      scopes: tokens.scope ?? connection.scopes,
      last_synced_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', connection.id)
    .select('*')
    .single();

  if (upErr || !updated) {
    throw new Error(upErr?.message ?? 'Failed to save refreshed tokens');
  }

  return {
    accessToken: tokens.access_token,
    connection: updated as ConnectionRow,
  };
}
