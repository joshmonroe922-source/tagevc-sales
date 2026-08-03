#!/usr/bin/env node
/**
 * Apply Phase 5b DocuSign library refs SQL.
 * Usage:
 *   set -a && source .env.local && set +a
 *   node scripts/apply-phase-ecc-docusign-library.mjs
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
  const file = 'supabase/phase_ecc_docusign_library.sql';
  const sql = fs.readFileSync(path.join(root, file), 'utf8');
  console.log(`Applying ${file}…`);
  await client.query(sql);
  const r = await client.query(`
    select table_name from information_schema.tables
    where table_schema='public' and table_name = 'ecc_library_document_refs'
  `);
  console.log('OK:', r.rows.map((x) => x.table_name).join(', ') || '(missing)');
} finally {
  await client.end();
}
console.log('Done.');
