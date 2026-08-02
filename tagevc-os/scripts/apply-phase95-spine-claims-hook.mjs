#!/usr/bin/env node
/**
 * Apply phase95 Custom Access Token hook (C2) via `pg`.
 * Usage:
 *   set -a && source .env.local && set +a
 *   node scripts/apply-phase95-spine-claims-hook.mjs
 *
 * Then enable in Supabase Dashboard → Authentication → Hooks →
 * Custom Access Token → public.custom_access_token_hook
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const { Client } = pg;

const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const u = new URL(raw);
console.log('Target', {
  host: u.hostname,
  port: u.port || '5432',
  database: (u.pathname || '/postgres').slice(1) || 'postgres',
  user: decodeURIComponent(u.username),
});

const client = new Client({
  connectionString: raw,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  const file = 'supabase/phase95_spine_claims_hook.sql';
  const sql = fs.readFileSync(path.join(root, file), 'utf8');
  console.log(`Applying ${file} (${sql.length} chars)…`);
  await client.query(sql);
  const r = await client.query(`
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'custom_access_token_hook'
  `);
  console.log(
    'OK function:',
    r.rows.map((x) => `${x.proname}(${x.args})`).join(', ') || '(missing)',
  );
} finally {
  await client.end();
}
console.log('Done. Enable Auth Hook in Supabase Dashboard (Josh).');
