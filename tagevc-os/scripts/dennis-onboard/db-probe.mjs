/** Read-only probe: profile columns + Josh/Dennis rows + dialpad bindings. */
import pg from 'pg';
import { env } from './lib.mjs';

const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const q = async (label, sql, params = []) => {
  try {
    const r = await client.query(sql, params);
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(r.rows, null, 1));
  } catch (e) {
    console.log(`\n=== ${label} — ERROR ===\n${e.message}`);
  }
};

await q(
  'profiles columns',
  `select column_name, data_type from information_schema.columns
   where table_schema='public' and table_name='profiles' order by ordinal_position`,
);

await q(
  'profiles: josh + dennis',
  `select id, email, full_name, role, entity_id, active from public.profiles
   where email ilike '%josh%' or email ilike '%dennis%' order by email`,
);

await q(
  'hris employees (r619)',
  `select id, full_name, work_email, entity_id, status, profile_id, upn, identity_status
   from public.os_hris_employees where entity_id='ENT-R619' or work_email ilike '%dennis%'`,
);

await q(
  'dialpad bindings',
  `select partner_key, entity_id, enabled, status, external_account_id, config
   from public.os_partner_entity_bindings where partner_key='dialpad' order by entity_id`,
);

await q(
  'tables matching phone/telephony/dialpad',
  `select table_name from information_schema.tables
   where table_schema='public' and (table_name ilike '%dialpad%' or table_name ilike '%telephon%' or table_name ilike '%phone%')`,
);

await q(
  'columns matching dialpad anywhere',
  `select table_name, column_name from information_schema.columns
   where table_schema='public' and column_name ilike '%dialpad%'`,
);

await client.end();
