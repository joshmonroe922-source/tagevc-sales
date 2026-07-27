/**
 * One-shot: soft-archive sample RE assets RE-001 (1842 Maple) + RE-002 (Carmel Flex).
 * Usage (from tagevc-os): node --env-file=.env.local scripts/archive-demo-re-deals.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const archivedAt = new Date().toISOString();
const reIds = ['RE-001', 'RE-002'];

const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: before, error: beforeErr } = await sb
  .from('os_re_deals')
  .select('re_id, asset_name, archived_at')
  .in('re_id', reIds);
if (beforeErr) {
  console.error('fetch re deals', beforeErr.message);
  process.exit(1);
}
console.log('Before:', before);

const { data: archived, error: archiveErr } = await sb
  .from('os_re_deals')
  .update({ archived_at: archivedAt, updated_at: archivedAt })
  .in('re_id', reIds)
  .is('archived_at', null)
  .select('re_id, asset_name, archived_at');
if (archiveErr) {
  console.error('update re deals', archiveErr.message);
  process.exit(1);
}
console.log('Archived:', archived);

// Patch re snapshot payload if still present (pre-cutover safety).
const { data: snaps, error: snapErr } = await sb
  .from('os_store_snapshots')
  .select('collection, payload, version')
  .eq('collection', 're')
  .limit(1);
if (snapErr) {
  console.warn('snapshot read skipped:', snapErr.message);
} else if (snaps?.[0]?.payload) {
  const payload = snaps[0].payload;
  let changed = false;
  if (Array.isArray(payload.deals)) {
    for (const d of payload.deals) {
      if (reIds.includes(d.re_id) && !d.archived_at) {
        d.archived_at = archivedAt;
        d.updated_at = archivedAt;
        changed = true;
      }
    }
  }
  if (changed) {
    const { error: upErr } = await sb.from('os_store_snapshots').upsert({
      collection: 're',
      payload,
      version: snaps[0].version ?? 1,
      updated_at: archivedAt,
    });
    if (upErr) console.warn('snapshot update failed:', upErr.message);
    else console.log('Patched re snapshot payload');
  } else {
    console.log('Snapshot already archived or empty of target deals');
  }
} else {
  console.log('No re snapshot row (SQL-primary / retired)');
}

const { data: after } = await sb
  .from('os_re_deals')
  .select('re_id, asset_name, archived_at')
  .in('re_id', reIds)
  .order('re_id');
console.log('After:', after);
console.log('Done', { archivedAt, count: archived?.length ?? 0 });
