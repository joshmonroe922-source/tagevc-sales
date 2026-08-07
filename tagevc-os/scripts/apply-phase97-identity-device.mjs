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
const sql = fs.readFileSync(path.join(root, file), 'utf8');

await withClient(async (client) => {
  console.log(`Applying ${file} (${sql.length} chars)…`);
  await client.query(sql);
  console.log(`OK ${file}`);

  const tables = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'byod_registrations',
        'identity_hris_outbox',
        'identity_worker_jobs',
        'day1_kit_policies',
        'identity_metrics',
        'identity_activity_events',
        'identity_remote_help_sessions',
        'identity_entity_bootstrap_tasks',
        'integration_idempotency',
        'os_it_asset_assignments',
        'vm_lifecycle_case_steps'
      )
    order by table_name
  `);
  console.log(
    'Tables:',
    tables.rows.map((r) => r.table_name).join(', ') || '(none)',
  );

  const wipe = await client.query(
    `select public.identity_assert_wipe_allowed(null, 'mam_only', 'personal_byod') as g`,
  );
  console.log('Wipe guard sample:', wipe.rows[0]?.g);
});

console.log('Done.');
