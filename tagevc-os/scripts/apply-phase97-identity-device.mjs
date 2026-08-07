#!/usr/bin/env node
/**
 * Apply Phase 97 Identity + Device Lifecycle SQL via `pg`.
 * Usage (from tagevc-os):
 *   set -a && source .env.local && set +a
 *   node scripts/apply-phase97-identity-device.mjs
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

const file = 'supabase/phase97_identity_device_lifecycle.sql';
const abs = path.join(root, file);
const sql = fs.readFileSync(abs, 'utf8');

await withClient(async (client) => {
  console.log(`Applying ${file} (${sql.length} chars)…`);
  await client.query(sql);
  console.log(`OK ${file}`);

  const checks = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'byod_registrations',
        'identity_worker_jobs',
        'identity_hris_outbox',
        'integration_idempotency',
        'day1_kit_policies',
        'identity_entity_bootstrap_tasks',
        'vm_lifecycle_case_steps'
      )
    order by table_name
  `);
  console.log(
    'Tables:',
    checks.rows.map((r) => r.table_name).join(', ') || '(none)',
  );

  const cols = await client.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'os_hris_employees'
      and column_name in ('device_ownership', 'identity_status', 'entra_object_id')
    order by column_name
  `);
  console.log(
    'HRIS cols:',
    cols.rows.map((r) => r.column_name).join(', '),
  );
});

console.log('Done.');
