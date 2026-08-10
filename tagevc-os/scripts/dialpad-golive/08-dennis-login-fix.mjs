/**
 * Diagnose + fix Dennis's Dialpad sign-in.
 *
 * Two separate failures are in play:
 *   - Microsoft SSO as dennismccall@tagevc.com fails at Microsoft, because that
 *     address is only a proxyAddress (mail alias), never a sign-in UPN.
 *   - Microsoft SSO as dennismccall@recruit619.com authenticates at Microsoft
 *     but fails at Dialpad, because Dialpad's user record carries the
 *     @tagevc.com address and recruit619.com is not a verified Dialpad domain.
 *
 * Attempted in order: flip the Dialpad email to the real UPN, then fall back to
 * detaching the Microsoft link so a plain Dialpad password can be used.
 */
import { dp, show } from './lib.mjs';

const DENNIS = '5690823254417408';
const REAL = 'dennismccall@recruit619.com';

const before = await dp(`users/${DENNIS}`);
console.log('=== current ===');
console.log(JSON.stringify({
  emails: before.body?.emails,
  remote_service: before.body?.remote_service,
  state: before.body?.state,
  onboarding_completed: before.body?.onboarding_completed,
  is_admin: before.body?.is_admin,
}, null, 1));

// 1. can we just point the Dialpad user at his real UPN?
show('PATCH email -> real UPN', await dp(`users/${DENNIS}`, {
  method: 'PATCH',
  body: JSON.stringify({ email: REAL }),
}));

// 2. some tenants expose emails[] instead of email
show('PATCH emails[] -> real UPN', await dp(`users/${DENNIS}`, {
  method: 'PATCH',
  body: JSON.stringify({ emails: [REAL] }),
}));

// 3. remote_service=microsoft can pin the account to SSO and suppress
//    password sign-in; clearing it re-enables the email+password path
show('PATCH clear remote_service', await dp(`users/${DENNIS}`, {
  method: 'PATCH',
  body: JSON.stringify({ remote_service: '' }),
}));

const after = await dp(`users/${DENNIS}`);
console.log('\n=== after ===');
console.log(JSON.stringify({
  emails: after.body?.emails,
  remote_service: after.body?.remote_service,
  state: after.body?.state,
  onboarding_completed: after.body?.onboarding_completed,
}, null, 1));
