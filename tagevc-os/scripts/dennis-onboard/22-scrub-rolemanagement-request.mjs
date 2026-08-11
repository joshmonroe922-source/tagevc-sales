/**
 * Cosmetic close-out for the borrowed RoleManagement.ReadWrite.Directory privilege.
 *
 * The app role assignment was revoked (see 20-verify-and-close.mjs), but the app
 * registration still *requests* the permission in requiredResourceAccess, so the
 * Entra "API permissions" blade keeps rendering a red "Not granted" row. This
 * removes the request itself.
 *
 *   node scripts/dennis-onboard/22-scrub-rolemanagement-request.mjs        # report only
 *   node scripts/dennis-onboard/22-scrub-rolemanagement-request.mjs --apply
 */

import { graph } from './lib.mjs';

const APP_OBJECT_ID = '3423e515-ef79-48eb-a6cb-18aa2e83fcb9';
const GRAPH_RESOURCE_APP_ID = '00000003-0000-0000-c000-000000000000';
const ROLE_MANAGEMENT_ID = '9e3f62cf-ca93-4989-b6ce-bf83c28f9fe8'; // RoleManagement.ReadWrite.Directory
const APPLY = process.argv.includes('--apply');

const app = await graph(
  `v1.0/applications/${APP_OBJECT_ID}?$select=id,appId,displayName,requiredResourceAccess`,
);
if (!app.ok) {
  console.log(`Cannot read the app registration — HTTP ${app.status}`);
  console.log(JSON.stringify(app.body, null, 1).slice(0, 1500));
  process.exit(1);
}

const required = app.body.requiredResourceAccess ?? [];
const graphBlock = required.find((r) => r.resourceAppId === GRAPH_RESOURCE_APP_ID);
const stale = graphBlock?.resourceAccess?.some((a) => a.id === ROLE_MANAGEMENT_ID) ?? false;

console.log(`App: ${app.body.displayName} (${app.body.appId})`);
console.log(`Graph permissions requested: ${graphBlock?.resourceAccess?.length ?? 0}`);
console.log(
  stale
    ? 'RoleManagement.ReadWrite.Directory is still REQUESTED — this is the "Not granted" row.'
    : 'RoleManagement.ReadWrite.Directory is not requested. Nothing to scrub.',
);

if (!stale || !APPLY) {
  if (stale) console.log('\nDry run. Re-run with --apply to remove it.');
  process.exit(0);
}

const nextRequired = required
  .map((r) =>
    r.resourceAppId === GRAPH_RESOURCE_APP_ID
      ? { ...r, resourceAccess: r.resourceAccess.filter((a) => a.id !== ROLE_MANAGEMENT_ID) }
      : r,
  )
  .filter((r) => (r.resourceAccess ?? []).length > 0);

const patch = await graph(`v1.0/applications/${APP_OBJECT_ID}`, {
  method: 'PATCH',
  body: JSON.stringify({ requiredResourceAccess: nextRequired }),
});

if (patch.ok) {
  console.log('\nRemoved. The "Not granted" row should disappear from the API permissions blade.');
  process.exit(0);
}

console.log(`\nPATCH failed — HTTP ${patch.status}`);
console.log(JSON.stringify(patch.body, null, 1).slice(0, 1200));
console.log(
  [
    '',
    'The app cannot rewrite its own registration (that needs Application.ReadWrite.All,',
    'or an owner assignment, neither of which it holds). One-click path for Josh:',
    '',
    '  https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/CallAnAPI/appId/905649ff-1aee-4683-87e0-5d6d2005aea5',
    '',
    '  API permissions -> the RoleManagement.ReadWrite.Directory row (red "Not granted")',
    '  -> ... -> Remove permission -> Yes, remove.',
    '',
    'Nothing depends on it; the privilege was borrowed on 2026-08-10 to assign',
    'Exchange Recipient Administrator and the grant itself is already revoked.',
  ].join('\n'),
);
