#!/usr/bin/env node
/**
 * Apply Email Campaign Center schema (phase_email_campaign_platform.sql).
 * Usage:
 *   set -a && source .env.local && set +a
 *   node scripts/apply-phase-email-campaign.mjs
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
  const file = 'supabase/phase_email_campaign_platform.sql';
  const sql = fs.readFileSync(path.join(root, file), 'utf8');
  console.log(`Applying ${file} (${sql.length} chars)…`);
  await client.query(sql);
  const r = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name like 'ecc_%'
    order by table_name
  `);
  console.log(
    'OK ecc tables:',
    r.rows.map((x) => x.table_name).join(', ') || '(none)',
  );
  const settings = await client.query(
    `select entity_id, campaign_enabled from public.ecc_entity_settings order by entity_id`,
  );
  console.log(
    'Settings:',
    settings.rows
      .map((o) => `${o.entity_id}:${o.campaign_enabled}`)
      .join(', '),
  );
} finally {
  await client.end();
}
console.log('Done.');
