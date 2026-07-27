/**
 * One-shot: soft-archive demo VC leads LD-001..005 + LD-007 and deal DE-001.
 * Usage (from tagevc-os): node --env-file=.env.local scripts/archive-demo-vc-leads.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const archivedAt = new Date().toISOString();
const leadIds = ['LD-001', 'LD-002', 'LD-003', 'LD-004', 'LD-005', 'LD-007'];
const dealIds = ['DE-001'];

const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: beforeLeads, error: beforeErr } = await sb
  .from('os_leads')
  .select('lead_id, company_name, archived_at')
  .in('lead_id', leadIds);
if (beforeErr) {
  console.error('fetch leads', beforeErr.message);
  process.exit(1);
}
console.log('Before leads:', beforeLeads);

const { data: leads, error: leadErr } = await sb
  .from('os_leads')
  .update({ archived_at: archivedAt, updated_at: archivedAt })
  .in('lead_id', leadIds)
  .is('archived_at', null)
  .select('lead_id, company_name, archived_at');
if (leadErr) {
  console.error('update leads', leadErr.message);
  process.exit(1);
}
console.log('Archived leads:', leads);

const { data: deals, error: dealErr } = await sb
  .from('os_deals')
  .update({ archived_at: archivedAt, updated_at: archivedAt })
  .in('deal_id', dealIds)
  .is('archived_at', null)
  .select('deal_id, company_name, archived_at');
if (dealErr) {
  console.error('update deals', dealErr.message);
  process.exit(1);
}
console.log('Archived deals:', deals);

// Patch deal_flow snapshot payload if still present (pre-cutover safety).
const { data: snaps, error: snapErr } = await sb
  .from('os_store_snapshots')
  .select('collection, payload, version')
  .eq('collection', 'deal_flow')
  .limit(1);
if (snapErr) {
  console.warn('snapshot read skipped:', snapErr.message);
} else if (snaps?.[0]?.payload) {
  const payload = snaps[0].payload;
  let changed = false;
  if (Array.isArray(payload.leads)) {
    for (const l of payload.leads) {
      if (leadIds.includes(l.lead_id) && !l.archived_at) {
        l.archived_at = archivedAt;
        l.updated_at = archivedAt;
        changed = true;
      }
    }
  }
  if (Array.isArray(payload.deals)) {
    for (const d of payload.deals) {
      if (dealIds.includes(d.deal_id) && !d.archived_at) {
        d.archived_at = archivedAt;
        d.updated_at = archivedAt;
        changed = true;
      }
    }
  }
  if (changed) {
    const { error: upErr } = await sb.from('os_store_snapshots').upsert({
      collection: 'deal_flow',
      payload,
      version: snaps[0].version ?? 1,
      updated_at: archivedAt,
    });
    if (upErr) console.warn('snapshot update failed:', upErr.message);
    else console.log('Patched deal_flow snapshot payload');
  } else {
    console.log('Snapshot already archived or empty of target leads');
  }
} else {
  console.log('No deal_flow snapshot row (SQL-primary / retired)');
}

const { data: afterLeads } = await sb
  .from('os_leads')
  .select('lead_id, company_name, archived_at')
  .in('lead_id', leadIds)
  .order('lead_id');
console.log('After leads:', afterLeads);
console.log('Done', { archivedAt, leads: leads?.length ?? 0, deals: deals?.length ?? 0 });
