/**
 * Why is consent still missing? Distinguishes "permission was never added to the
 * app registration" from "added but nobody clicked Grant admin consent", and
 * names the exact API each one lives under — Exchange.ManageAsApp is on Office
 * 365 Exchange Online, not Microsoft Graph, which is the usual reason it cannot
 * be found in the portal.
 */

import { graph, env } from './lib.mjs';

const CLIENT_ID = env.MS_GRAPH_CLIENT_ID;
const GRAPH_APP_ID = '00000003-0000-0000-c000-000000000000';
const EXO_APP_ID = '00000002-0000-0ff1-ce00-000000000000';
const WANTED = ['Mail.Send', 'Group.ReadWrite.All', 'Exchange.ManageAsApp'];

const appRes = await graph(
  `v1.0/applications?$filter=appId eq '${CLIENT_ID}'&$select=id,displayName,appId,requiredResourceAccess`,
);
const app = appRes.body?.value?.[0];
console.log('application read HTTP', appRes.status);
if (!app) {
  console.log('Could not read the app registration:', JSON.stringify(appRes.body).slice(0, 400));
  process.exit(0);
}
console.log('app:', app.displayName, app.appId);

// Resolve every resource the app asks for, so role ids become names.
const resourceNames = new Map();
const requestedByResource = new Map();
for (const rra of app.requiredResourceAccess ?? []) {
  const spRes = await graph(
    `v1.0/servicePrincipals?$filter=appId eq '${rra.resourceAppId}'&$select=id,displayName,appId,appRoles`,
  );
  const sp = spRes.body?.value?.[0];
  resourceNames.set(rra.resourceAppId, sp?.displayName ?? rra.resourceAppId);
  const names = [];
  for (const r of rra.resourceAccess ?? []) {
    const role = (sp?.appRoles ?? []).find((x) => x.id === r.id);
    names.push(role?.value ?? `${r.type}:${r.id}`);
  }
  requestedByResource.set(rra.resourceAppId, names.sort());
}

console.log('\n--- requested on the app registration ---');
for (const [appId, names] of requestedByResource) {
  console.log(`${resourceNames.get(appId)} (${appId}):`);
  for (const n of names) console.log(`   ${n}`);
}

// What is actually consented.
const ourSpRes = await graph(
  `v1.0/servicePrincipals?$filter=appId eq '${CLIENT_ID}'&$select=id,displayName`,
);
const ourSp = ourSpRes.body?.value?.[0];
const consented = new Set();
if (ourSp?.id) {
  const grants = await graph(
    `v1.0/servicePrincipals/${ourSp.id}/appRoleAssignments?$select=appRoleId,resourceId,resourceDisplayName`,
  );
  const cache = new Map();
  for (const a of grants.body?.value ?? []) {
    if (!cache.has(a.resourceId)) {
      const r = await graph(`v1.0/servicePrincipals/${a.resourceId}?$select=displayName,appRoles`);
      cache.set(a.resourceId, r.body);
    }
    const role = (cache.get(a.resourceId)?.appRoles ?? []).find((x) => x.id === a.appRoleId);
    if (role?.value) consented.add(role.value);
  }
}

const requestedAll = new Set([...requestedByResource.values()].flat());

console.log('\n--- the three Josh is granting ---');
for (const w of WANTED) {
  const where = w === 'Exchange.ManageAsApp' ? 'Office 365 Exchange Online' : 'Microsoft Graph';
  const state = consented.has(w)
    ? 'CONSENTED'
    : requestedAll.has(w)
      ? 'ADDED, NOT CONSENTED — click "Grant admin consent"'
      : 'NOT ADDED to the app registration';
  console.log(`${w.padEnd(22)} ${state}   [${where}]`);
}

// Exchange.ManageAsApp additionally needs the SP to hold Exchange Administrator.
if (ourSp?.id) {
  const roles = await graph(
    `v1.0/roleManagement/directory/roleAssignments?$filter=principalId eq '${ourSp.id}'&$expand=roleDefinition($select=displayName)`,
  );
  const held = (roles.body?.value ?? []).map((r) => r.roleDefinition?.displayName).filter(Boolean);
  console.log(
    `\ndirectory roles on the service principal: ${held.length ? held.join(', ') : '(none)'}`,
  );
  console.log(
    held.some((r) => /Exchange Administrator|Global Administrator/i.test(r))
      ? 'Exchange admin role present — Add-MailboxPermission should work once the permission is consented.'
      : 'Exchange.ManageAsApp also needs this app assigned the Exchange Administrator role in Entra, or Add-MailboxPermission will 401 even after consent.',
  );
}
