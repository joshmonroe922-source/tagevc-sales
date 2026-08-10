/**
 * Shared helpers for the Dennis (dennis-vp-recruiting-r619) go-live runbook.
 * Reads credentials from tagevc-os/.env.local so nothing is hardcoded here.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '../../.env.local');

export const env = (() => {
  const out = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
})();

let cachedToken = null;
let cachedExp = 0;

export async function graphToken() {
  if (cachedToken && Date.now() < cachedExp - 60_000) return cachedToken;
  const body = new URLSearchParams({
    client_id: env.MS_GRAPH_CLIENT_ID,
    client_secret: env.MS_GRAPH_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${env.MS_GRAPH_TENANT_ID}/oauth2/v2.0/token`,
    { method: 'POST', body },
  );
  const json = await res.json();
  if (!json.access_token) throw new Error(`token failed: ${JSON.stringify(json)}`);
  cachedToken = json.access_token;
  cachedExp = Date.now() + (json.expires_in ?? 3600) * 1000;
  return cachedToken;
}

export async function graph(path, init = {}) {
  const token = await graphToken();
  const url = path.startsWith('http')
    ? path
    : `https://graph.microsoft.com/${path.replace(/^\//, '')}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, body: json };
}

export async function sb(path, init = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path.replace(/^\//, '')}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: init.method && init.method !== 'GET' ? 'return=representation' : '',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, body: json };
}

export function show(label, result) {
  console.log(`\n--- ${label} — HTTP ${result.status} ---`);
  console.log(
    typeof result.body === 'string'
      ? result.body.slice(0, 2000)
      : JSON.stringify(result.body, null, 1).slice(0, 4000),
  );
}
