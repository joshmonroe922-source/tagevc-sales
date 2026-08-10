/**
 * Read-only preflight: are the bonus columns live, and who is Josh's profile?
 *
 *   node scripts/dennis-onboard/15-preflight-check.mjs
 */

import { readFileSync } from 'node:fs';
import pg from 'pg';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const cols = await client.query(
  `select column_name from information_schema.columns
   where table_name = 'os_hris_employees' and column_name like 'bonus%' order by 1`,
);
console.log(
  'bonus columns:',
  cols.rows.map((r) => r.column_name).join(', ') || '(NONE — migration not applied)',
);

const dennis = await client.query(
  `select full_name, work_email, comp_amount, manager_profile_id, manager_name,
          entity_id, status, onboarding_pct, profile_id
   from os_hris_employees where employee_key = 'dennis-vp-recruiting-r619'`,
);
console.log('dennis:', JSON.stringify(dennis.rows[0], null, 2));

const josh = await client.query(
  `select id, email, full_name, role, entity_id, active from profiles
   where lower(email) = 'joshmonroe@tagevc.com' or role = 'visionary'`,
);
console.log('josh candidates:', JSON.stringify(josh.rows, null, 2));

await client.end();
