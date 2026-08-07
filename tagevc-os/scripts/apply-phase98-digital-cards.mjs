#!/usr/bin/env node
/**
 * Apply Phase 98 Digital Business Cards SQL via `pg`.
 * Usage (from tagevc-os):
 *   set -a && source .env.local && set +a
 *   node scripts/apply-phase98-digital-cards.mjs
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

const file = 'supabase/phase98_digital_cards.sql';
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
        'os_digital_card_personas',
        'os_network_contacts',
        'os_digital_card_events',
        'os_digital_card_entity_templates',
        'os_digital_card_rate_limits',
        'os_recruit_card_lead_links',
        'os_recruit_card_candidate_links'
      )
    order by table_name
  `);
  console.log(
    'Tables:',
    checks.rows.map((r) => r.table_name).join(', ') || '(none)',
  );

  const templates = await client.query(`
    select entity_id from public.os_digital_card_entity_templates order by 1
  `);
  console.log(
    'Templates:',
    templates.rows.map((r) => r.entity_id).join(', '),
  );

  const hooks = await client.query(`
    select step_key, system_hook
    from public.os_hris_process_template_steps
    where system_hook in ('digital_card_activate', 'digital_card_revoke')
    order by step_key
  `);
  console.log(
    'HRIS hooks:',
    hooks.rows.map((r) => `${r.step_key}=${r.system_hook}`).join(', ') ||
      '(none)',
  );
});

console.log('Done.');
