/**
 * Read-only probe for the three Dialpad leftovers that were believed to be
 * Admin-UI-only: support ticket creation, AI seat (Live Coach / Playbooks /
 * Recaps) assignment, and Recruit 619 office credit balance / top-up.
 *
 * Everything here is a GET. It answers "is this automatable?" and nothing else.
 *
 *   node scripts/dialpad-golive/09-leftovers-probe.mjs
 */
import { dp, OFFICES, COMPANY_ID } from './lib.mjs';

const JOSH = '4721934169743360';
const DENNIS = '5690823254417408';
const R619 = OFFICES['ENT-R619'].id;

const probe = async (label, path) => {
  const r = await dp(path);
  const err =
    typeof r.body?.error === 'object'
      ? r.body.error.message ?? JSON.stringify(r.body.error)
      : r.body?.error ?? r.body?.message ?? '';
  console.log(`${String(r.status).padEnd(4)} ${label.padEnd(42)} ${String(err).slice(0, 90)}`);
  return r;
};

console.log('=== 1. support / ticketing endpoints ===');
for (const p of [
  'support',
  'support/tickets',
  'tickets',
  'cases',
  'help',
  'company/support',
]) {
  await probe(p, p);
}

console.log('\n=== 2. license / AI seat surfaces ===');
for (const p of [
  'licenses',
  'company/licenses',
  `offices/${R619}/licenses`,
  `users/${JOSH}/licenses`,
  `users/${JOSH}/settings`,
  'plans',
  'company/plans',
]) {
  await probe(p, p);
}

console.log('\n=== 3. billing / credits surfaces ===');
for (const p of [
  'billing',
  'company/billing',
  `offices/${R619}/billing`,
  `offices/${R619}/credits`,
  'credits',
  `offices/${R619}/plan`,
]) {
  await probe(p, p);
}

const plan = await dp(`offices/${R619}/plan`);
console.log('\nR619 office plan body:', JSON.stringify(plan.body, null, 1));

console.log('\n=== what the documented endpoints actually expose ===');
const company = await dp('company');
console.log(
  'company settings keys:',
  Object.keys(company.body?.settings ?? {}).join(', ') || '(none)',
);
console.log('company keys:', Object.keys(company.body ?? {}).join(', '));

const office = await dp(`offices/${R619}`);
console.log('\nR619 office keys:', Object.keys(office.body ?? {}).join(', '));
for (const k of Object.keys(office.body ?? {})) {
  if (/credit|balance|billing|plan|license|ai/i.test(k)) {
    console.log(`  ${k} =`, JSON.stringify(office.body[k]));
  }
}

console.log('\n=== seat + login state ===');
for (const [label, id] of [
  ['JOSH', JOSH],
  ['DENNIS', DENNIS],
]) {
  const u = await dp(`users/${id}`);
  const b = u.body ?? {};
  console.log(
    `${label.padEnd(7)}`,
    JSON.stringify({
      email: b.emails?.[0],
      license: b.license,
      state: b.state,
      office_id: b.office_id,
      numbers: b.phone_numbers,
      onboarding_completed: b.onboarding_completed,
      date_first_login: b.date_first_login ?? null,
      remote_service: b.remote_service,
    }),
  );
  const aiKeys = Object.keys(b).filter((k) => /coach|playbook|recap|(^|_)ai(_|$)/i.test(k));
  console.log(`${' '.repeat(8)}AI-seat fields on user object: ${aiKeys.join(', ') || '(none)'}`);
}

console.log('\ncompany_id', COMPANY_ID);
