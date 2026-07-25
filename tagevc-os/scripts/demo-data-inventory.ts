#!/usr/bin/env npx tsx
/**
 * CLI: inventory (default) or dry-run cleanup domains.
 * Destructive execute requires CONFIRM_CLEANUP=yes and --confirm "DELETE DEMO DATA"
 *
 *   npx tsx scripts/demo-data-inventory.ts
 *   npx tsx scripts/demo-data-inventory.ts --dry-run --domains leads_sample,tickets_seed
 */

import {
  CLEANUP_CONFIRM_PHRASE,
  executeDemoCleanup,
  inventoryDemoData,
  type DemoDomain,
} from '../src/lib/admin/demo-data-cleanup';

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run') || !args.includes('--execute');
  const domainsArg = args.find((a) => a.startsWith('--domains='));
  const domains = (domainsArg?.split('=')[1] ?? 'leads_sample,tickets_seed')
    .split(',')
    .filter(Boolean) as DemoDomain[];
  const confirmIdx = args.indexOf('--confirm');
  const phrase =
    confirmIdx >= 0 ? args[confirmIdx + 1] : CLEANUP_CONFIRM_PHRASE;

  if (args.includes('--execute') || args.includes('--dry-run')) {
    const result = await executeDemoCleanup({
      domains,
      confirm_phrase: phrase ?? '',
      dry_run: dry,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  const inv = await inventoryDemoData();
  console.log(JSON.stringify(inv, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
