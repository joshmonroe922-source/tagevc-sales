/**
 * Dennis McCall → live Dialpad user, Recruit 619 office, 619 DID.
 *
 * Dialpad only accepts user emails on the company's own domain (tagevc.com);
 * recruit619.com comes back as "blacklisted domains" from both the API and the
 * admin UI, and allowlisting it is a Dialpad Support ticket. So we give Dennis a
 * tagevc.com alias on his existing Recruit 619 mailbox and use that as the
 * Dialpad login. Everything customer-facing (office, DID, caller ID) stays R619.
 *
 * Idempotent: safe to re-run.
 */
import { dp, show, OFFICES } from './lib.mjs';
import { graph } from '../dennis-onboard/lib.mjs';

const ENTRA_ID = '89fdd120-d221-4953-93a2-fc39a5f46983';
const REAL_EMAIL = 'dennismccall@recruit619.com';
const DIALPAD_EMAIL = 'dennismccall@tagevc.com';
const OFFICE = OFFICES['ENT-R619'];
const LICENSE = 'agents'; // Dialpad Sell Premium — the 2 seats actually paid for
const AREA_CODE = '619';

// --- 1. tagevc.com alias on his R619 mailbox --------------------------------
const before = await graph(
  `v1.0/users/${ENTRA_ID}?$select=id,userPrincipalName,mail,proxyAddresses`,
);
const proxies = before.body?.proxyAddresses ?? [];
console.log('current proxyAddresses:', proxies);

if (!proxies.some((p) => p.toLowerCase() === `smtp:${DIALPAD_EMAIL}`)) {
  const patched = await graph(`v1.0/users/${ENTRA_ID}`, {
    method: 'PATCH',
    body: JSON.stringify({ proxyAddresses: [...proxies, `smtp:${DIALPAD_EMAIL}`] }),
  });
  show('add tagevc.com alias', patched);
  if (!patched.ok) {
    console.error('alias add failed — Dialpad welcome mail would bounce. Stopping.');
    process.exit(2);
  }
} else {
  console.log('alias already present');
}

// --- 2. Dialpad user ---------------------------------------------------------
const all = await dp('users?limit=100');
let user = (all.body?.items ?? []).find((u) =>
  (u.emails ?? []).some((e) =>
    [DIALPAD_EMAIL, REAL_EMAIL].includes(e.toLowerCase()),
  ),
);

if (!user) {
  const created = await dp('users', {
    method: 'POST',
    body: JSON.stringify({
      email: DIALPAD_EMAIL,
      office_id: Number(OFFICE.id),
      first_name: 'Dennis',
      last_name: 'McCall',
      license: LICENSE,
      auto_assign: false,
    }),
  });
  show('create Dialpad user', created);
  if (!created.ok) process.exit(2);
  user = created.body;
} else {
  console.log('Dialpad user already exists:', user.id);
}

const userId = user.id;

// --- 3. 619 number -----------------------------------------------------------
const fresh = (await dp(`users/${userId}`)).body ?? user;
if ((fresh.phone_numbers ?? []).some((n) => n.startsWith('+1619'))) {
  console.log('already has a 619 line:', fresh.phone_numbers);
} else {
  show(
    'assign 619 number',
    await dp(`users/${userId}/assign_number`, {
      method: 'POST',
      body: JSON.stringify({ area_code: AREA_CODE, primary: true }),
    }),
  );
}

// --- 4. job title + read back ------------------------------------------------
await dp(`users/${userId}`, {
  method: 'PATCH',
  body: JSON.stringify({ job_title: 'VP of Recruiting' }),
});

show('FINAL Dennis', await dp(`users/${userId}`));
