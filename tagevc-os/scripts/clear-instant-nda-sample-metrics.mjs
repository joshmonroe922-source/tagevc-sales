/**
 * Zero Instant NDA sample operating metrics (ARR/burn/cash/runway + CORE/FLEX KPIs).
 * Keeps Instant NDA as a live entity (ENT-INDA / PF-002 / ENT-002 legacy).
 *
 * Usage (from tagevc-os):
 *   node --env-file=.env.local scripts/clear-instant-nda-sample-metrics.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const entityIds = ['ENT-002', 'ENT-INDA'];
const today = new Date().toISOString().slice(0, 10);
const now = new Date().toISOString();

const { data: before, error: beforeErr } = await sb
  .from('portfolio_companies')
  .select(
    'portfolio_id, entity_id, company_name, arr_k, net_burn_k, cash_k, runway_mo',
  )
  .or(
    `entity_id.in.(${entityIds.join(',')}),portfolio_id.eq.PF-002,company_name.ilike.Instant NDA`,
  );
if (beforeErr) {
  console.error('fetch portfolio', beforeErr.message);
  process.exit(1);
}
console.log('Before portfolio:', before);

const { data: updatedCompanies, error: companyErr } = await sb
  .from('portfolio_companies')
  .update({
    arr_k: 0,
    mom_growth: 0,
    net_burn_k: 0,
    runway_mo: null,
    cash_k: 0,
    top_risk: 'Not connected — await IES',
    next_milestone: 'Connect Instant NDA IES books',
    last_update: today,
    updated_at: now,
  })
  .or(
    `entity_id.in.(${entityIds.join(',')}),portfolio_id.eq.PF-002,company_name.ilike.Instant NDA`,
  )
  .select(
    'portfolio_id, entity_id, company_name, arr_k, net_burn_k, cash_k, runway_mo',
  );
if (companyErr) {
  console.error('update portfolio_companies', companyErr.message);
  process.exit(1);
}
console.log('Updated portfolio:', updatedCompanies);

const { data: updatedPnl, error: pnlErr } = await sb
  .from('entity_month_pnl')
  .update({
    revenue_arr_k: 0,
    cogs_k: 0,
    opex_k: 0,
    net_burn_k: 0,
    ending_cash_k: 0,
  })
  .in('entity_id', entityIds)
  .eq('is_firm', false)
  .select('id, entity_id, period, revenue_arr_k, net_burn_k, ending_cash_k');
if (pnlErr) {
  console.error('update entity_month_pnl', pnlErr.message);
  process.exit(1);
}
console.log('Updated pnl:', updatedPnl);

const { data: kpis, error: kpiFetchErr } = await sb
  .from('entity_month_kpi')
  .select('id, entity_id, kpi_key, value_num, value_text')
  .in('entity_id', entityIds);
if (kpiFetchErr) {
  console.error('fetch entity_month_kpi', kpiFetchErr.message);
  process.exit(1);
}

const zeroNum = new Set([
  'revenue_arr',
  'mom_growth',
  'net_burn',
  'ending_cash',
  'headcount_fte',
]);
const nullNum = new Set([
  'gross_margin',
  'runway_mo',
  'customer_concentration',
  'pipeline_coverage',
]);

let kpiUpdated = 0;
for (const row of kpis ?? []) {
  const patch = {};
  if (zeroNum.has(row.kpi_key)) patch.value_num = 0;
  if (nullNum.has(row.kpi_key)) patch.value_num = null;
  if (row.kpi_key === 'runway_mo') patch.value_text = 'n/a';
  if (row.kpi_key === 'top_risk') patch.value_text = 'Not connected — await IES';
  if (Object.keys(patch).length === 0) continue;
  const { error } = await sb
    .from('entity_month_kpi')
    .update(patch)
    .eq('id', row.id);
  if (error) {
    console.warn('kpi update', row.id, error.message);
  } else {
    kpiUpdated += 1;
  }
}
console.log('Updated core KPIs:', kpiUpdated);

const { data: deletedFlex, error: flexErr } = await sb
  .from('entity_month_kpi_flex')
  .delete()
  .in('entity_id', entityIds)
  .in('flex_key', ['nrr', 'cac', 'ltv'])
  .select('id, entity_id, flex_key');
if (flexErr) {
  console.warn('delete flex KPIs:', flexErr.message);
} else {
  console.log('Deleted sample FLEX KPIs:', deletedFlex);
}

console.log('Done — Instant NDA sample metrics cleared (entity kept).');
