/** End-to-end verification of Dennis's day-one state. */

import { graph, env } from './lib.mjs';
import pg from 'pg';

const { Client } = pg;
const GID = '89fdd120-d221-4953-93a2-fc39a5f46983';
const EMPLOYEE_ID = '3d7937db-34f1-4be1-82a6-21e84b2b26a7';
const out = {};

const u = await graph(
  `v1.0/users/${GID}?$select=id,displayName,userPrincipalName,mail,proxyAddresses,accountEnabled,usageLocation,jobTitle,department,companyName,assignedLicenses`,
);
out.entra = {
  http: u.status,
  upn: u.body?.userPrincipalName,
  mail: u.body?.mail,
  enabled: u.body?.accountEnabled,
  licenses: (u.body?.assignedLicenses ?? []).map((l) => l.skuId),
  proxy: u.body?.proxyAddresses,
  title: u.body?.jobTitle,
  company: u.body?.companyName,
};

const f = await graph(`v1.0/users/${GID}/mailFolders?$select=displayName,totalItemCount`);
out.mailbox = {
  http: f.status,
  folders: (f.body?.value ?? []).map((x) => `${x.displayName}:${x.totalItemCount}`),
};

const inbox = await graph(
  `v1.0/users/${GID}/mailFolders/inbox/messages?$select=subject,hasAttachments,receivedDateTime,isRead`,
);
out.inbox = (inbox.body?.value ?? []).map((m) => ({
  subject: m.subject,
  attachments: m.hasAttachments,
  received: m.receivedDateTime,
  unread: !m.isRead,
}));

const grp = await graph(`v1.0/users/${GID}/memberOf?$select=displayName,mail`);
out.groups = (grp.body?.value ?? []).map((g) => g.displayName);

const client = new Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const emp = await client.query(
  `select e.full_name, e.work_email, e.entity_id, e.status, e.start_date::date as start_date,
          e.profile_id, e.entra_object_id, e.upn, e.identity_status,
          e.recruit_assignment->>'status' as recruit_status,
          p.role, p.entity_id as profile_entity, p.active, p.email as profile_email
   from public.os_hris_employees e
   left join public.profiles p on p.id = e.profile_id
   where e.id = $1`,
  [EMPLOYEE_ID],
);
out.hris = emp.rows[0];

const steps = await client.query(
  `select step_key, status from public.os_hris_process_steps
   where run_id = '76ec8793-66d8-4a43-bfbe-1710f1054e5e'
     and status <> 'pending' order by step_key`,
);
out.steps = steps.rows;

const trig = await client.query(
  `select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal`,
);
out.profile_triggers = trig.rows.map((r) => r.tgname);

await client.end();
console.log(JSON.stringify(out, null, 2));
