#!/usr/bin/env node
/**
 * Apply Phase 90 Vendor Management SQL to DATABASE_URL.
 *
 *   set -a && source .env.local && set +a
 *   node scripts/apply-phase90-vendor-mgmt.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sqlPath = path.join(root, 'supabase/phase90_vendor_management_spine.sql');
const url = process.env.DATABASE_URL;

if (!url) {
  console.error('DATABASE_URL missing');
  process.exit(2);
}

const sql = fs.readFileSync(sqlPath, 'utf8');
const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  await client.query(sql);
  const { rows } = await client.query(`
    select
      (select count(*)::int from vm_entity_codes) as codes,
      (select count(*)::int from vm_entity_module_enablement) as modules,
      (select count(*)::int from vm_alert_rules) as alert_rules,
      (select count(*)::int from vm_lifecycle_templates) as templates,
      (select count(*)::int from vm_admin_roles) as admin_roles
  `);
  console.log('PHASE90_APPLIED', JSON.stringify(rows[0]));
} catch (e) {
  console.error('SQL_ERROR', e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  await client.end();
}
