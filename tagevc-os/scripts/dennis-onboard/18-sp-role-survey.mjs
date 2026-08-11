/** Read-only: locate the Tage VC OS service principal and its directory role state. */

import { graph } from './lib.mjs';

const APP_ID = '905649ff-1aee-4683-87e0-5d6d2005aea5';

const sp = await graph(
  `v1.0/servicePrincipals?$filter=appId eq '${APP_ID}'&$select=id,appId,displayName`,
);
console.log('=== SERVICE PRINCIPAL ===');
console.log(`HTTP ${sp.status}`);
console.log(JSON.stringify(sp.body?.value ?? sp.body, null, 1));

const spId = sp.body?.value?.[0]?.id;

if (spId) {
  const assigned = await graph(
    `v1.0/roleManagement/directory/roleAssignments?$filter=principalId eq '${spId}'&$expand=roleDefinition($select=displayName,templateId)`,
  );
  console.log('\n=== EXISTING DIRECTORY ROLE ASSIGNMENTS FOR SP ===');
  console.log(`HTTP ${assigned.status}`);
  console.log(
    JSON.stringify(
      (assigned.body?.value ?? []).map((a) => ({
        id: a.id,
        role: a.roleDefinition?.displayName,
        templateId: a.roleDefinition?.templateId,
      })),
      null,
      1,
    ),
  );
}

const roles = await graph(
  `v1.0/roleManagement/directory/roleDefinitions?$filter=startswith(displayName,'Exchange')&$select=id,displayName,templateId,isBuiltIn`,
);
console.log('\n=== EXCHANGE ROLE DEFINITIONS ===');
console.log(`HTTP ${roles.status}`);
console.log(JSON.stringify(roles.body?.value ?? roles.body, null, 1));
