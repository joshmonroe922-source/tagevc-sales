#!/usr/bin/env node
/**
 * Apply Phase 111 — create the `os-uploads` storage bucket.
 *
 * Usage (from tagevc-os):
 *   set -a && source .env.local && set +a
 *   node scripts/apply-phase111-os-uploads-bucket.mjs --dry-run
 *   node scripts/apply-phase111-os-uploads-bucket.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const { Client } = pg;
const dryRun = process.argv.includes('--dry-run');

/**
 * Read .env.local directly. `set -a && source .env.local` breaks on values
 * containing shell metacharacters, and only some vars survive, which reads as a
 * missing-credential error rather than a quoting problem.
 */
function loadEnvLocal() {
  try {
    const raw = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* env may come from the shell instead */
  }
}

loadEnvLocal();

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
  mode: dryRun ? 'DRY RUN' : 'APPLY',
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

const file = 'supabase/phase111_os_uploads_bucket.sql';
const sql = fs.readFileSync(path.join(root, file), 'utf8');

async function report(client, label) {
  const b = await client.query(
    `select id, public, file_size_limit, array_length(allowed_mime_types, 1) as mimes
       from storage.buckets where id = 'os-uploads'`,
  );
  console.log(
    `${label} bucket:`,
    b.rows[0]
      ? `public=${b.rows[0].public} limit=${b.rows[0].file_size_limit} mimes=${b.rows[0].mimes}`
      : '(missing)',
  );
  const p = await client.query(
    `select policyname from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'os_uploads_%' order by policyname`,
  );
  console.log(
    `${label} policies:`,
    p.rows.map((r) => r.policyname).join(', ') || '(none)',
  );
}

await withClient(async (client) => {
  await report(client, 'Before');

  if (dryRun) {
    console.log(`\nDRY RUN — would apply ${file} (${sql.length} chars). No changes made.`);
    return;
  }

  console.log(`\nApplying ${file} (${sql.length} chars)…`);
  await client.query(sql);
  console.log(`OK ${file}\n`);

  await report(client, 'After');
});

console.log('Done.');
