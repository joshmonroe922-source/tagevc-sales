/** Read-only Dialpad inventory: users, numbers, plans, 619 availability. */
import { dp, show, OFFICES } from './lib.mjs';

show('company', await dp('company'));
show('users', await dp('users?limit=100'));
show('company numbers', await dp('numbers?limit=100'));

for (const [entity, o] of Object.entries(OFFICES)) {
  show(`plan ${entity} (${o.name})`, await dp(`offices/${o.id}/plan`));
}

// Is there a 619 number sitting unassigned in the pool?
show('619 search (formats vary by tenant)', await dp('numbers?limit=100&status=available'));
