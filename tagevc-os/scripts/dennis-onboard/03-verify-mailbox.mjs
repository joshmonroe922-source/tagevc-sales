/** Poll until Dennis's license + Exchange Online mailbox are visible. */

import { graph } from './lib.mjs';

const ID = '89fdd120-d221-4953-93a2-fc39a5f46983';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 1; i <= 12; i += 1) {
  const u = await graph(
    `v1.0/users/${ID}?$select=id,displayName,userPrincipalName,mail,proxyAddresses,accountEnabled,usageLocation,assignedLicenses,assignedPlans`,
  );
  const licenses = u.body?.assignedLicenses ?? [];
  const exo = (u.body?.assignedPlans ?? []).filter((p) =>
    /exchange/i.test(p.service),
  );
  const mb = await graph(`v1.0/users/${ID}/mailboxSettings`);
  console.log(
    JSON.stringify({
      attempt: i,
      mail: u.body?.mail ?? null,
      licenses: licenses.length,
      exchange_plans: exo.map((p) => `${p.servicePlanId}:${p.capabilityStatus}`),
      proxy: u.body?.proxyAddresses ?? [],
      mailbox_settings_http: mb.status,
      mailbox_tz: mb.body?.timeZone ?? null,
    }),
  );
  if (licenses.length > 0 && mb.status === 200) {
    console.log('\nMAILBOX READY');
    break;
  }
  await sleep(15_000);
}
