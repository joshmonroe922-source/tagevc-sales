#!/usr/bin/env node
/**
 * Apply Phase 99 HRIS bonus / variable compensation SQL via `pg`.
 * Usage (from tagevc-os):
 *   set -a && source .env.local && set +a
 *   node scripts/apply-phase99-hris-bonus.mjs
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

const file = 'supabase/phase99_hris_bonus.sql';
const abs = path.join(root, file);
const sql = fs.readFileSync(abs, 'utf8');

await withClient(async (client) => {
  console.log(`Applying ${file} (${sql.length} chars)…`);
  await client.query(sql);
  console.log(`OK ${file}`);

  const cols = await client.query(`
    select column_name, data_type, column_default
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'os_hris_employees'
      and column_name like 'bonus%'
    order by column_name
  `);
  console.log('Bonus columns:');
  for (const r of cols.rows) {
    console.log(`  ${r.column_name} ${r.data_type} default=${r.column_default ?? 'null'}`);
  }

  // The migration backfills Dennis's quarterly MBO bonus — confirm it landed.
  const dennis = await client.query(`
    select full_name, comp_amount, bonus_amount, bonus_currency,
           bonus_frequency, bonus_type, bonus_notes
    from public.os_hris_employees
    where employee_key = 'dennis-vp-recruiting-r619'
  `);
  console.log('Dennis comp:', JSON.stringify(dennis.rows[0] ?? null, null, 2));
});

console.log('Done.');
