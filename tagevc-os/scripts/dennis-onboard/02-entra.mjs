/**
 * Provision Dennis's Microsoft 365 identity + mailbox (ENT-R619).
 *
 * Mirrors createOrUpdateGraphUserJoiner() but also sets usageLocation and
 * assigns an Exchange-bearing SKU, which is what actually materializes a
 * mailbox. Idempotent: re-running updates instead of duplicating.
 *
 * The temp password is written to .local-secrets/ and never printed in full.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { graph, show } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const secretsDir = resolve(here, '../../.local-secrets');

const UPN = 'dennis@recruit619.com';
const DISPLAY_NAME = 'Dennis';
const JOB_TITLE = 'VP of Recruiting';
const DEPARTMENT = 'Recruiting';
const COMPANY = 'Recruit 619';
const USAGE_LOCATION = 'US';
const SKU_BUSINESS_PREMIUM = 'f245ecc8-75af-4f8e-b61f-27d8114de5f3';

function tempPassword() {
  const raw = randomBytes(18).toString('base64').replace(/[^A-Za-z0-9]/g, '');
  return `R619!${raw.slice(0, 14)}9`;
}

const apply = process.argv.includes('--apply');

// 1. Does the user already exist?
const lookup = await graph(
  `v1.0/users?$filter=userPrincipalName eq '${UPN}' or mail eq '${UPN}'&$select=id,userPrincipalName,mail,displayName,accountEnabled,usageLocation,assignedLicenses`,
);
show('lookup', lookup);
let userId = lookup.body?.value?.[0]?.id ?? null;

if (!apply) {
  console.log('\nDRY RUN — pass --apply to mutate. Existing user:', userId);
  process.exit(0);
}

// 2. Create if absent.
let password = null;
if (!userId) {
  password = tempPassword();
  const create = await graph('v1.0/users', {
    method: 'POST',
    body: JSON.stringify({
      accountEnabled: true,
      displayName: DISPLAY_NAME,
      mailNickname: 'dennis',
      userPrincipalName: UPN,
      jobTitle: JOB_TITLE,
      department: DEPARTMENT,
      companyName: COMPANY,
      usageLocation: USAGE_LOCATION,
      passwordProfile: {
        forceChangePasswordNextSignIn: true,
        password,
      },
    }),
  });
  show('create user', create);
  if (!create.ok) process.exit(2);
  userId = create.body.id;
  mkdirSync(secretsDir, { recursive: true });
  writeFileSync(
    resolve(secretsDir, 'dennis-m365.json'),
    JSON.stringify(
      {
        upn: UPN,
        entra_object_id: userId,
        temp_password: password,
        force_change_on_first_signin: true,
        created_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`\nTemp password written to .local-secrets/dennis-m365.json (${password.length} chars)`);
} else {
  const patch = await graph(`v1.0/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      displayName: DISPLAY_NAME,
      jobTitle: JOB_TITLE,
      department: DEPARTMENT,
      companyName: COMPANY,
      usageLocation: USAGE_LOCATION,
      accountEnabled: true,
    }),
  });
  show('patch user', patch);
}

// 3. License → this is what creates the Exchange Online mailbox.
const lic = await graph(`v1.0/users/${userId}/assignLicense`, {
  method: 'POST',
  body: JSON.stringify({
    addLicenses: [{ skuId: SKU_BUSINESS_PREMIUM, disabledPlans: [] }],
    removeLicenses: [],
  }),
});
show('assignLicense', lic);

// 4. Verify.
const verify = await graph(
  `v1.0/users/${userId}?$select=id,displayName,userPrincipalName,mail,accountEnabled,usageLocation,jobTitle,department,companyName,assignedLicenses,assignedPlans`,
);
show('verify', verify);

console.log(
  '\nRESULT',
  JSON.stringify({
    entra_object_id: userId,
    upn: UPN,
    mail: verify.body?.mail ?? null,
    licensed: (verify.body?.assignedLicenses ?? []).length > 0,
    exchange_plans: (verify.body?.assignedPlans ?? [])
      .filter((p) => /exchange/i.test(p.service))
      .map((p) => `${p.service}:${p.capabilityStatus}`),
  }),
);
