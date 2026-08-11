/**
 * Read-only audit of the final permission posture after the FullAccess grant:
 *   - which Graph app roles the SP still holds (RoleManagement must be gone)
 *   - which directory roles the SP holds (Exchange Recipient Administrator stays)
 *   - Josh's FullAccess on Dennis's mailbox
 *
 *   node scripts/dennis-onboard/20-verify-and-close.mjs
 */

import { graph, env } from './lib.mjs';

const TENANT = env.MS_GRAPH_TENANT_ID;
const SP_OBJECT_ID = '1d44ad06-fbda-4ac4-b4fe-2c3885b4ac37';
const MAILBOX = 'dennismccall@recruit619.com';

const GRAPH_RESOURCE_APP_ID = '00000003-0000-0000-c000-000000000000';

const assignments = await graph(
  `v1.0/servicePrincipals/${SP_OBJECT_ID}/appRoleAssignments?$select=id,appRoleId,resourceId,resourceDisplayName`,
);

const graphSp = await graph(
  `v1.0/servicePrincipals?$filter=appId eq '${GRAPH_RESOURCE_APP_ID}'&$select=id,appRoles`,
);
const appRoleNames = new Map(
  (graphSp.body?.value?.[0]?.appRoles ?? []).map((r) => [r.id, r.value]),
);

console.log('=== GRAPH APP ROLES HELD BY SP ===');
const held = (assignments.body?.value ?? []).map(
  (a) => `${a.resourceDisplayName}: ${appRoleNames.get(a.appRoleId) ?? a.appRoleId}`,
);
held.sort().forEach((h) => console.log(` - ${h}`));
const stillHasRoleMgmt = held.some((h) => h.includes('RoleManagement.ReadWrite.Directory'));
console.log(
  stillHasRoleMgmt
    ? '\n!! RoleManagement.ReadWrite.Directory STILL GRANTED — revoke did not land'
    : '\nOK: RoleManagement.ReadWrite.Directory is revoked',
);

const dirRoles = await graph(
  `v1.0/roleManagement/directory/roleAssignments?$filter=principalId eq '${SP_OBJECT_ID}'&$expand=roleDefinition($select=displayName)`,
);
console.log('\n=== DIRECTORY ROLES HELD BY SP ===');
(dirRoles.body?.value ?? []).forEach((a) =>
  console.log(` - ${a.roleDefinition?.displayName} (assignment ${a.id})`),
);

// --- mailbox permission still in place? ---------------------------------------

const exoToken = async () => {
  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.MS_GRAPH_CLIENT_ID,
      client_secret: env.MS_GRAPH_CLIENT_SECRET,
      scope: 'https://outlook.office365.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  return (await res.json()).access_token;
};

const res = await fetch(`https://outlook.office365.com/adminapi/beta/${TENANT}/InvokeCommand`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${await exoToken()}`,
    'Content-Type': 'application/json',
    'X-CmdletName': 'Get-MailboxPermission',
    Accept: 'application/json',
    'Accept-Encoding': 'identity',
    'X-AnchorMailbox': `UPN:${MAILBOX}`,
  },
  body: JSON.stringify({
    CmdletInput: { CmdletName: 'Get-MailboxPermission', Parameters: { Identity: MAILBOX } },
  }),
});
const body = await res.json();
console.log('\n=== MAILBOX PERMISSIONS ON DENNIS ===');
console.log(`HTTP ${res.status}`);
(body?.value ?? []).forEach((p) => console.log(` - ${p.User}: ${p.AccessRights} (deny=${p.Deny})`));
