/**
 * Read-only probe after Exchange.ManageAsApp / Mail.Send / Group.ReadWrite.All consent.
 * Confirms which app roles the client-credentials token actually carries, then dumps
 * the Dennis-related state the remaining day-one steps depend on.
 */

import { graph, graphToken, env } from './lib.mjs';
import pg from 'pg';

const DENNIS_GRAPH_ID = '89fdd120-d221-4953-93a2-fc39a5f46983';
const EMPLOYEE_ID = '3d7937db-34f1-4be1-82a6-21e84b2b26a7';
const RUN_ID = '76ec8793-66d8-4a43-bfbe-1710f1054e5e';

const decodeRoles = (jwt) => {
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
  return { roles: (payload.roles ?? []).sort(), aud: payload.aud, appid: payload.appid };
};

console.log('=== GRAPH TOKEN ROLES ===');
console.log(JSON.stringify(decodeRoles(await graphToken()), null, 1));

console.log('\n=== EXCHANGE (outlook.office365.com) TOKEN ROLES ===');
{
  const body = new URLSearchParams({
    client_id: env.MS_GRAPH_CLIENT_ID,
    client_secret: env.MS_GRAPH_CLIENT_SECRET,
    scope: 'https://outlook.office365.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${env.MS_GRAPH_TENANT_ID}/oauth2/v2.0/token`,
    { method: 'POST', body },
  );
  const json = await res.json();
  console.log(
    json.access_token
      ? JSON.stringify(decodeRoles(json.access_token), null, 1)
      : JSON.stringify(json).slice(0, 400),
  );
}

console.log('\n=== DENNIS USER ===');
{
  const r = await graph(
    `v1.0/users/${DENNIS_GRAPH_ID}?$select=id,displayName,userPrincipalName,mail,proxyAddresses,otherMails,jobTitle,accountEnabled`,
  );
  console.log(JSON.stringify(r.body, null, 1));
}

console.log('\n=== DENNIS GROUP MEMBERSHIPS ===');
{
  const r = await graph(`v1.0/users/${DENNIS_GRAPH_ID}/memberOf?$select=id,displayName,mail`);
  console.log(JSON.stringify((r.body?.value ?? []).map((g) => ({ id: g.id, n: g.displayName, mail: g.mail })), null, 1));
}

console.log('\n=== ALL GROUPS ===');
{
  const r = await graph(
    'v1.0/groups?$select=id,displayName,mail,mailEnabled,securityEnabled,groupTypes&$top=100',
  );
  console.log(
    JSON.stringify(
      (r.body?.value ?? []).map((g) => ({
        id: g.id,
        n: g.displayName,
        mail: g.mail,
        mailEnabled: g.mailEnabled,
        types: g.groupTypes,
      })),
      null,
      1,
    ),
  );
}

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
  'employee columns',
  `select column_name from information_schema.columns
   where table_schema='public' and table_name='os_hris_employees'
     and (column_name ilike '%email%' or column_name ilike '%personal%' or column_name ilike '%phone%')
   order by column_name`,
);

await q(
  'dennis employee row',
  `select * from public.os_hris_employees where id = $1`,
  [EMPLOYEE_ID],
);

await q(
  'run steps',
  `select step_key, title, status, left(coalesce(evidence_note,''), 120) as note
   from public.os_hris_process_steps where run_id = $1 order by sort_order`,
  [RUN_ID],
);

await client.end();
