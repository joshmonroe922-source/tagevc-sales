/**
 * Rewrite the leftover dennis@recruit619.com references in historical/evidence
 * columns to dennismccall@recruit619.com.
 *
 * The live identity columns (profiles, auth.users, os_hris_employees,
 * r619_desk_roster) were already migrated by 11-access-email-align; what is left
 * here is event/audit/evidence text plus one live_look session row.
 *
 *   node scripts/dennis-onboard/email-migrate-apply.mjs            # dry run
 *   node scripts/dennis-onboard/email-migrate-apply.mjs --apply
 */
import pg from 'pg';
import { env } from './lib.mjs';

const OLD = 'dennis@recruit619.com';
const NEW = 'dennismccall@recruit619.com';
const APPLY = process.argv.includes('--apply');

// os_audit_events is deliberately omitted: reject_os_audit_events_mutation()
// makes it append-only, and rewriting a tamper-evident audit log to hide a
// rename is exactly what that guard exists to prevent. Its 3 historical rows
// keep the old address.
const TARGETS = [
  ['public', 'activity_events', 'title', 'text'],
  ['public', 'activity_events', 'detail', 'text'],
  ['public', 'os_hris_employee_events', 'detail', 'jsonb'],
  ['public', 'os_hris_process_steps', 'evidence_note', 'text'],
  ['public', 'os_live_look_sessions', 'target_email', 'text'],
];

const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log(`=== dennis email migrate ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===`);

if (APPLY) await client.query('begin');

for (const [schema, table, col, kind] of TARGETS) {
  const ident = `"${schema}"."${table}"."${col}"`;
  const match = kind === 'jsonb' ? `${ident}::text` : ident;
  const before = await client.query(
    `select count(*)::int as n from "${schema}"."${table}" where ${match} ilike $1`,
    [`%${OLD}%`],
  );
  if (before.rows[0].n === 0) {
    console.log(`skip   ${schema}.${table}.${col} — clean`);
    continue;
  }
  if (!APPLY) {
    console.log(`would  ${schema}.${table}.${col} — ${before.rows[0].n} row(s)`);
    continue;
  }
  const expr =
    kind === 'jsonb'
      ? `replace(${ident}::text, $1, $2)::jsonb`
      : `replace(${ident}, $1, $2)`;
  const upd = await client.query(
    `update "${schema}"."${table}" set "${col}" = ${expr} where ${match} ilike $3`,
    [OLD, NEW, `%${OLD}%`],
  );
  console.log(`update ${schema}.${table}.${col} — ${upd.rowCount} row(s)`);
}

if (APPLY) {
  await client.query('commit');

  console.log('\n=== verify ===');
  for (const [schema, table, col, kind] of TARGETS) {
    const ident = `"${schema}"."${table}"."${col}"`;
    const match = kind === 'jsonb' ? `${ident}::text` : ident;
    const r = await client.query(
      `select count(*)::int as n from "${schema}"."${table}" where ${match} ilike $1`,
      [`%${OLD}%`],
    );
    console.log(`${r.rows[0].n === 0 ? 'CLEAN' : 'LEFT '} ${schema}.${table}.${col} — ${r.rows[0].n}`);
  }
}

await client.end();
