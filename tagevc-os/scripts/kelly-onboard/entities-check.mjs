/** Read-only: coo_owner assignment for the subsidiary registry. */
import { sb } from '../dennis-onboard/lib.mjs';

const res = await sb(
  'entities?select=entity_id,canonical_name,entity_type,coo_owner,parent_entity_id&order=canonical_name',
);

if (!res.ok) {
  console.error('query failed', res.status, res.body);
  process.exit(1);
}

for (const e of res.body) {
  console.log(
    [
      e.entity_id.padEnd(14),
      (e.entity_type ?? '').padEnd(18),
      `coo_owner=${JSON.stringify(e.coo_owner)}`.padEnd(34),
      e.canonical_name,
    ].join(' '),
  );
}
