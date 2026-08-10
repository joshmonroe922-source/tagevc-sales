/** Read-only go-live verification: users, numbers, licenses, webhook + subscriptions. */
import { dp, show, OFFICES, COMPANY_ID } from './lib.mjs';

const JOSH = '4721934169743360';
const DENNIS = '5690823254417408';

const brief = (u) => ({
  id: u?.id,
  name: u?.display_name,
  email: u?.emails?.[0],
  license: u?.license,
  office_id: u?.office_id,
  office: Object.entries(OFFICES).find(([, o]) => o.id === u?.office_id)?.[0] ?? '?',
  numbers: u?.phone_numbers,
  state: u?.state,
  title: u?.job_title,
  onboarded: u?.onboarding_completed,
});

for (const [label, id] of [['JOSH', JOSH], ['DENNIS', DENNIS]]) {
  const r = await dp(`users/${id}`);
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(brief(r.body), null, 1));
}

console.log('\n=== company users ===');
const all = await dp('users?limit=100');
console.log(JSON.stringify((all.body?.items ?? []).map(brief), null, 1));

for (const path of ['webhooks', 'subscriptions/call', 'subscriptions/sms']) {
  const r = await dp(`${path}?limit=50`);
  console.log(`\n=== ${path} (HTTP ${r.status}) ===`);
  console.log(JSON.stringify(r.body?.items ?? r.body, null, 1));
}

console.log('\ncompany_id', COMPANY_ID);
