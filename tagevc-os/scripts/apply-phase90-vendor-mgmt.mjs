#!/usr/bin/env node
/**
 * Apply Phase 89 (idempotent) + Phase 90 Vendor Management SQL via `pg`.
 * Usage (from tagevc-os):
 *   set -a && source .env.local && set +a
 *   node scripts/apply-phase90-vendor-mgmt.mjs
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

async function withClient(fn) {
  const client = new Client({
    connectionString: raw,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function apply(file) {
  const abs = path.join(root, file);
  const sql = fs.readFileSync(abs, 'utf8');
  await withClient(async (client) => {
    console.log(`Applying ${file} (${sql.length} chars)…`);
    await client.query(sql);
    console.log(`OK ${file}`);
  });
}

async function listTables() {
  return withClient(async (client) => {
    const r = await client.query(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and (table_name like 'vm_%' or table_name like 'os_partner%')
      order by table_name
    `);
    return r.rows.map((x) => x.table_name);
  });
}

const before = await listTables();
console.log('Before:', before.join(', ') || '(none)');

await apply('supabase/phase89_partner_spine.sql');
await apply('supabase/phase90_vendor_management_spine.sql');

const after = await listTables();
console.log('After:', after.join(', ') || '(none)');
console.log('Done.');
