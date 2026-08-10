/**
 * Shared helpers for the Dialpad go-live runbook (Josh + Dennis).
 * Credentials come from tagevc-os/.env.local — nothing is hardcoded here.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

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

export const DIALPAD_BASE = 'https://dialpad.com/api/v2';

export const OFFICES = {
  'ENT-FIRM': { id: '5312888585003008', name: 'Tage Venture Capital', main: '+16193590371' },
  'ENT-R619': { id: '5109894981558272', name: 'Recruit 619', main: '+12094545611' },
  'ENT-SIGNENT': { id: '4968987070242816', name: 'Signent HR', main: '+12095090641' },
  'ENT-INDA': { id: '5633477826781184', name: 'Instant NDA', main: '+12073475325' },
};

export const COMPANY_ID = '5390437239431168';

export async function dp(path, init = {}) {
  const url = path.startsWith('http') ? path : `${DIALPAD_BASE}/${path.replace(/^\//, '')}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.DIALPAD_API_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body };
}

export async function withDb(fn) {
  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export function show(label, result) {
  console.log(`\n--- ${label} — HTTP ${result.status} ---`);
  console.log(JSON.stringify(result.body, null, 1)?.slice(0, 4000));
}
