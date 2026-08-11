/**
 * Reproduce the Recruit 619 CRM "initiate_call HTTP 400" with the payload the
 * portal actually sends, then contrast it with the documented v2 shape.
 * Read-only apart from the deliberate 400s.
 */

import { dp, show } from './lib.mjs';

const JOSH = '4721934169743360';
const DENNIS = '5690823254417408';
const TARGET = process.env.PROBE_TARGET ?? '+16195550100';

const users = await dp(`users/${JOSH}`);
show('GET users/josh', users);
const dennis = await dp(`users/${DENNIS}`);
show('GET users/dennis', dennis);

// Exactly what src/lib/modules/communicate/dialpad-initiate.ts posts today.
const portalPayload = {
  user_id: JOSH,
  to_number: TARGET,
  custom_data: { entity_id: 'ENT-R619', contact_id: 'probe-1' },
};
show(
  'POST call — portal payload (to_number + object custom_data)',
  await dp('call', { method: 'POST', body: JSON.stringify(portalPayload) }),
);

// Same but only fixing the field name, to isolate each error.
show(
  'POST call — phone_number + object custom_data',
  await dp('call', {
    method: 'POST',
    body: JSON.stringify({
      user_id: JOSH,
      phone_number: TARGET,
      custom_data: { entity_id: 'ENT-R619' },
    }),
  }),
);

// Non-e164 target, the shape normalizeDialpadNumber() emits for 10-digit input.
show(
  'POST call — phone_number not e164',
  await dp('call', {
    method: 'POST',
    body: JSON.stringify({ user_id: JOSH, phone_number: '6195550100' }),
  }),
);

// SMS: what dialpad-sms.ts posts today.
show(
  'POST sms — portal payload (to_number + from_user_id)',
  await dp('sms', {
    method: 'POST',
    body: JSON.stringify({
      to_number: TARGET,
      text: 'probe',
      from_user_id: JOSH,
      custom_data: { entity_id: 'ENT-R619' },
    }),
  }),
);
