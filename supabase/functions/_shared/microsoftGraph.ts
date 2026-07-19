/** Microsoft Graph OAuth + calendar / To Do / Planner / Teams chat / OneDrive / Mail helpers for edge functions. */

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const DEFAULT_SCOPES = [
  'openid',
  'offline_access',
  'User.Read',
  'User.ReadBasic.All',
  'Calendars.ReadWrite',
  'Tasks.ReadWrite',
  'People.Read',
  'Contacts.Read',
  'Chat.ReadWrite',
  'ChatMessage.Send',
  'Files.ReadWrite',
  'OnlineMeetings.ReadWrite',
  'Mail.ReadWrite',
  'Mail.Send',
  'MailboxSettings.ReadWrite',
].join(' ');

export function scopesInclude(scopes: string | null | undefined, needle: string): boolean {
  if (!scopes) return false;
  return scopes
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((s) => s === needle.toLowerCase() || s.endsWith(`/${needle.toLowerCase()}`));
}

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
  proxyAddresses?: string[] | null;
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

export type MailboxSendAsAddress = {
  address: string;
  is_primary: boolean;
};

/** SMTP addresses the signed-in user can typically send From (own aliases). */
export async function fetchMailboxSendAsAddresses(
  accessToken: string,
): Promise<{
  primary: string | null;
  addresses: MailboxSendAsAddress[];
  display_name: string | null;
}> {
  const res = await fetch(
    `${GRAPH_BASE}/me?$select=mail,userPrincipalName,proxyAddresses,displayName`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph /me send-as failed: ${res.status} ${text}`);
  }
  const me = (await res.json()) as GraphUser;
  return parseMailboxSendAsAddresses(me);
}

export function parseMailboxSendAsAddresses(me: GraphUser): {
  primary: string | null;
  addresses: MailboxSendAsAddress[];
  display_name: string | null;
} {
  const byLower = new Map<string, { address: string; is_primary: boolean }>();

  const add = (raw: string | null | undefined, forcePrimary = false) => {
    const address = (raw ?? '').trim();
    if (!address || !address.includes('@')) return;
    const lower = address.toLowerCase();
    const prev = byLower.get(lower);
    if (prev) {
      if (forcePrimary) prev.is_primary = true;
      return;
    }
    byLower.set(lower, { address: lower, is_primary: forcePrimary });
  };

  for (const entry of me.proxyAddresses ?? []) {
    const trimmed = entry.trim();
    const smtp = /^SMTP:(.+)$/i.exec(trimmed);
    if (!smtp) continue;
    const isPrimaryPrefix = trimmed.startsWith('SMTP:');
    add(smtp[1], isPrimaryPrefix);
  }

  add(me.mail ?? null, !byLower.size || ![...byLower.values()].some((a) => a.is_primary));
  if ((me.userPrincipalName ?? '').includes('@')) {
    add(me.userPrincipalName);
  }

  if (![...byLower.values()].some((a) => a.is_primary) && byLower.size) {
    const first = byLower.values().next().value;
    if (first) first.is_primary = true;
  }

  const addresses = [...byLower.values()].sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return a.address.localeCompare(b.address);
  });
  const primary = addresses.find((a) => a.is_primary)?.address ?? null;
  return {
    primary,
    addresses,
    display_name: me.displayName?.trim() || null,
  };
}

export function normalizeSendAsAddress(
  requested: string | null | undefined,
  allowed: MailboxSendAsAddress[],
): string | null {
  const want = (requested ?? '').trim().toLowerCase();
  if (!want) return null;
  const hit = allowed.find((a) => a.address === want);
  if (!hit) {
    throw new Error(
      `Cannot send From ${want}. Choose one of your mailbox aliases, or ask an admin for Send As on that address (Mail.Send.Shared).`,
    );
  }
  return hit.address;
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
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string | null } | null;
};

export type GraphCalendar = {
  id: string;
  name: string;
  color?: string | null;
  hexColor?: string | null;
  isDefaultCalendar?: boolean;
  canEdit?: boolean;
  owner?: {
    name?: string | null;
    address?: string | null;
  } | null;
};

/** Outlook preset color → CSS hex when Graph hexColor is empty. */
export function outlookColorToHex(color: string | null | undefined): string | null {
  if (!color) return null;
  const map: Record<string, string> = {
    lightBlue: '#A6C9E2',
    lightGreen: '#A9D08E',
    lightOrange: '#F4B183',
    lightGray: '#C9C9C9',
    lightYellow: '#FFE699',
    lightTeal: '#9DC3C3',
    lightPink: '#F4B6C2',
    lightBrown: '#C4A484',
    lightRed: '#E88989',
    maxColor: '#A6C9E2',
  };
  return map[color] ?? null;
}

const CALENDAR_SELECT =
  // isHidden is NOT a property on microsoft.graph.calendar (v1.0 or beta) —
  // selecting it causes: Parsing OData Select and Expand failed.
  'id,name,color,hexColor,isDefaultCalendar,canEdit,owner';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** MailboxConcurrency / app throttling — honor Retry-After when present. */
function parseRetryAfterMs(res: Response): number | null {
  const raw = res.headers.get('Retry-After');
  if (!raw) return null;
  const asSeconds = Number(raw);
  if (!Number.isNaN(asSeconds) && asSeconds >= 0) {
    return Math.min(asSeconds * 1000, 30_000);
  }
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) {
    return Math.min(Math.max(asDate - Date.now(), 0), 30_000);
  }
  return null;
}

/**
 * Graph fetch with retries for 429/503 (MailboxConcurrency, ApplicationThrottled).
 * Keeps concurrency pressure lower by backing off instead of failing immediately.
 */
export async function graphFetchWithRetry(
  url: string,
  init: RequestInit,
  errorLabel: string,
  maxRetries = 4,
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res;

    const text = await res.text();
    const err = new Error(`${errorLabel}: ${res.status} ${text}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    lastError = err;

    const retryable = res.status === 429 || res.status === 503;
    if (!retryable || attempt === maxRetries) throw err;

    const retryAfter = parseRetryAfterMs(res);
    const backoff =
      retryAfter ??
      Math.min(1000 * 2 ** attempt, 8000) + Math.floor(Math.random() * 250);
    await sleep(backoff);
  }
  throw lastError ?? new Error(errorLabel);
}

async function graphGetCollection<T>(
  accessToken: string,
  startUrl: string,
  errorLabel: string,
): Promise<T[]> {
  const items: T[] = [];
  let url: string | null = startUrl;
  while (url) {
    const res = await graphFetchWithRetry(
      url,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      errorLabel,
    );
    const json = (await res.json()) as {
      value?: T[];
      '@odata.nextLink'?: string;
    };
    items.push(...(json.value ?? []));
    url = json['@odata.nextLink'] ?? null;
  }
  return items;
}

/**
 * All calendars visible in the signed-in mailbox, including secondary,
 * shared, and subscribed calendars Outlook has already added.
 * Merges `/me/calendars` with per-calendarGroup listings (some shared
 * calendars only appear under a group).
 */
export async function fetchCalendars(accessToken: string): Promise<GraphCalendar[]> {
  const listParams = new URLSearchParams({
    $select: CALENDAR_SELECT,
    $top: '100',
  });

  const byId = new Map<string, GraphCalendar>();

  const primary = await graphGetCollection<GraphCalendar>(
    accessToken,
    `${GRAPH_BASE}/me/calendars?${listParams.toString()}`,
    'Graph calendars failed',
  );
  for (const c of primary) {
    if (c.id) byId.set(c.id, c);
  }

  // Soft-fail group walk: primary list is enough for most mailboxes.
  try {
    const groups = await graphGetCollection<{ id?: string }>(
      accessToken,
      `${GRAPH_BASE}/me/calendarGroups?$select=id&$top=50`,
      'Graph calendarGroups failed',
    );
    for (const group of groups) {
      if (!group.id) continue;
      try {
        const groupCals = await graphGetCollection<GraphCalendar>(
          accessToken,
          `${GRAPH_BASE}/me/calendarGroups/${encodeURIComponent(group.id)}/calendars?${listParams.toString()}`,
          'Graph group calendars failed',
        );
        for (const c of groupCals) {
          if (c.id && !byId.has(c.id)) byId.set(c.id, c);
        }
      } catch {
        /* skip one broken group */
      }
    }
  } catch {
    /* primary /me/calendars already loaded */
  }

  return [...byId.values()];
}

export async function fetchCalendarView(
  accessToken: string,
  startIso: string,
  endIso: string,
  calendarId?: string | null,
): Promise<GraphEvent[]> {
  const params = new URLSearchParams({
    startDateTime: startIso,
    endDateTime: endIso,
    $orderby: 'start/dateTime',
    $top: '250',
    $select:
      'id,subject,bodyPreview,isAllDay,showAs,webLink,location,start,end,organizer,isOnlineMeeting,onlineMeeting',
  });

  const path = calendarId
    ? `${GRAPH_BASE}/me/calendars/${encodeURIComponent(calendarId)}/calendarView`
    : `${GRAPH_BASE}/me/calendarView`;

  const events: GraphEvent[] = [];
  let url: string | null = `${path}?${params.toString()}`;

  while (url) {
    const res = await graphFetchWithRetry(
      url,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'outlook.timezone="UTC"',
        },
      },
      'Graph calendarView failed',
    );
    const json = (await res.json()) as {
      value?: GraphEvent[];
      '@odata.nextLink'?: string;
    };
    events.push(...(json.value ?? []));
    url = json['@odata.nextLink'] ?? null;
  }

  return events;
}

/**
 * Run async work with a hard concurrency cap (Graph MailboxConcurrency ≈ 4).
 * Returns settled results in input order (like Promise.allSettled).
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  if (items.length === 0) return results;

  const workers = Math.max(1, Math.min(limit, items.length));
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
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
  full_name?: string | null;
  role: string;
  active: boolean;
  calendar_default_view?: string | null;
  mail_signature_html?: string | null;
  mail_signature_enabled?: boolean | null;
};

export async function requireActiveSalesUser(
  // deno-lint-ignore no-explicit-any
  service: any,
  authEmail: string,
): Promise<SalesUserRow | null> {
  const { data } = await service
    .from('sales_users')
    .select(
      'id, email, work_email, full_name, role, active, calendar_default_view, mail_signature_html, mail_signature_enabled',
    )
    .eq('email', authEmail.toLowerCase())
    .eq('active', true)
    .maybeSingle();
  return (data as SalesUserRow | null) ?? null;
}

export type CreateEventInput = {
  subject: string;
  body?: string | null;
  location?: string | null;
  start: string;
  end: string;
  timeZone?: string;
  attendees?: string[];
  isOnlineMeeting?: boolean;
};

export type PeopleSuggestion = {
  id: string;
  display_name: string | null;
  email: string;
  source: 'people' | 'contacts';
};

type GraphPerson = {
  id?: string;
  displayName?: string | null;
  scoredEmailAddresses?: Array<{ address?: string | null; relevanceScore?: number }>;
};

type GraphContact = {
  id?: string;
  displayName?: string | null;
  emailAddresses?: Array<{ address?: string | null; name?: string | null }>;
};

function pickBestEmail(
  addresses: Array<{ address?: string | null } | undefined> | undefined,
): string | null {
  if (!addresses?.length) return null;
  for (const a of addresses) {
    const addr = (a?.address ?? '').trim().toLowerCase();
    if (addr && addr.includes('@')) return addr;
  }
  return null;
}

/** Outlook-like directory search via /me/people (+ optional /me/contacts). */
export async function searchPeopleSuggestions(
  accessToken: string,
  query: string,
  opts: { includeContacts?: boolean; top?: number } = {},
): Promise<PeopleSuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const top = Math.min(Math.max(opts.top ?? 8, 1), 20);
  const byEmail = new Map<string, PeopleSuggestion>();

  const peopleParams = new URLSearchParams({
    $search: `"${q.replace(/"/g, '')}"`,
    $top: String(top),
    $select: 'id,displayName,scoredEmailAddresses',
  });
  const peopleRes = await fetch(`${GRAPH_BASE}/me/people?${peopleParams}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ConsistencyLevel: 'eventual',
    },
  });
  if (peopleRes.ok) {
    const json = (await peopleRes.json()) as { value?: GraphPerson[] };
    for (const p of json.value ?? []) {
      const email = pickBestEmail(p.scoredEmailAddresses);
      if (!email || byEmail.has(email)) continue;
      byEmail.set(email, {
        id: p.id ?? email,
        display_name: p.displayName ?? null,
        email,
        source: 'people',
      });
    }
  } else if (peopleRes.status !== 403 && peopleRes.status !== 401) {
    const text = await peopleRes.text();
    console.warn('Graph /me/people search failed', peopleRes.status, text);
  }

  if (opts.includeContacts !== false && byEmail.size < top) {
    const contactParams = new URLSearchParams({
      $search: `"${q.replace(/"/g, '')}"`,
      $top: String(top),
      $select: 'id,displayName,emailAddresses',
    });
    const contactRes = await fetch(`${GRAPH_BASE}/me/contacts?${contactParams}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ConsistencyLevel: 'eventual',
      },
    });
    if (contactRes.ok) {
      const json = (await contactRes.json()) as { value?: GraphContact[] };
      for (const c of json.value ?? []) {
        const email = pickBestEmail(c.emailAddresses);
        if (!email || byEmail.has(email)) continue;
        byEmail.set(email, {
          id: c.id ?? email,
          display_name: c.displayName ?? null,
          email,
          source: 'contacts',
        });
        if (byEmail.size >= top) break;
      }
    } else if (contactRes.status !== 403 && contactRes.status !== 401) {
      const text = await contactRes.text();
      console.warn('Graph /me/contacts search failed', contactRes.status, text);
    }
  }

  return Array.from(byEmail.values()).slice(0, top);
}

export type LocationSuggestion = {
  display_name: string;
  source: 'recent' | 'room';
  email?: string | null;
};

type GraphRoom = {
  id?: string;
  displayName?: string | null;
  emailAddress?: string | null;
};

/** Recent event locations + optional room finder when Place.Read.All is granted. */
export async function suggestLocations(
  accessToken: string,
  query: string,
  opts: { includeRooms?: boolean; top?: number } = {},
): Promise<LocationSuggestion[]> {
  const q = query.trim().toLowerCase();
  const top = Math.min(Math.max(opts.top ?? 10, 1), 25);
  const byName = new Map<string, LocationSuggestion>();

  const now = Date.now();
  const startIso = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();
  const endIso = new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    startDateTime: startIso,
    endDateTime: endIso,
    $orderby: 'start/dateTime desc',
    $top: '100',
    $select: 'location',
  });

  const eventsRes = await fetch(`${GRAPH_BASE}/me/calendarView?${params}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'outlook.timezone="UTC"',
    },
  });
  if (eventsRes.ok) {
    const json = (await eventsRes.json()) as {
      value?: Array<{ location?: { displayName?: string | null } | null }>;
    };
    for (const ev of json.value ?? []) {
      const name = (ev.location?.displayName ?? '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (byName.has(key)) continue;
      if (q && !key.includes(q)) continue;
      byName.set(key, { display_name: name, source: 'recent' });
      if (byName.size >= top) break;
    }
  } else if (eventsRes.status !== 403 && eventsRes.status !== 401) {
    const text = await eventsRes.text();
    console.warn('Graph recent locations failed', eventsRes.status, text);
  }

  if (opts.includeRooms) {
    const roomParams = new URLSearchParams({
      $top: String(top),
      $select: 'id,displayName,emailAddress',
    });
    if (q) {
      // OData startswith needs a single-quoted literal; escape embedded quotes.
      const safe = q.replace(/'/g, "''");
      roomParams.set('$filter', `startswith(displayName,'${safe}')`);
    }
    const roomsRes = await fetch(
      `${GRAPH_BASE}/places/microsoft.graph.room?${roomParams}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (roomsRes.ok) {
      const json = (await roomsRes.json()) as { value?: GraphRoom[] };
      for (const room of json.value ?? []) {
        const name = (room.displayName ?? '').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (byName.has(key)) continue;
        byName.set(key, {
          display_name: name,
          source: 'room',
          email: room.emailAddress ?? null,
        });
        if (byName.size >= top) break;
      }
    } else if (roomsRes.status !== 403 && roomsRes.status !== 401) {
      const text = await roomsRes.text();
      console.warn('Graph rooms search failed', roomsRes.status, text);
    }
  }

  return Array.from(byName.values()).slice(0, top);
}

export async function createCalendarEvent(
  accessToken: string,
  input: CreateEventInput,
): Promise<GraphEvent & { onlineMeeting?: { joinUrl?: string | null } | null }> {
  const timeZone = input.timeZone?.trim() || 'UTC';
  const attendees = (input.attendees ?? [])
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
    .map((address) => ({
      emailAddress: { address },
      type: 'required',
    }));

  const payload: Record<string, unknown> = {
    subject: input.subject.trim(),
    body: {
      contentType: 'HTML',
      content: (input.body ?? '').trim() || '',
    },
    start: { dateTime: toGraphDateTime(input.start), timeZone },
    end: { dateTime: toGraphDateTime(input.end), timeZone },
    location: input.location?.trim()
      ? { displayName: input.location.trim() }
      : undefined,
    attendees,
  };

  if (input.isOnlineMeeting) {
    payload.isOnlineMeeting = true;
    payload.onlineMeetingProvider = 'teamsForBusiness';
  }

  const res = await fetch(`${GRAPH_BASE}/me/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: `outlook.timezone="${timeZone}"`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph create event failed: ${res.status} ${text}`);
  }

  return (await res.json()) as GraphEvent & {
    onlineMeeting?: { joinUrl?: string | null } | null;
  };
}

/** Graph wants local datetime without Z when Prefer timezone is set. */
function toGraphDateTime(isoOrLocal: string): string {
  const s = isoOrLocal.trim();
  if (!s) return s;
  // Strip Z / offset → keep wall-clock for the given Prefer timezone
  return s.replace(/Z$/, '').replace(/([+-]\d{2}:\d{2})$/, '').replace(/\.\d{3}$/, '');
}

export type TodoTask = {
  id: string;
  title: string;
  status: string;
  importance: string | null;
  dueDateTime: { dateTime: string; timeZone: string } | null;
  createdDateTime?: string | null;
  lastModifiedDateTime?: string | null;
  body?: { content?: string | null; contentType?: string } | null;
};

export type TodoList = {
  id: string;
  displayName: string;
  isOwner?: boolean;
  wellknownListName?: string | null;
};

export async function fetchTodoLists(accessToken: string): Promise<TodoList[]> {
  const res = await fetch(`${GRAPH_BASE}/me/todo/lists?$top=50`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph todo lists failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { value?: TodoList[] };
  return json.value ?? [];
}

export async function createTodoList(
  accessToken: string,
  displayName: string,
): Promise<TodoList> {
  const name = displayName.trim();
  if (!name) throw new Error('To Do list name is required');
  const res = await fetch(`${GRAPH_BASE}/me/todo/lists`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ displayName: name }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph create todo list failed: ${res.status} ${text}`);
  }
  return (await res.json()) as TodoList;
}

export async function fetchTodoTasks(
  accessToken: string,
  listId: string,
): Promise<TodoTask[]> {
  const params = new URLSearchParams({
    $top: '100',
    $orderby: 'createdDateTime desc',
  });
  const res = await fetch(
    `${GRAPH_BASE}/me/todo/lists/${encodeURIComponent(listId)}/tasks?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph todo tasks failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { value?: TodoTask[] };
  return json.value ?? [];
}

export type TodoImportance = 'low' | 'normal' | 'high';

export async function createTodoTask(
  accessToken: string,
  listId: string,
  title: string,
  body?: string | null,
  dueIso?: string | null,
  importance?: TodoImportance | null,
  timeZone?: string | null,
): Promise<TodoTask> {
  const payload: Record<string, unknown> = {
    title: title.trim(),
  };
  if (body?.trim()) {
    payload.body = { content: body.trim(), contentType: 'text' };
  }
  if (dueIso?.trim()) {
    payload.dueDateTime = {
      dateTime: toGraphDateTime(dueIso),
      timeZone: (timeZone ?? 'UTC').trim() || 'UTC',
    };
  }
  if (importance === 'low' || importance === 'normal' || importance === 'high') {
    payload.importance = importance;
  }

  const res = await fetch(
    `${GRAPH_BASE}/me/todo/lists/${encodeURIComponent(listId)}/tasks`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph create todo failed: ${res.status} ${text}`);
  }
  return (await res.json()) as TodoTask;
}

export async function patchTodoTask(
  accessToken: string,
  listId: string,
  taskId: string,
  patch: Record<string, unknown>,
): Promise<TodoTask> {
  const res = await fetch(
    `${GRAPH_BASE}/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph update todo failed: ${res.status} ${text}`);
  }
  return (await res.json()) as TodoTask;
}

export type PlannerPlan = {
  id: string;
  title: string;
  createdDateTime?: string | null;
  owner?: string | null;
  container?: { containerId?: string; type?: string; url?: string } | null;
};

export type PlannerTask = {
  id: string;
  title: string;
  percentComplete: number;
  planId: string;
  bucketId?: string | null;
  dueDateTime?: string | null;
  createdDateTime?: string | null;
  assignments?: Record<string, unknown>;
};

export async function fetchMyPlannerPlans(accessToken: string): Promise<PlannerPlan[]> {
  const res = await fetch(`${GRAPH_BASE}/me/planner/plans`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph planner plans failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { value?: PlannerPlan[] };
  return json.value ?? [];
}

export async function fetchPlannerTasks(
  accessToken: string,
  planId: string,
): Promise<PlannerTask[]> {
  const res = await fetch(
    `${GRAPH_BASE}/planner/plans/${encodeURIComponent(planId)}/tasks`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph planner tasks failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { value?: PlannerTask[] };
  return json.value ?? [];
}

export async function createPlannerTask(
  accessToken: string,
  planId: string,
  title: string,
  assignments?: Record<string, { '@odata.type': string; orderHint: string }>,
): Promise<PlannerTask> {
  const payload: Record<string, unknown> = {
    planId,
    title: title.trim(),
  };
  if (assignments) {
    payload.assignments = assignments;
  }

  const res = await fetch(`${GRAPH_BASE}/planner/tasks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph create planner task failed: ${res.status} ${text}`);
  }
  return (await res.json()) as PlannerTask;
}

export async function completePlannerTask(
  accessToken: string,
  taskId: string,
  etag: string,
): Promise<PlannerTask> {
  const res = await fetch(
    `${GRAPH_BASE}/planner/tasks/${encodeURIComponent(taskId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'If-Match': etag,
      },
      body: JSON.stringify({ percentComplete: 100 }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph complete planner task failed: ${res.status} ${text}`);
  }
  return (await res.json()) as PlannerTask;
}

export async function fetchPlannerTaskEtag(
  accessToken: string,
  taskId: string,
): Promise<string> {
  const res = await fetch(
    `${GRAPH_BASE}/planner/tasks/${encodeURIComponent(taskId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph planner task get failed: ${res.status} ${text}`);
  }
  const etag = res.headers.get('ETag') ?? res.headers.get('etag');
  if (!etag) {
    const json = (await res.json()) as { '@odata.etag'?: string };
    if (json['@odata.etag']) return json['@odata.etag'];
    throw new Error('Missing Planner task ETag');
  }
  return etag;
}

/* ---------------------------------------------------------------------------
   Teams chat (delegated Chat.ReadWrite / ChatMessage.Send)
   --------------------------------------------------------------------------- */

export type GraphChatMember = {
  id?: string;
  displayName?: string | null;
  email?: string | null;
  userId?: string | null;
  roles?: string[];
};

export type GraphChat = {
  id: string;
  topic?: string | null;
  chatType?: string | null;
  createdDateTime?: string | null;
  lastUpdatedDateTime?: string | null;
  webUrl?: string | null;
  members?: GraphChatMember[];
  lastMessagePreview?: {
    id?: string;
    createdDateTime?: string | null;
    isDeleted?: boolean;
    from?: {
      user?: { id?: string; displayName?: string | null } | null;
    } | null;
    body?: { contentType?: string; content?: string | null } | null;
  } | null;
};

export type GraphChatMessage = {
  id: string;
  createdDateTime?: string | null;
  lastModifiedDateTime?: string | null;
  messageType?: string | null;
  importance?: string | null;
  from?: {
    user?: {
      id?: string;
      displayName?: string | null;
      userIdentityType?: string | null;
    } | null;
  } | null;
  body?: { contentType?: string; content?: string | null } | null;
};

const AAD_USER_GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bind chat members by AAD object id when known; otherwise by UPN/email via path form
 * (never put `@` inside OData quoted keys incorrectly).
 */
function chatMemberBind(userIdOrUpn: string): Record<string, unknown> {
  const id = userIdOrUpn.trim();
  const bind = AAD_USER_GUID_RE.test(id)
    ? `${GRAPH_BASE}/users('${id.replace(/'/g, "''")}')`
    : `${GRAPH_BASE}/users/${encodeURIComponent(id)}`;
  return {
    '@odata.type': '#microsoft.graph.aadUserConversationMember',
    roles: ['owner'],
    'user@odata.bind': bind,
  };
}

const DIRECTORY_SCOPE_HINT =
  'Reconnect to refresh permissions after an admin grants User.ReadBasic.All (or User.Read.All) in Azure.';

/** Resolve email/UPN to an AAD object id (or UPN for bind) via people → /users. */
async function resolveAadUserId(
  accessToken: string,
  idOrUpnOrEmail: string,
): Promise<string> {
  const raw = idOrUpnOrEmail.trim();
  if (!raw) throw new Error('Empty user id/email');
  if (AAD_USER_GUID_RE.test(raw)) return raw;

  const needle = raw.toLowerCase();
  let foundInPeople = false;

  // 1) Outlook people search (/me/people) — soft signal the person exists
  try {
    const people = await searchPeopleSuggestions(accessToken, raw, {
      includeContacts: false,
      top: 12,
    });
    for (const p of people) {
      if (p.email.toLowerCase() === needle) {
        foundInPeople = true;
        break;
      }
    }
  } catch {
    // continue to directory lookup
  }

  // 2) Direct /me/people $search (same API; catches UPN-only hits)
  if (!foundInPeople) {
    const peopleParams = new URLSearchParams({
      $search: `"${raw.replace(/"/g, '')}"`,
      $top: '8',
      $select: 'id,displayName,scoredEmailAddresses,userPrincipalName',
    });
    const peopleRes = await fetch(`${GRAPH_BASE}/me/people?${peopleParams}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ConsistencyLevel: 'eventual',
      },
    });
    if (peopleRes.ok) {
      const json = (await peopleRes.json()) as {
        value?: Array<{
          userPrincipalName?: string | null;
          scoredEmailAddresses?: Array<{ address?: string | null }>;
        }>;
      };
      for (const p of json.value ?? []) {
        const upn = (p.userPrincipalName ?? '').trim().toLowerCase();
        const email = pickBestEmail(p.scoredEmailAddresses)?.toLowerCase() ?? '';
        if (upn === needle || email === needle) {
          foundInPeople = true;
          break;
        }
      }
    }
  }

  let directoryForbidden = false;

  // 3) /users/{upn} — needs User.ReadBasic.All for other users
  const byPath = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(raw)}?$select=id`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (byPath.ok) {
    const json = (await byPath.json()) as { id?: string };
    if (json.id) return json.id;
  } else if (byPath.status === 403) {
    directoryForbidden = true;
  }

  // 4) /users?$filter=mail|userPrincipalName
  const escaped = raw.replace(/'/g, "''");
  const filter = `mail eq '${escaped}' or userPrincipalName eq '${escaped}'`;
  const byFilter = await fetch(
    `${GRAPH_BASE}/users?$filter=${encodeURIComponent(filter)}&$select=id&$top=1`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (byFilter.ok) {
    const json = (await byFilter.json()) as { value?: Array<{ id?: string }> };
    const id = json.value?.[0]?.id;
    if (id) return id;
  } else if (byFilter.status === 403) {
    directoryForbidden = true;
  }

  // Soft fallback: people found them — Graph chat binds accept UPN/email in path form
  if (foundInPeople) {
    return raw;
  }

  if (directoryForbidden) {
    throw new Error(
      `Could not resolve ${raw}: directory lookup returned 403 (missing User.ReadBasic.All). ${DIRECTORY_SCOPE_HINT}`,
    );
  }

  const filterText = byFilter.ok ? '' : await byFilter.text().catch(() => '');
  throw new Error(
    `No Azure AD user found for ${raw}${
      filterText ? ` (${byFilter.status} ${filterText.slice(0, 180)})` : ''
    }. If this person is in your org, grant User.ReadBasic.All and ${DIRECTORY_SCOPE_HINT}`,
  );
}

/* ---------------------------------------------------------------------------
   Teams online meetings (delegated OnlineMeetings.ReadWrite)
   --------------------------------------------------------------------------- */

export type GraphOnlineMeeting = {
  id: string;
  subject?: string | null;
  startDateTime?: string | null;
  endDateTime?: string | null;
  joinWebUrl?: string | null;
  creationDateTime?: string | null;
};

export type CreateOnlineMeetingInput = {
  subject: string;
  start: string;
  end: string;
  /** Attendee UPNs / emails */
  attendees?: string[];
};

export async function createOnlineMeeting(
  accessToken: string,
  input: CreateOnlineMeetingInput,
): Promise<GraphOnlineMeeting> {
  const attendees = (input.attendees ?? [])
    .map((a) => a.trim())
    .filter(Boolean)
    .map((upn) => ({
      upn,
      role: 'attendee',
    }));

  const payload: Record<string, unknown> = {
    subject: input.subject.trim(),
    startDateTime: input.start,
    endDateTime: input.end,
  };
  if (attendees.length) {
    payload.participants = { attendees };
  }

  const res = await fetch(`${GRAPH_BASE}/me/onlineMeetings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 403) {
      throw new Error(
        `Could not create Teams meeting (403). Grant OnlineMeetings.ReadWrite in Azure, then Reconnect to refresh permissions. ${text.slice(0, 200)}`,
      );
    }
    throw new Error(`Graph create online meeting failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphOnlineMeeting;
}

/** Upcoming Teams meetings from calendar (events with a join URL). */
export async function listUpcomingOnlineMeetings(
  accessToken: string,
  opts: { start?: string; end?: string; top?: number } = {},
): Promise<
  Array<{
    id: string;
    subject: string;
    start: string | null;
    end: string | null;
    join_url: string;
    web_link: string | null;
  }>
> {
  const start = opts.start ?? new Date().toISOString();
  const end =
    opts.end ??
    new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const top = Math.min(Math.max(opts.top ?? 20, 1), 50);
  const events = await fetchCalendarView(accessToken, start, end);
  return events
    .filter((ev) => Boolean(ev.onlineMeeting?.joinUrl || ev.isOnlineMeeting))
    .map((ev) => ({
      id: ev.id,
      subject: ev.subject || '(No title)',
      start: ev.start?.dateTime ?? null,
      end: ev.end?.dateTime ?? null,
      join_url: (ev.onlineMeeting?.joinUrl ?? '').trim(),
      web_link: ev.webLink ?? null,
    }))
    .filter((m) => m.join_url)
    .slice(0, top);
}

export async function fetchMyChats(accessToken: string): Promise<GraphChat[]> {
  const params = new URLSearchParams({
    $top: '50',
    $expand: 'members,lastMessagePreview',
  });
  const res = await fetch(`${GRAPH_BASE}/me/chats?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph chats failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { value?: GraphChat[] };
  const chats = json.value ?? [];
  // Prefer most recently updated / last message first
  return chats.sort((a, b) => {
    const aT = Date.parse(
      a.lastMessagePreview?.createdDateTime ??
        a.lastUpdatedDateTime ??
        a.createdDateTime ??
        '',
    ) || 0;
    const bT = Date.parse(
      b.lastMessagePreview?.createdDateTime ??
        b.lastUpdatedDateTime ??
        b.createdDateTime ??
        '',
    ) || 0;
    return bT - aT;
  });
}

export async function fetchChatMessages(
  accessToken: string,
  chatId: string,
  top = 50,
): Promise<GraphChatMessage[]> {
  // Graph allows $top up to 50 for chat messages.
  const params = new URLSearchParams({
    $top: String(Math.min(Math.max(top, 1), 50)),
    $orderby: 'createdDateTime desc',
  });
  const res = await fetch(
    `${GRAPH_BASE}/me/chats/${encodeURIComponent(chatId)}/messages?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph chat messages failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { value?: GraphChatMessage[] };
  // Return chronological (oldest → newest) for thread UI
  return (json.value ?? []).slice().reverse();
}

export async function sendChatMessage(
  accessToken: string,
  chatId: string,
  content: string,
): Promise<GraphChatMessage> {
  const res = await fetch(
    `${GRAPH_BASE}/me/chats/${encodeURIComponent(chatId)}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body: { contentType: 'text', content: content.trim() },
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph send chat message failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphChatMessage;
}

export async function createOneOnOneChat(
  accessToken: string,
  myUserId: string,
  otherUserIdOrUpn: string,
): Promise<GraphChat> {
  const otherId = await resolveAadUserId(accessToken, otherUserIdOrUpn);
  const res = await fetch(`${GRAPH_BASE}/chats`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chatType: 'oneOnOne',
      members: [chatMemberBind(myUserId), chatMemberBind(otherId)],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph create 1:1 chat failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphChat;
}

export async function createGroupChat(
  accessToken: string,
  myUserId: string,
  memberIdsOrUpns: string[],
  topic?: string | null,
): Promise<GraphChat> {
  const others = memberIdsOrUpns
    .map((m) => m.trim())
    .filter(Boolean)
    .filter((m) => m.toLowerCase() !== myUserId.toLowerCase());
  if (others.length < 1) {
    throw new Error('Group chat needs at least one other member');
  }
  const otherIds = await Promise.all(
    others.map((m) => resolveAadUserId(accessToken, m)),
  );
  const members = [chatMemberBind(myUserId), ...otherIds.map(chatMemberBind)];
  const payload: Record<string, unknown> = {
    chatType: 'group',
    members,
  };
  if (topic?.trim()) payload.topic = topic.trim();

  const res = await fetch(`${GRAPH_BASE}/chats`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph create group chat failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphChat;
}

/** Meeting chat threads use ids like `19:meeting_…@thread.v2`. */
export function isMeetingChatId(chatId: string): boolean {
  return /:meeting_/i.test(chatId);
}

export type HideChatResult = {
  mode: 'hide_for_user' | 'ui_dismiss';
  reason?: string;
};

/**
 * Hide a chat for the signed-in user (Teams “Remove from list”).
 * Soft-hide only — does not delete the thread for other members.
 * Chat reappears if the user sends/receives activity that unhides it.
 * Requires Chat.ReadWrite. Admin DELETE /chats is intentionally not used.
 *
 * Meeting chats (`chatType: meeting` / `19:meeting_…`) often return 404 from
 * hideForUser — Graph does not support “Remove from list” the same way as 1:1.
 * In that case we return `ui_dismiss` so the portal can soft-hide locally.
 */
export async function hideChatForUser(
  accessToken: string,
  chatId: string,
  userId: string,
  tenantId: string,
): Promise<HideChatResult> {
  // Chat ids contain `:` and `@`; Graph requires them URL-encoded in the path.
  const res = await fetch(
    `${GRAPH_BASE}/chats/${encodeURIComponent(chatId)}/hideForUser`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user: {
          id: userId,
          tenantId,
        },
      }),
    },
  );
  if (res.ok || res.status === 204) {
    return { mode: 'hide_for_user' };
  }
  const text = await res.text();
  const meeting = isMeetingChatId(chatId);
  // Meeting threads commonly 404 (and occasionally 400) on hideForUser.
  if (meeting && (res.status === 404 || res.status === 400)) {
    return {
      mode: 'ui_dismiss',
      reason: 'meeting_chat_hide_unsupported',
    };
  }
  throw new Error(`Graph hide chat failed: ${res.status} ${text}`);
}

/* ---------------------------------------------------------------------------
   OneDrive / Files
   --------------------------------------------------------------------------- */

export type GraphDriveItem = {
  id: string;
  name?: string;
  size?: number;
  webUrl?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  folder?: { childCount?: number };
  file?: { mimeType?: string };
  parentReference?: {
    driveId?: string;
    id?: string;
    path?: string;
  };
  '@microsoft.graph.downloadUrl'?: string;
  shared?: { scope?: string };
  remoteItem?: {
    id?: string;
    name?: string;
    size?: number;
    webUrl?: string;
    folder?: { childCount?: number };
    file?: { mimeType?: string };
    parentReference?: { driveId?: string; id?: string };
  };
};

export type GraphPermission = {
  id?: string;
  roles?: string[];
  link?: {
    type?: string;
    scope?: string;
    webUrl?: string;
  };
  invitation?: {
    email?: string;
    invitedBy?: { user?: { displayName?: string } };
  };
  grantedToV2?: {
    user?: { displayName?: string; email?: string };
  };
};

function driveItemSelect(): string {
  return [
    'id',
    'name',
    'size',
    'webUrl',
    'createdDateTime',
    'lastModifiedDateTime',
    'folder',
    'file',
    'parentReference',
  ].join(',');
}

export async function fetchDriveRootChildren(
  accessToken: string,
): Promise<GraphDriveItem[]> {
  const params = new URLSearchParams({
    $top: '200',
    $orderby: 'name',
    $select: driveItemSelect(),
  });
  const res = await fetch(`${GRAPH_BASE}/me/drive/root/children?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph drive list failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { value?: GraphDriveItem[] };
  return json.value ?? [];
}

export async function fetchDriveItemChildren(
  accessToken: string,
  itemId: string,
): Promise<GraphDriveItem[]> {
  const params = new URLSearchParams({
    $top: '200',
    $orderby: 'name',
    $select: driveItemSelect(),
  });
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(itemId)}/children?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph drive folder list failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { value?: GraphDriveItem[] };
  return json.value ?? [];
}

export async function fetchDriveItem(
  accessToken: string,
  itemId: string,
): Promise<GraphDriveItem> {
  const params = new URLSearchParams({ $select: driveItemSelect() });
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(itemId)}?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph drive item failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphDriveItem;
}

export async function fetchSharedWithMe(
  accessToken: string,
): Promise<GraphDriveItem[]> {
  const params = new URLSearchParams({ $top: '100' });
  const res = await fetch(`${GRAPH_BASE}/me/drive/sharedWithMe?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph sharedWithMe failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { value?: GraphDriveItem[] };
  return json.value ?? [];
}

export async function fetchDriveItemByDrive(
  accessToken: string,
  driveId: string,
  itemId: string,
): Promise<GraphDriveItem> {
  const params = new URLSearchParams({ $select: driveItemSelect() });
  const res = await fetch(
    `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph drive item failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphDriveItem;
}

export async function fetchDriveItemChildrenByDrive(
  accessToken: string,
  driveId: string,
  itemId: string,
): Promise<GraphDriveItem[]> {
  const params = new URLSearchParams({
    $top: '200',
    $orderby: 'name',
    $select: driveItemSelect(),
  });
  const res = await fetch(
    `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/children?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph drive folder list failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { value?: GraphDriveItem[] };
  return json.value ?? [];
}

export type DriveItemPreview = {
  get_url: string | null;
  post_url: string | null;
  post_parameters: string | null;
  name: string | null;
  mime_type: string | null;
  web_url: string | null;
  /** Prefer iframe get_url / post form; office_embed is authenticated Office Online embedview when useful. */
  office_embed_url: string | null;
  previewable: boolean;
};

/** Build Office Online embedview URL from a OneDrive/SharePoint webUrl (stays in iframe when X-Frame allows). */
export function officeEmbedUrlFromWebUrl(webUrl: string | null | undefined): string | null {
  if (!webUrl) return null;
  try {
    const u = new URL(webUrl);
    const host = u.hostname.toLowerCase();
    const officeHost =
      host.includes('sharepoint.com') ||
      host.includes('onedrive.com') ||
      host.includes('live.com') ||
      host.includes('1drv.ms') ||
      host.includes('office.com') ||
      host.includes('officeapps.live.com');
    if (!officeHost) return null;
    u.searchParams.set('action', 'embedview');
    u.searchParams.set('wdStartOn', '1');
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Short-lived Graph preview URLs for in-portal iframe viewers.
 * Prefer /me/drive when driveId is omitted; use /drives/{id} for shared items.
 */
export async function previewDriveItem(
  accessToken: string,
  opts: { itemId: string; driveId?: string | null },
): Promise<DriveItemPreview> {
  const itemId = opts.itemId.trim();
  if (!itemId) throw new Error('itemId is required');
  const driveId = opts.driveId?.trim() || null;

  const item = driveId
    ? await fetchDriveItemByDrive(accessToken, driveId, itemId)
    : await fetchDriveItem(accessToken, itemId);

  if (item.folder || item.remoteItem?.folder) {
    throw new Error('Folders cannot be previewed');
  }

  const previewPath = driveId
    ? `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/preview`
    : `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(itemId)}/preview`;

  const res = await fetch(previewPath, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  const webUrl = item.webUrl ?? item.remoteItem?.webUrl ?? null;
  const officeEmbed = officeEmbedUrlFromWebUrl(webUrl);
  const name = item.name ?? item.remoteItem?.name ?? null;
  const mime = item.file?.mimeType ?? item.remoteItem?.file?.mimeType ?? null;

  if (!res.ok) {
    const text = await res.text();
    // Soft-fail to office embed when Graph preview rejects the type
    if (officeEmbed) {
      return {
        get_url: null,
        post_url: null,
        post_parameters: null,
        name,
        mime_type: mime,
        web_url: webUrl,
        office_embed_url: officeEmbed,
        previewable: true,
      };
    }
    throw new Error(
      `Preview unavailable for this file type (${res.status}). ${text.slice(0, 180)}`,
    );
  }

  const json = (await res.json()) as {
    getUrl?: string;
    postUrl?: string;
    postParameters?: string;
  };

  const getUrl = json.getUrl ?? null;
  const postUrl = json.postUrl ?? null;
  const postParameters = json.postParameters ?? null;
  const previewable = Boolean(getUrl || postUrl || officeEmbed);

  return {
    get_url: getUrl,
    post_url: postUrl,
    post_parameters: postParameters,
    name,
    mime_type: mime,
    web_url: webUrl,
    office_embed_url: officeEmbed,
    previewable,
  };
}

/** Simple upload ≤4MB. Parent null/empty = drive root. */
export async function uploadDriveFile(
  accessToken: string,
  opts: {
    parentId?: string | null;
    fileName: string;
    contentType?: string;
    bytes: Uint8Array;
  },
): Promise<GraphDriveItem> {
  const name = opts.fileName.trim();
  if (!name) throw new Error('fileName is required');
  if (opts.bytes.byteLength > 4 * 1024 * 1024) {
    throw new Error('File too large for portal upload (max 4 MB). Use a smaller file or upload via your org OneDrive outside this download-restricted portal.');
  }

  const encodedName = encodeURIComponent(name);
  const path = opts.parentId?.trim()
    ? `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(opts.parentId.trim())}:/${encodedName}:/content`
    : `${GRAPH_BASE}/me/drive/root:/${encodedName}:/content`;

  const res = await fetch(path, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': opts.contentType?.trim() || 'application/octet-stream',
    },
    body: opts.bytes,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph upload failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphDriveItem;
}

export async function createDriveFolder(
  accessToken: string,
  opts: { parentId?: string | null; name: string },
): Promise<GraphDriveItem> {
  const name = opts.name.trim();
  if (!name) throw new Error('Folder name is required');
  const path = opts.parentId?.trim()
    ? `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(opts.parentId.trim())}/children`
    : `${GRAPH_BASE}/me/drive/root/children`;

  const res = await fetch(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'rename',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph create folder failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphDriveItem;
}

export async function renameDriveItem(
  accessToken: string,
  itemId: string,
  name: string,
): Promise<GraphDriveItem> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('name is required');
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: trimmed }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph rename failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphDriveItem;
}

export async function deleteDriveItem(
  accessToken: string,
  itemId: string,
): Promise<void> {
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(itemId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`Graph delete failed: ${res.status} ${text}`);
  }
}

/** Org-only sharing link by default (not anonymous public). */
export async function createDriveSharingLink(
  accessToken: string,
  itemId: string,
  opts: {
    type?: 'view' | 'edit';
    scope?: 'organization' | 'anonymous' | 'users';
  } = {},
): Promise<GraphPermission> {
  const type = opts.type === 'edit' ? 'edit' : 'view';
  // Prefer organization — never default to anonymous public
  const scope = opts.scope === 'anonymous' || opts.scope === 'users'
    ? opts.scope
    : 'organization';

  const res = await fetch(
    `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(itemId)}/createLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type, scope }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph createLink failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphPermission;
}

export async function inviteDriveItem(
  accessToken: string,
  itemId: string,
  opts: {
    emails: string[];
    role?: 'read' | 'write';
    message?: string | null;
    sendInvitation?: boolean;
  },
): Promise<{ value?: GraphPermission[] }> {
  const emails = opts.emails.map((e) => e.trim()).filter(Boolean);
  if (!emails.length) throw new Error('At least one recipient email is required');
  const role = opts.role === 'write' ? 'write' : 'read';

  const res = await fetch(
    `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(itemId)}/invite`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipients: emails.map((email) => ({ email })),
        message: opts.message?.trim() || undefined,
        requireSignIn: true,
        sendInvitation: opts.sendInvitation !== false,
        roles: [role],
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph invite failed: ${res.status} ${text}`);
  }
  return (await res.json()) as { value?: GraphPermission[] };
}

/* ---------------------------------------------------------------------------
   Outlook mail
   --------------------------------------------------------------------------- */

export type GraphMailRecipient = {
  emailAddress?: { name?: string | null; address?: string | null };
};

export type GraphMailFolder = {
  id: string;
  displayName?: string | null;
  parentFolderId?: string | null;
  childFolderCount?: number;
  totalItemCount?: number;
  unreadItemCount?: number;
};

export type GraphMailAttachment = {
  '@odata.type'?: string;
  id?: string;
  name?: string | null;
  contentType?: string | null;
  size?: number;
  isInline?: boolean;
  contentId?: string | null;
  contentBytes?: string | null;
};

export type GraphMailMessage = {
  id: string;
  subject?: string | null;
  bodyPreview?: string | null;
  body?: { contentType?: string | null; content?: string | null };
  from?: GraphMailRecipient;
  toRecipients?: GraphMailRecipient[];
  ccRecipients?: GraphMailRecipient[];
  bccRecipients?: GraphMailRecipient[];
  receivedDateTime?: string | null;
  sentDateTime?: string | null;
  createdDateTime?: string | null;
  isRead?: boolean;
  isDraft?: boolean;
  hasAttachments?: boolean;
  importance?: string | null;
  conversationId?: string | null;
  parentFolderId?: string | null;
  webLink?: string | null;
  attachments?: GraphMailAttachment[];
};

const MAIL_LIST_SELECT = [
  'id',
  'subject',
  'bodyPreview',
  'from',
  'toRecipients',
  'ccRecipients',
  'receivedDateTime',
  'sentDateTime',
  'createdDateTime',
  'isRead',
  'isDraft',
  'hasAttachments',
  'importance',
  'conversationId',
  'parentFolderId',
  'webLink',
].join(',');

const WELL_KNOWN_FOLDERS = [
  'inbox',
  'sentitems',
  'drafts',
  'archive',
  'deleteditems',
] as const;

export type WellKnownMailFolder = (typeof WELL_KNOWN_FOLDERS)[number];

function recipientAddress(r: GraphMailRecipient | undefined): string | null {
  const addr = r?.emailAddress?.address?.trim();
  return addr ? addr.toLowerCase() : null;
}

export function extractMailAddresses(
  recipients: GraphMailRecipient[] | undefined,
): string[] {
  if (!recipients?.length) return [];
  const out: string[] = [];
  for (const r of recipients) {
    const a = recipientAddress(r);
    if (a) out.push(a);
  }
  return out;
}

/** Default + work mailbox domains treated as org for outbound warnings. */
export function orgMailDomains(
  preferredWorkEmailAddr: string | null | undefined,
  microsoftEmail?: string | null,
): string[] {
  const base = new Set<string>(['tagevc.com']);
  for (const raw of [preferredWorkEmailAddr, microsoftEmail]) {
    const domain = (raw ?? '').split('@')[1]?.trim().toLowerCase();
    if (domain) base.add(domain);
  }
  return Array.from(base);
}

export function isOrgMailAddress(
  email: string,
  orgDomains: string[],
): boolean {
  const domain = email.trim().toLowerCase().split('@')[1];
  if (!domain) return false;
  return orgDomains.some((d) => d === domain);
}

const MAIL_FOLDER_SELECT =
  'id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount';

export async function fetchMailFolderByWellKnown(
  accessToken: string,
  wellKnown: WellKnownMailFolder,
): Promise<GraphMailFolder> {
  const res = await fetch(
    `${GRAPH_BASE}/me/mailFolders/${encodeURIComponent(wellKnown)}?$select=${MAIL_FOLDER_SELECT}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph mail folder failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphMailFolder;
}

async function fetchMailFolderPage(
  accessToken: string,
  startUrl: string,
): Promise<GraphMailFolder[]> {
  const out: GraphMailFolder[] = [];
  let url: string | null = startUrl;
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Graph mail folders failed: ${res.status} ${text}`);
    }
    const json = (await res.json()) as {
      value?: GraphMailFolder[];
      '@odata.nextLink'?: string;
    };
    out.push(...(json.value ?? []));
    url = json['@odata.nextLink'] ?? null;
  }
  return out;
}

/** Recursively list mailbox folders (top-level + nested childFolders). */
export async function fetchMailFolders(
  accessToken: string,
): Promise<Array<GraphMailFolder & { well_known: WellKnownMailFolder | null }>> {
  const byId = new Map<string, GraphMailFolder & { well_known: WellKnownMailFolder | null }>();

  async function walk(folder: GraphMailFolder): Promise<void> {
    if (byId.has(folder.id)) return;
    byId.set(folder.id, { ...folder, well_known: null });
    if ((folder.childFolderCount ?? 0) <= 0) return;
    const children = await fetchMailFolderPage(
      accessToken,
      `${GRAPH_BASE}/me/mailFolders/${encodeURIComponent(folder.id)}/childFolders?$select=${MAIL_FOLDER_SELECT}&$top=50`,
    );
    for (const child of children) {
      await walk(child);
    }
  }

  const roots = await fetchMailFolderPage(
    accessToken,
    `${GRAPH_BASE}/me/mailFolders?$select=${MAIL_FOLDER_SELECT}&$top=50`,
  );
  for (const root of roots) {
    await walk(root);
  }

  for (const wellKnown of WELL_KNOWN_FOLDERS) {
    try {
      const folder = await fetchMailFolderByWellKnown(accessToken, wellKnown);
      const existing = byId.get(folder.id);
      if (existing) {
        existing.well_known = wellKnown;
        if (!existing.displayName && folder.displayName) {
          existing.displayName = folder.displayName;
        }
      } else {
        byId.set(folder.id, { ...folder, well_known: wellKnown });
        if ((folder.childFolderCount ?? 0) > 0) {
          await walk(folder);
        }
      }
    } catch {
      // Some tenants hide Archive — skip missing well-known folders
    }
  }

  return Array.from(byId.values());
}

export async function createMailFolder(
  accessToken: string,
  displayName: string,
  parentFolderId?: string | null,
): Promise<GraphMailFolder> {
  const name = displayName.trim();
  if (!name) throw new Error('displayName is required');
  const parent = (parentFolderId ?? '').trim();
  const url = parent
    ? `${GRAPH_BASE}/me/mailFolders/${encodeURIComponent(parent)}/childFolders`
    : `${GRAPH_BASE}/me/mailFolders`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ displayName: name }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph create mail folder failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphMailFolder;
}

export async function renameMailFolder(
  accessToken: string,
  folderId: string,
  displayName: string,
): Promise<GraphMailFolder> {
  const id = folderId.trim();
  const name = displayName.trim();
  if (!id) throw new Error('folderId is required');
  if (!name) throw new Error('displayName is required');
  const res = await fetch(
    `${GRAPH_BASE}/me/mailFolders/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ displayName: name }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph rename mail folder failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphMailFolder;
}

export async function fetchMailMessages(
  accessToken: string,
  opts: {
    folderId?: string | null;
    top?: number;
    skip?: number;
  } = {},
): Promise<GraphMailMessage[]> {
  const top = Math.min(Math.max(opts.top ?? 40, 1), 50);
  const skip = Math.max(opts.skip ?? 0, 0);
  const folderId = opts.folderId?.trim();
  const base = folderId
    ? `${GRAPH_BASE}/me/mailFolders/${encodeURIComponent(folderId)}/messages`
    : `${GRAPH_BASE}/me/messages`;
  const params = new URLSearchParams({
    $top: String(top),
    $skip: String(skip),
    $orderby: 'receivedDateTime desc',
    $select: MAIL_LIST_SELECT,
  });
  const res = await fetch(`${base}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph mail list failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { value?: GraphMailMessage[] };
  return json.value ?? [];
}

/** Graph $search on subject/from/body. Query must be quoted. Optional folder scope. */
export async function searchMailMessages(
  accessToken: string,
  query: string,
  opts: { top?: number; folderId?: string | null } = {},
): Promise<GraphMailMessage[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const top = Math.min(Math.max(opts.top ?? 25, 1), 50);
  const escaped = q.replace(/"/g, '');
  const folderId = opts.folderId?.trim();
  const base = folderId
    ? `${GRAPH_BASE}/me/mailFolders/${encodeURIComponent(folderId)}/messages`
    : `${GRAPH_BASE}/me/messages`;
  const params = new URLSearchParams({
    $search: `"${escaped}"`,
    $top: String(top),
    $select: MAIL_LIST_SELECT,
  });
  const res = await fetch(`${base}?${params}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ConsistencyLevel: 'eventual',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph mail search failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { value?: GraphMailMessage[] };
  return json.value ?? [];
}

export async function fetchMailMessage(
  accessToken: string,
  messageId: string,
  opts: { expandAttachments?: boolean } = {},
): Promise<GraphMailMessage> {
  const id = messageId.trim();
  if (!id) throw new Error('messageId is required');
  const params = new URLSearchParams({
    $select: `${MAIL_LIST_SELECT},body`,
  });
  if (opts.expandAttachments !== false) {
    // contentId lives on fileAttachment / itemAttachment / referenceAttachment — not
    // base microsoft.graph.attachment — so it cannot appear in $select here.
    // @odata.type is returned by Graph without selecting it.
    params.set(
      '$expand',
      'attachments($select=id,name,contentType,size,isInline)',
    );
  }
  const res = await fetch(
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph mail get failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphMailMessage;
}

export async function fetchMailConversation(
  accessToken: string,
  conversationId: string,
  opts: { top?: number; includeBody?: boolean } = {},
): Promise<GraphMailMessage[]> {
  const cid = conversationId.trim();
  if (!cid) return [];
  const top = Math.min(Math.max(opts.top ?? 30, 1), 50);
  // conversationId is opaque; escape single quotes for OData
  const escaped = cid.replace(/'/g, "''");
  const select = opts.includeBody ? `${MAIL_LIST_SELECT},body` : MAIL_LIST_SELECT;
  const params = new URLSearchParams({
    $filter: `conversationId eq '${escaped}'`,
    $orderby: 'receivedDateTime asc',
    $top: String(top),
    $select: select,
  });
  const res = await fetch(`${GRAPH_BASE}/me/messages?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph mail conversation failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { value?: GraphMailMessage[] };
  return json.value ?? [];
}

export async function fetchMailAttachment(
  accessToken: string,
  messageId: string,
  attachmentId: string,
): Promise<GraphMailAttachment> {
  const res = await fetch(
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph mail attachment failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphMailAttachment;
}

/** Outbound file attachment (base64 contentBytes). Graph simple attachment ≈ 3 MB. */
export type MailFileAttachmentInput = {
  name: string;
  contentType: string;
  contentBytes: string;
};

/** Graph / Outlook practical limits for JSON fileAttachment payloads. */
export const MAIL_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;
export const MAIL_ATTACHMENT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAIL_ATTACHMENT_MAX_COUNT = 10;

export function estimateBase64Bytes(base64: string): number {
  const cleaned = base64.replace(/\s/g, '');
  const padding = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((cleaned.length * 3) / 4) - padding);
}

function toGraphFileAttachments(
  attachments: MailFileAttachmentInput[] | undefined,
): Array<Record<string, unknown>> {
  if (!attachments?.length) return [];
  return attachments.map((a) => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: a.name.trim() || 'attachment',
    contentType: a.contentType.trim() || 'application/octet-stream',
    contentBytes: a.contentBytes,
  }));
}

function toGraphRecipients(emails: string[]): GraphMailRecipient[] {
  return emails
    .map((e) => e.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

/** Graph mailboxSettings — automatic replies, timezone, language (no compose signature). */
export type GraphAutomaticRepliesSetting = {
  status?: 'disabled' | 'alwaysEnabled' | 'scheduled' | string;
  externalAudience?: 'none' | 'contactsOnly' | 'all' | string;
  internalReplyMessage?: string;
  externalReplyMessage?: string;
  scheduledStartDateTime?: { dateTime?: string; timeZone?: string } | null;
  scheduledEndDateTime?: { dateTime?: string; timeZone?: string } | null;
};

export type GraphMailboxSettings = {
  timeZone?: string | null;
  language?: { locale?: string; displayName?: string } | null;
  dateFormat?: string | null;
  timeFormat?: string | null;
  automaticRepliesSetting?: GraphAutomaticRepliesSetting | null;
};

export async function fetchMailboxSettings(
  accessToken: string,
): Promise<GraphMailboxSettings> {
  const res = await fetch(`${GRAPH_BASE}/me/mailboxSettings`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph mailboxSettings failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphMailboxSettings;
}

export async function patchMailboxSettings(
  accessToken: string,
  patch: {
    automaticRepliesSetting?: GraphAutomaticRepliesSetting;
    timeZone?: string;
  },
): Promise<GraphMailboxSettings> {
  const res = await fetch(`${GRAPH_BASE}/me/mailboxSettings`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph mailboxSettings patch failed: ${res.status} ${text}`);
  }
  if (res.status === 204) {
    return fetchMailboxSettings(accessToken);
  }
  return (await res.json()) as GraphMailboxSettings;
}

function graphFromField(
  fromAddress: string | null | undefined,
  displayName?: string | null,
): GraphMailRecipient | undefined {
  const address = (fromAddress ?? '').trim();
  if (!address) return undefined;
  return {
    emailAddress: {
      address,
      ...(displayName?.trim() ? { name: displayName.trim() } : {}),
    },
  };
}

export async function sendMailMessage(
  accessToken: string,
  opts: {
    subject: string;
    bodyHtml: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    /** Own mailbox alias (proxyAddress). Do not set Reply-To — replies go to From. */
    from?: string | null;
    displayName?: string | null;
    saveToSentItems?: boolean;
    attachments?: MailFileAttachmentInput[];
  },
): Promise<void> {
  const to = toGraphRecipients(opts.to);
  if (!to.length) throw new Error('At least one To recipient is required');
  const from = graphFromField(opts.from, opts.displayName);
  const attachments = toGraphFileAttachments(opts.attachments);
  const res = await fetch(`${GRAPH_BASE}/me/sendMail`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject: opts.subject.trim() || '(no subject)',
        body: {
          contentType: 'HTML',
          content: opts.bodyHtml,
        },
        toRecipients: to,
        ccRecipients: toGraphRecipients(opts.cc ?? []),
        bccRecipients: toGraphRecipients(opts.bcc ?? []),
        // Own aliases: set from only (not sender/replyTo). Replies route to the mailbox.
        ...(from ? { from } : {}),
        ...(attachments.length ? { attachments } : {}),
      },
      saveToSentItems: opts.saveToSentItems !== false,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph sendMail failed: ${res.status} ${text}`);
  }
}

export async function addMailFileAttachment(
  accessToken: string,
  messageId: string,
  attachment: MailFileAttachmentInput,
): Promise<GraphMailAttachment> {
  const id = messageId.trim();
  if (!id) throw new Error('messageId is required');
  const res = await fetch(
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}/attachments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: attachment.name.trim() || 'attachment',
        contentType: attachment.contentType.trim() || 'application/octet-stream',
        contentBytes: attachment.contentBytes,
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph mail add attachment failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphMailAttachment;
}

export async function sendDraftMailMessage(
  accessToken: string,
  messageId: string,
): Promise<void> {
  const id = messageId.trim();
  if (!id) throw new Error('messageId is required');
  const res = await fetch(
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}/send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok && res.status !== 202) {
    const text = await res.text();
    throw new Error(`Graph mail draft send failed: ${res.status} ${text}`);
  }
}

async function createReplyOrForwardDraft(
  accessToken: string,
  messageId: string,
  kind: 'createReply' | 'createReplyAll' | 'createForward',
): Promise<GraphMailMessage> {
  const id = messageId.trim();
  if (!id) throw new Error('messageId is required');
  const res = await fetch(
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}/${kind}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph mail ${kind} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphMailMessage;
}

async function patchMailDraft(
  accessToken: string,
  draftId: string,
  patch: Record<string, unknown>,
): Promise<GraphMailMessage> {
  const res = await fetch(
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(draftId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph mail draft patch failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphMailMessage;
}

async function attachAndSendDraft(
  accessToken: string,
  draftId: string,
  attachments: MailFileAttachmentInput[] | undefined,
): Promise<void> {
  for (const att of attachments ?? []) {
    await addMailFileAttachment(accessToken, draftId, att);
  }
  await sendDraftMailMessage(accessToken, draftId);
}

export async function replyMailMessage(
  accessToken: string,
  messageId: string,
  opts: {
    comment: string;
    replyAll?: boolean;
    from?: string | null;
    displayName?: string | null;
    attachments?: MailFileAttachmentInput[];
  },
): Promise<void> {
  const id = messageId.trim();
  if (!id) throw new Error('messageId is required');
  const from = graphFromField(opts.from, opts.displayName);
  const hasAttachments = Boolean(opts.attachments?.length);

  // Attachments require createReply → add fileAttachment → send (simple reply cannot attach).
  if (hasAttachments) {
    const draft = await createReplyOrForwardDraft(
      accessToken,
      id,
      opts.replyAll ? 'createReplyAll' : 'createReply',
    );
    if (!draft.id) throw new Error('Graph did not return a reply draft id');
    const commentHtml = opts.comment.includes('<')
      ? opts.comment
      : opts.comment
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br/>');
    const existing = draft.body?.content ?? '';
    const combined = existing
      ? `<div>${commentHtml}</div><br/>${existing}`
      : `<div>${commentHtml}</div>`;
    await patchMailDraft(accessToken, draft.id, {
      body: { contentType: 'HTML', content: combined },
      ...(from ? { from } : {}),
    });
    await attachAndSendDraft(accessToken, draft.id, opts.attachments);
    return;
  }

  const path = opts.replyAll ? 'replyAll' : 'reply';
  const res = await fetch(
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}/${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        comment: opts.comment,
        ...(from ? { message: { from } } : {}),
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph mail ${path} failed: ${res.status} ${text}`);
  }
}

export async function forwardMailMessage(
  accessToken: string,
  messageId: string,
  opts: {
    to: string[];
    comment?: string;
    from?: string | null;
    displayName?: string | null;
    attachments?: MailFileAttachmentInput[];
  },
): Promise<void> {
  const id = messageId.trim();
  if (!id) throw new Error('messageId is required');
  const to = toGraphRecipients(opts.to);
  if (!to.length) throw new Error('At least one forward recipient is required');
  const from = graphFromField(opts.from, opts.displayName);
  const hasAttachments = Boolean(opts.attachments?.length);

  if (hasAttachments) {
    const draft = await createReplyOrForwardDraft(accessToken, id, 'createForward');
    if (!draft.id) throw new Error('Graph did not return a forward draft id');
    const comment = (opts.comment ?? '').trim();
    const commentHtml = comment
      ? comment.includes('<')
        ? comment
        : comment
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br/>')
      : '';
    const existing = draft.body?.content ?? '';
    const combined = commentHtml
      ? existing
        ? `<div>${commentHtml}</div><br/>${existing}`
        : `<div>${commentHtml}</div>`
      : existing;
    await patchMailDraft(accessToken, draft.id, {
      toRecipients: to,
      ...(combined
        ? { body: { contentType: 'HTML', content: combined } }
        : {}),
      ...(from ? { from } : {}),
    });
    await attachAndSendDraft(accessToken, draft.id, opts.attachments);
    return;
  }

  const res = await fetch(
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}/forward`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        comment: opts.comment ?? '',
        toRecipients: to,
        ...(from ? { message: { from } } : {}),
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph mail forward failed: ${res.status} ${text}`);
  }
}

export async function patchMailMessage(
  accessToken: string,
  messageId: string,
  patch: { isRead?: boolean },
): Promise<GraphMailMessage> {
  const id = messageId.trim();
  if (!id) throw new Error('messageId is required');
  const res = await fetch(
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph mail patch failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphMailMessage;
}

function graphMailNotFoundError(status: number, text: string): Error | null {
  if (
    status === 404 ||
    /ErrorItemNotFound|itemNotFound|not\s*found/i.test(text)
  ) {
    return new Error(
      'Message not found in Outlook — it may already have been deleted. Refresh the list.',
    );
  }
  return null;
}

async function permanentlyDeleteMailMessage(
  accessToken: string,
  messageId: string,
): Promise<void> {
  const res = await fetch(
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (res.ok || res.status === 204) return;
  const text = await res.text();
  const notFound = graphMailNotFoundError(res.status, text);
  if (notFound) throw notFound;
  throw new Error(`Graph mail delete failed: ${res.status} ${text}`);
}

/**
 * Delete a message in the signed-in mailbox (`/me`).
 * Default matches Outlook Delete: move to Deleted Items (soft-delete).
 * Pass `permanent: true` (or delete while already in Deleted Items) for Graph DELETE.
 */
export async function deleteMailMessage(
  accessToken: string,
  messageId: string,
  opts: { permanent?: boolean; parentFolderId?: string | null } = {},
): Promise<{ mode: 'soft' | 'permanent' }> {
  const id = messageId.trim();
  if (!id) throw new Error('messageId is required');

  let permanent = Boolean(opts.permanent);
  if (!permanent && opts.parentFolderId?.trim()) {
    try {
      const deleted = await fetchMailFolderByWellKnown(accessToken, 'deleteditems');
      if (deleted.id === opts.parentFolderId.trim()) permanent = true;
    } catch {
      /* fall through to soft-delete */
    }
  }

  if (permanent) {
    await permanentlyDeleteMailMessage(accessToken, id);
    return { mode: 'permanent' };
  }

  // Soft-delete: well-known folder name is accepted as destinationId.
  try {
    await moveMailMessage(accessToken, id, 'deleteditems');
    return { mode: 'soft' };
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    const notFound = graphMailNotFoundError(0, text);
    if (notFound || /\b404\b/.test(text)) {
      throw (
        notFound ??
        new Error(
          'Message not found in Outlook — it may already have been deleted. Refresh the list.',
        )
      );
    }
    // Already in Deleted Items (or move rejected) → permanent delete like Outlook.
    if (/cannot be moved|ErrorInvalidRequest|deleteditems/i.test(text)) {
      await permanentlyDeleteMailMessage(accessToken, id);
      return { mode: 'permanent' };
    }
    throw err;
  }
}

export async function moveMailMessage(
  accessToken: string,
  messageId: string,
  destinationId: string,
): Promise<GraphMailMessage> {
  const id = messageId.trim();
  const dest = destinationId.trim();
  if (!id) throw new Error('messageId is required');
  if (!dest) throw new Error('destinationId is required');
  const res = await fetch(
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}/move`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ destinationId: dest }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph mail move failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphMailMessage;
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
