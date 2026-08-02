#!/usr/bin/env node
/**
 * Apply phase94 graph spine (C1 migrations 0001–0010) via `pg`.
 * Usage:
 *   set -a && source .env.local && set +a
 *   node scripts/apply-phase94-graph-spine.mjs
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
  const file = 'supabase/phase94_graph_spine.sql';
  const sql = fs.readFileSync(path.join(root, file), 'utf8');
  console.log(`Applying ${file} (${sql.length} chars)…`);
  await client.query(sql);
  const r = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'organizations','accounts','contacts','employments','org_edges',
        'enrichment_jobs','recruit_job_reqs','nda_envelopes','spine_signent_engagements'
      )
    order by table_name
  `);
  console.log(
    'OK tables:',
    r.rows.map((x) => x.table_name).join(', ') || '(none)',
  );
  const orgs = await client.query(
    `select slug, kind from public.organizations order by slug`,
  );
  console.log(
    'Orgs:',
    orgs.rows.map((o) => `${o.slug}:${o.kind}`).join(', '),
  );
} finally {
  await client.end();
}
console.log('Done.');
