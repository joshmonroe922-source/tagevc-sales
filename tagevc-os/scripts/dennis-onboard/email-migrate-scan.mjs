/**
 * Read-only: find every occurrence of the retired dennis@recruit619.com address
 * across all text-ish columns in public + auth + storage schemas.
 */
import pg from 'pg';
import { env } from './lib.mjs';

const OLD = 'dennis@recruit619.com';

// Without a statement timeout a single wide ilike scan can outlive the pooler's
// patience and take the whole connection down mid-sweep.
const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
  statement_timeout: 20_000,
});
client.on('error', (e) => console.log(`CONN ${e.message.split('\n')[0]}`));
await client.connect();

const { rows: cols } = await client.query(
  `select c.table_schema, c.table_name, c.column_name, c.data_type
     from information_schema.columns c
     join information_schema.tables t
       on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema in ('public','auth','storage')
      and t.table_type = 'BASE TABLE'
      and c.data_type in ('text','character varying','character','json','jsonb','ARRAY')
    order by 1,2,3`,
);

const hits = [];
for (const c of cols) {
  const ident = `"${c.table_schema}"."${c.table_name}"."${c.column_name}"`;
  const expr =
    c.data_type === 'ARRAY' || c.data_type === 'json' || c.data_type === 'jsonb'
      ? `${ident}::text`
      : ident;
  const sql = `select count(*)::int as n from "${c.table_schema}"."${c.table_name}" where ${expr} ilike $1`;
  try {
    const r = await client.query(sql, [`%${OLD}%`]);
    if (r.rows[0].n > 0) {
      hits.push({ ...c, n: r.rows[0].n });
      console.log(`HIT  ${c.table_schema}.${c.table_name}.${c.column_name}  rows=${r.rows[0].n}`);
    }
  } catch (e) {
    console.log(`SKIP ${ident} — ${e.message.split('\n')[0]}`);
  }
}

console.log(`\n=== TOTAL COLUMNS WITH HITS: ${hits.length} ===`);
console.log(JSON.stringify(hits, null, 1));

await client.end();
