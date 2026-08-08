#!/usr/bin/env node
/**
 * Apply Phase 98b wallet event types via `pg`.
 * Usage (from tagevc-os):
 *   set -a && source .env.local && set +a
 *   node scripts/apply-phase98b-wallet-events.mjs
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

const file = 'supabase/phase98b_digital_card_wallet_events.sql';
const abs = path.join(root, file);
const sql = fs.readFileSync(abs, 'utf8');

const client = new Client({
  connectionString: raw,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  console.log(`Applying ${file}…`);
  await client.query(sql);
  const check = await client.query(`
    select pg_get_constraintdef(oid) as def
    from pg_constraint
    where conname = 'os_digital_card_events_event_type_check'
  `);
  console.log('OK', check.rows[0]?.def || '(constraint missing)');
} finally {
  await client.end();
}
