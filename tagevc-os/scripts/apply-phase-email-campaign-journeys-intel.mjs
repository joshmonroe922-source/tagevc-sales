#!/usr/bin/env node
/**
 * Apply Phase 6/7 journeys + intelligence schema.
 * Usage:
 *   set -a && source .env.local && set +a
 *   node scripts/apply-phase-email-campaign-journeys-intel.mjs
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

const client = new Client({
  connectionString: raw,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  const file = 'supabase/phase_email_campaign_journeys_intel.sql';
  const sql = fs.readFileSync(path.join(root, file), 'utf8');
  console.log(`Applying ${file}…`);
  await client.query(sql);
  const r = await client.query(`
    select table_name from information_schema.tables
    where table_schema='public' and table_name in ('ecc_journey_node_runs','ecc_ai_assist_drafts','ecc_attribution_touch')
    order by table_name
  `);
  console.log('OK:', r.rows.map((x) => x.table_name).join(', '));
} finally {
  await client.end();
}
console.log('Done.');
