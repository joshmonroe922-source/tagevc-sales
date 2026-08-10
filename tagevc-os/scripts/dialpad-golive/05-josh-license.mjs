/**
 * Finish go-live:
 *  - Dennis: fix "Mccall" -> "McCall"
 *  - Josh: move off the Connect Enterprise trial seat onto Dialpad Sell Premium
 *    (stays in the Tage Venture Capital office, keeps +1 619 378-9360)
 */
import { dp, show, OFFICES } from './lib.mjs';

const JOSH = '4721934169743360';
const DENNIS = '5690823254417408';

show(
  'dennis name fix',
  await dp(`users/${DENNIS}`, {
    method: 'PATCH',
    body: JSON.stringify({ last_name: 'McCall' }),
  }),
);

const josh = await dp(`users/${JOSH}`);
console.log('josh before:', JSON.stringify({
  license: josh.body?.license,
  office_id: josh.body?.office_id,
  numbers: josh.body?.phone_numbers,
}));

if (josh.body?.license !== 'agents') {
  show(
    'josh -> Sell Premium',
    await dp(`users/${JOSH}`, {
      method: 'PATCH',
      body: JSON.stringify({ license: 'agents' }),
    }),
  );
}

const after = await dp(`users/${JOSH}`);
console.log('josh after:', JSON.stringify({
  license: after.body?.license,
  office_id: after.body?.office_id,
  numbers: after.body?.phone_numbers,
  state: after.body?.state,
}));

console.log('\nexpected office ids —',
  'FIRM:', OFFICES['ENT-FIRM'].id, ' R619:', OFFICES['ENT-R619'].id);
