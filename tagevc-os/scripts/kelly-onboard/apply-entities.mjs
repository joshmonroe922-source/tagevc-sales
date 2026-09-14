/**
 * Apply phase110 — set coo_owner on ENT-SIGNENT + ENT-INDA so the COO of
 * Subsidiaries sees all three operating companies under Assets → Businesses.
 * Idempotent: only fills rows whose coo_owner is still empty.
 *
 *   node scripts/kelly-onboard/apply-entities.mjs           # dry run
 *   node scripts/kelly-onboard/apply-entities.mjs --apply
 */
import { sb } from '../dennis-onboard/lib.mjs';

const APPLY = process.argv.includes('--apply');
const OWNER = 'COO — Ops Lead';
const TARGETS = ['ENT-SIGNENT', 'ENT-INDA'];

const before = await sb(
  `entities?entity_id=in.(${TARGETS.join(',')})&select=entity_id,canonical_name,entity_type,coo_owner`,
);
if (!before.ok) throw new Error(`read failed: ${JSON.stringify(before.body)}`);

console.log(`=== ${APPLY ? 'APPLY' : 'DRY RUN'} ===`);
for (const e of before.body) {
  console.log(` ${e.entity_id} · ${e.canonical_name} · coo_owner=${JSON.stringify(e.coo_owner)}`);
}

const pending = before.body.filter((e) => !(e.coo_owner ?? '').trim());
if (!pending.length) {
  console.log('\nNothing to do — both already assigned.');
  process.exit(0);
}

console.log(`\n${APPLY ? '' : '[dry-run] '}set coo_owner='${OWNER}' on ${pending.map((e) => e.entity_id).join(', ')}`);

if (APPLY) {
  for (const e of pending) {
    const res = await sb(
      `entities?entity_id=eq.${e.entity_id}&select=entity_id,coo_owner`,
      {
        method: 'PATCH',
        body: JSON.stringify({ coo_owner: OWNER, updated_at: new Date().toISOString() }),
      },
    );
    if (!res.ok) throw new Error(`patch ${e.entity_id} failed: ${JSON.stringify(res.body)}`);
    console.log(`   ok ${e.entity_id} → ${JSON.stringify(res.body?.[0]?.coo_owner)}`);
  }
}

const after = await sb(
  "entities?entity_type=eq.Subsidiary&select=entity_id,canonical_name,coo_owner&order=canonical_name",
);
console.log('\n=== subsidiaries after ===');
for (const e of after.body ?? []) {
  console.log(` ${e.entity_id.padEnd(14)} coo_owner=${JSON.stringify(e.coo_owner)} ${e.canonical_name}`);
}
