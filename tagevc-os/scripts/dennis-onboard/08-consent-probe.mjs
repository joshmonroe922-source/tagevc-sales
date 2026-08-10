/**
 * Probe what the Graph app registration can actually do right now.
 *
 * Admin consent propagates on its own schedule, so this reads the app roles out
 * of a freshly minted token instead of trusting the portal, and lists the
 * groups that already exist so the distro-group step knows what is missing.
 */

import { graph, graphToken, env } from './lib.mjs';

const WANTED = [
  'Mail.Send',
  'Group.ReadWrite.All',
  'Exchange.ManageAsApp',
  'GroupMember.ReadWrite.All',
  'User.ReadWrite.All',
  'Mail.ReadWrite',
  'Organization.Read.All',
];

function decodeRoles(jwt) {
  const payload = jwt.split('.')[1];
  const json = JSON.parse(
    Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
  );
  return { roles: json.roles ?? [], appid: json.appid ?? json.azp ?? null, tid: json.tid };
}

const token = await graphToken();
const { roles, appid, tid } = decodeRoles(token);

console.log('APP_ID   ', appid);
console.log('TENANT   ', tid);
console.log('ROLES    ', JSON.stringify(roles.sort()));
console.log('');
for (const r of WANTED) {
  console.log(`${roles.includes(r) ? 'GRANTED ' : 'MISSING '} ${r}`);
}

console.log('\nCONSENT_JSON', JSON.stringify({
  mail_send: roles.includes('Mail.Send'),
  group_readwrite: roles.includes('Group.ReadWrite.All'),
  exchange_manageasapp: roles.includes('Exchange.ManageAsApp'),
}));

const groups = await graph(
  'v1.0/groups?$select=id,displayName,mail,mailNickname,mailEnabled,securityEnabled,groupTypes&$top=999',
);
console.log('\n--- groups HTTP', groups.status, '---');
for (const g of groups.body?.value ?? []) {
  console.log(
    [
      g.id,
      JSON.stringify(g.displayName),
      g.mail ?? '(no mail)',
      `mailEnabled=${g.mailEnabled}`,
      `types=${(g.groupTypes ?? []).join('|') || 'none'}`,
    ].join('  '),
  );
}

// Exchange.ManageAsApp only matters alongside the Exchange Online PowerShell
// service principal, so confirm we can actually mint an Outlook-scoped token.
if (roles.includes('Exchange.ManageAsApp')) {
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
    '\nEXO token:',
    json.access_token ? `ok (roles ${JSON.stringify(decodeRoles(json.access_token).roles)})` : JSON.stringify(json).slice(0, 400),
  );
}
