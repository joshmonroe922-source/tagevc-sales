/**
 * Verify the corrected Dialpad payload shapes for POST /call and POST /sms.
 * Targets a 555 test number so nothing real is dialled or texted.
 */

import { dp, show } from './lib.mjs';

const JOSH = '4721934169743360';
const TARGET = process.env.PROBE_TARGET ?? '+16195550100';

// Corrected call payload: phone_number, E.164, custom_data as a JSON string.
show(
  'POST call — corrected, user_id as string',
  await dp('call', {
    method: 'POST',
    body: JSON.stringify({
      user_id: JOSH,
      phone_number: TARGET,
      custom_data: JSON.stringify({ entity_id: 'ENT-R619', contact_id: 'probe-1' }),
    }),
  }),
);

show(
  'POST call — corrected, user_id as number',
  await dp('call', {
    method: 'POST',
    body: JSON.stringify({
      user_id: Number(JOSH),
      phone_number: TARGET,
      custom_data: JSON.stringify({ entity_id: 'ENT-R619', contact_id: 'probe-2' }),
    }),
  }),
);

// SMS wants user_id + to_numbers[] per the v2 schema.
show(
  'POST sms — user_id + to_numbers[]',
  await dp('sms', {
    method: 'POST',
    body: JSON.stringify({
      user_id: JOSH,
      to_numbers: [TARGET],
      text: 'probe',
    }),
  }),
);

show(
  'POST sms — user_id + to_numbers[] + custom_data string',
  await dp('sms', {
    method: 'POST',
    body: JSON.stringify({
      user_id: JOSH,
      to_numbers: [TARGET],
      text: 'probe',
      custom_data: JSON.stringify({ entity_id: 'ENT-R619' }),
    }),
  }),
);
