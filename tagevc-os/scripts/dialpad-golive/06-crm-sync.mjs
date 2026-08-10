/**
 * CRM sync for the Dialpad go-live.
 *
 * Writes profiles.dialpad_user_id for Josh (Tage VC office) and Dennis
 * (Recruit 619 office) and tidies Dennis's name/title, then re-reads the rows
 * plus the dialpad office bindings so the result is verifiable.
 */
import pg from 'pg';
import { env } from '../dennis-onboard/lib.mjs';

const PEOPLE = [
  {
    email: 'joshmonroe@tagevc.com',
    dialpad_user_id: '4721934169743360',
  },
  {
    email: 'dennismccall@recruit619.com',
    dialpad_user_id: '5690823254417408',
    full_name: 'Dennis McCall',
    job_title: 'VP of Recruiting',
  },
];

const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

for (const p of PEOPLE) {
  const sets = ['dialpad_user_id = $2', 'updated_at = now()'];
  const params = [p.email, p.dialpad_user_id];

  if (p.full_name) {
    params.push(p.full_name);
    sets.push(`full_name = $${params.length}`);
  }
  if (p.job_title) {
    params.push(p.job_title);
    sets.push(`job_title = $${params.length}`);
  }

  const r = await client.query(
    `update public.profiles set ${sets.join(', ')}
     where lower(email) = lower($1)
     returning id, email, full_name, job_title, role, entity_id, dialpad_user_id, active`,
    params,
  );
  console.log(`\n=== ${p.email} ===`);
  console.log(JSON.stringify(r.rows, null, 1));
}

const check = await client.query(
  `select email, full_name, job_title, role, entity_id, dialpad_user_id, active
   from public.profiles where dialpad_user_id is not null order by email`,
);
console.log('\n=== all profiles with a dialpad_user_id ===');
console.log(JSON.stringify(check.rows, null, 1));

await client.end();
