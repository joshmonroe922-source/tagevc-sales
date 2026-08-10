/**
 * Dennis McCall → Dialpad user on the Recruit 619 office with a 619 DID.
 *
 * Idempotent: re-running finds the existing user by email instead of creating a
 * second one, and only assigns a number when he has no 619 line yet.
 */
import { dp, show, OFFICES } from './lib.mjs';

const EMAIL = 'dennismccall@recruit619.com';
const FIRST = 'Dennis';
const LAST = 'McCall';
const OFFICE = OFFICES['ENT-R619'];
const AREA_CODE = '619';

// --- 1. does he already exist? ----------------------------------------------
const search = await dp(`users?limit=100`);
let user = (search.body?.items ?? []).find((u) =>
  (u.emails ?? []).some((e) => e.toLowerCase() === EMAIL),
);
console.log('existing Dialpad user for Dennis:', user ? user.id : 'none');

// --- 2. create ---------------------------------------------------------------
if (!user) {
  const created = await dp('users', {
    method: 'POST',
    body: JSON.stringify({
      email: EMAIL,
      office_id: Number(OFFICE.id),
      first_name: FIRST,
      last_name: LAST,
      license: 'talk',
      auto_assign: false,
    }),
  });
  show('create user', created);
  if (!created.ok) {
    console.error('\nCREATE FAILED — stopping before number assignment.');
    process.exit(2);
  }
  user = created.body;
}

const userId = user.id;
console.log(`\nDennis dialpad_user_id = ${userId} (office ${user.office_id})`);

// --- 3. 619 number -----------------------------------------------------------
const has619 = (user.phone_numbers ?? []).some((n) => n.startsWith('+1619'));
if (has619) {
  console.log('already has a 619 number:', user.phone_numbers);
} else {
  const assigned = await dp(`users/${userId}/assign_number`, {
    method: 'POST',
    body: JSON.stringify({ area_code: AREA_CODE, primary: true }),
  });
  show(`assign ${AREA_CODE} number`, assigned);
}

// --- 4. read back ------------------------------------------------------------
show('final user', await dp(`users/${userId}`));
