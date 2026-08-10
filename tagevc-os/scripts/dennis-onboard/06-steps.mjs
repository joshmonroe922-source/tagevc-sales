/** Inspect Dennis's onboarding run + steps, and debug the brand-assets upload. */

import { env } from './lib.mjs';
import pg from 'pg';

const { Client } = pg;
const EMPLOYEE_ID = '3d7937db-34f1-4be1-82a6-21e84b2b26a7';

// --- storage debug ----------------------------------------------------------
const buckets = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/bucket`, {
  headers: {
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  },
});
console.log('buckets HTTP', buckets.status);
console.log((await buckets.text()).slice(0, 800));

const probe = await fetch(
  `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/brand-assets/marketing-sot/email-signatures/people/Dennis/Dennis.html`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'text/html',
      'x-upsert': 'true',
    },
    body: '<html>probe</html>',
  },
);
console.log('\nupload probe HTTP', probe.status, (await probe.text()).slice(0, 400));

// --- run + steps ------------------------------------------------------------
const client = new Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const runs = await client.query(
  `select r.id, r.run_key, r.kind, r.status, r.start_date, t.slug
   from public.os_hris_process_runs r
   join public.os_hris_process_templates t on t.id = r.template_id
   where r.employee_id = $1`,
  [EMPLOYEE_ID],
);
console.log('\nRUNS:', JSON.stringify(runs.rows, null, 1));

if (runs.rows.length) {
  const steps = await client.query(
    `select id, step_key, title, status, system_hook, automation, owner_role, due_at
     from public.os_hris_process_steps
     where run_id = $1
       and (
         step_key in (
           'bs.ms_email','bs.visionary_mailbox_access','sd.email_sig',
           'sd.digital_card_activate','bs.notify_it','sd.distro'
         )
         or system_hook in ('graph_provision','mailbox_grant','email_signature')
       )
     order by sort_order`,
    [runs.rows[0].id],
  );
  console.log('\nRELEVANT STEPS:', JSON.stringify(steps.rows, null, 1));

  const counts = await client.query(
    `select status, count(*) from public.os_hris_process_steps where run_id = $1 group by status`,
    [runs.rows[0].id],
  );
  console.log('\nSTEP COUNTS:', JSON.stringify(counts.rows));
}

await client.end();
