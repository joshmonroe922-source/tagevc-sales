/**
 * Hard-delete prelaunch demo VC leads LD-001..LD-007 (+ Orbit Data deal DE-001).
 * Soft-archive left them visible on Lead Intake → Recent intake.
 *
 * Usage (from tagevc-os):
 *   node --env-file=.env.local scripts/hard-delete-demo-vc-leads.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const leadIds = [
  'LD-001',
  'LD-002',
  'LD-003',
  'LD-004',
  'LD-005',
  'LD-006',
  'LD-007',
];
const dealIds = ['DE-001'];

const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: beforeLeads, error: beforeErr } = await sb
  .from('os_leads')
  .select('lead_id, company_name, archived_at')
  .in('lead_id', leadIds)
  .order('lead_id');
if (beforeErr) {
  console.error('fetch leads', beforeErr.message);
  process.exit(1);
}
console.log('Before leads:', beforeLeads);

// Deal-side demo row (Orbit Data). Keep Instant NDA DE-LAU-01.
for (const table of ['os_deal_tasks', 'os_ic_reviews', 'os_ic_audits']) {
  const { data, error } = await sb
    .from(table)
    .delete()
    .in('deal_id', dealIds)
    .select('deal_id');
  if (error) console.warn(`${table} delete:`, error.message);
  else console.log(`Deleted ${table}:`, data?.length ?? 0);
}

const { data: deletedDeals, error: dealErr } = await sb
  .from('os_deals')
  .delete()
  .in('deal_id', dealIds)
  .select('deal_id, company_name');
if (dealErr) {
  console.error('delete deals', dealErr.message);
  process.exit(1);
}
console.log('Deleted deals:', deletedDeals);

// Lead tasks cascade via FK; delete leads.
const { data: deletedLeads, error: leadErr } = await sb
  .from('os_leads')
  .delete()
  .in('lead_id', leadIds)
  .select('lead_id, company_name');
if (leadErr) {
  console.error('delete leads', leadErr.message);
  process.exit(1);
}
console.log('Deleted leads:', deletedLeads);

// Strip demo rows from deal_flow snapshot so hydrate cannot resurrect them.
const { data: snaps, error: snapErr } = await sb
  .from('os_store_snapshots')
  .select('collection, payload, version')
  .eq('collection', 'deal_flow')
  .limit(1);
if (snapErr) {
  console.warn('snapshot read skipped:', snapErr.message);
} else if (snaps?.[0]?.payload) {
  const payload = snaps[0].payload;
  const leadSet = new Set(leadIds);
  const dealSet = new Set(dealIds);
  let changed = false;
  if (Array.isArray(payload.leads)) {
    const next = payload.leads.filter((l) => !leadSet.has(l.lead_id));
    if (next.length !== payload.leads.length) {
      payload.leads = next;
      changed = true;
    }
  }
  if (Array.isArray(payload.tasks)) {
    const next = payload.tasks.filter((t) => !leadSet.has(t.lead_id));
    if (next.length !== payload.tasks.length) {
      payload.tasks = next;
      changed = true;
    }
  }
  if (Array.isArray(payload.deals)) {
    const next = payload.deals.filter((d) => !dealSet.has(d.deal_id));
    if (next.length !== payload.deals.length) {
      payload.deals = next;
      changed = true;
    }
  }
  if (Array.isArray(payload.dealTasks)) {
    const next = payload.dealTasks.filter((t) => !dealSet.has(t.deal_id));
    if (next.length !== payload.dealTasks.length) {
      payload.dealTasks = next;
      changed = true;
    }
  }
  if (Array.isArray(payload.icReviews)) {
    const next = payload.icReviews.filter((r) => !dealSet.has(r.deal_id));
    if (next.length !== payload.icReviews.length) {
      payload.icReviews = next;
      changed = true;
    }
  }
  if (changed) {
    const now = new Date().toISOString();
    const { error: upErr } = await sb.from('os_store_snapshots').upsert({
      collection: 'deal_flow',
      payload,
      version: snaps[0].version ?? 1,
      updated_at: now,
    });
    if (upErr) console.warn('snapshot update failed:', upErr.message);
    else console.log('Patched deal_flow snapshot (removed demo leads/deals)');
  } else {
    console.log('Snapshot already free of target demo leads/deals');
  }
} else {
  console.log('No deal_flow snapshot row');
}

const { data: afterLeads } = await sb
  .from('os_leads')
  .select('lead_id, company_name')
  .order('lead_id');
const { count: leadCount } = await sb
  .from('os_leads')
  .select('lead_id', { count: 'exact', head: true });
console.log('After all leads:', afterLeads, 'count=', leadCount);
console.log('Done', {
  deletedLeads: deletedLeads?.length ?? 0,
  deletedDeals: deletedDeals?.length ?? 0,
});
