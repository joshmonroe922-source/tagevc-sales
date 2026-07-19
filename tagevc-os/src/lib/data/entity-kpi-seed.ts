import type { EntityMonthKpi, EntityMonthKpiFlex } from '@/lib/types';
import { CORE_KPI_CATALOG } from '@/lib/portfolio/core-kpis';
import { SEED_PERIOD } from '@/lib/data/seed';

function coreRow(
  id: string,
  entityId: string,
  kpiKey: string,
  valueNum: number | null,
  valueText: string | null = null,
): EntityMonthKpi {
  const cat = CORE_KPI_CATALOG.find((c) => c.kpi_key === kpiKey)!;
  return {
    id,
    entity_id: entityId,
    period: SEED_PERIOD,
    kpi_key: cat.kpi_key,
    label: cat.label,
    value_num: valueNum,
    value_text: valueText,
    unit: cat.unit,
    method: cat.method,
    standard: 'CORE',
  };
}

/** Period 2026-03 CORE KPIs — Instant NDA is the demo-complete subsidiary. */
export const SEED_ENTITY_MONTH_KPI: EntityMonthKpi[] = [
  // ENT-002 Instant NDA — full CORE pack
  coreRow('a1111111-1111-4111-8111-111111111101', 'ENT-002', 'revenue_arr', 480),
  coreRow('a1111111-1111-4111-8111-111111111102', 'ENT-002', 'mom_growth', 0.08),
  coreRow('a1111111-1111-4111-8111-111111111103', 'ENT-002', 'gross_margin', 0.8125),
  coreRow('a1111111-1111-4111-8111-111111111104', 'ENT-002', 'net_burn', 30),
  coreRow('a1111111-1111-4111-8111-111111111105', 'ENT-002', 'ending_cash', 540),
  coreRow('a1111111-1111-4111-8111-111111111106', 'ENT-002', 'runway_mo', 18),
  coreRow(
    'a1111111-1111-4111-8111-111111111107',
    'ENT-002',
    'health',
    null,
    'On Track',
  ),
  coreRow(
    'a1111111-1111-4111-8111-111111111108',
    'ENT-002',
    'top_risk',
    null,
    'Enterprise sales cycle',
  ),
  coreRow(
    'a1111111-1111-4111-8111-111111111109',
    'ENT-002',
    'customer_concentration',
    0.22,
  ),
  coreRow('a1111111-1111-4111-8111-111111111110', 'ENT-002', 'headcount_fte', 14),
  coreRow(
    'a1111111-1111-4111-8111-111111111111',
    'ENT-002',
    'pipeline_coverage',
    2.4,
  ),

  // ENT-001 Sample Closed Co
  coreRow('a1111111-1111-4111-8111-111111111201', 'ENT-001', 'revenue_arr', 120),
  coreRow('a1111111-1111-4111-8111-111111111202', 'ENT-001', 'mom_growth', 0.12),
  coreRow('a1111111-1111-4111-8111-111111111203', 'ENT-001', 'gross_margin', 0.7917),
  coreRow('a1111111-1111-4111-8111-111111111204', 'ENT-001', 'net_burn', 45),
  coreRow('a1111111-1111-4111-8111-111111111205', 'ENT-001', 'ending_cash', 630),
  coreRow('a1111111-1111-4111-8111-111111111206', 'ENT-001', 'runway_mo', 14),
  coreRow(
    'a1111111-1111-4111-8111-111111111207',
    'ENT-001',
    'health',
    null,
    'On Track',
  ),
  coreRow(
    'a1111111-1111-4111-8111-111111111208',
    'ENT-001',
    'top_risk',
    null,
    'Early GTM conversion',
  ),
  coreRow(
    'a1111111-1111-4111-8111-111111111209',
    'ENT-001',
    'customer_concentration',
    0.18,
  ),
  coreRow('a1111111-1111-4111-8111-111111111210', 'ENT-001', 'headcount_fte', 8),
  coreRow(
    'a1111111-1111-4111-8111-111111111211',
    'ENT-001',
    'pipeline_coverage',
    1.6,
  ),

  // ENT-R619 Recruit 619
  coreRow('a1111111-1111-4111-8111-111111111301', 'ENT-R619', 'revenue_arr', 0),
  coreRow('a1111111-1111-4111-8111-111111111302', 'ENT-R619', 'mom_growth', 0),
  coreRow('a1111111-1111-4111-8111-111111111303', 'ENT-R619', 'gross_margin', null),
  coreRow('a1111111-1111-4111-8111-111111111304', 'ENT-R619', 'net_burn', 0),
  coreRow('a1111111-1111-4111-8111-111111111305', 'ENT-R619', 'ending_cash', 0),
  coreRow(
    'a1111111-1111-4111-8111-111111111306',
    'ENT-R619',
    'runway_mo',
    null,
    'n/a',
  ),
  coreRow(
    'a1111111-1111-4111-8111-111111111307',
    'ENT-R619',
    'health',
    null,
    'On Track',
  ),
  coreRow(
    'a1111111-1111-4111-8111-111111111308',
    'ENT-R619',
    'top_risk',
    null,
    'Client concentration',
  ),
  coreRow(
    'a1111111-1111-4111-8111-111111111309',
    'ENT-R619',
    'customer_concentration',
    0.28,
  ),
  coreRow('a1111111-1111-4111-8111-111111111310', 'ENT-R619', 'headcount_fte', 6),
];

/** FLEX KPIs — entity-detail only; never into portfolio money roll-up. */
export const SEED_ENTITY_MONTH_KPI_FLEX: EntityMonthKpiFlex[] = [
  {
    id: 'b2222222-2222-4222-8222-222222222201',
    entity_id: 'ENT-002',
    period: SEED_PERIOD,
    flex_key: 'nrr',
    label: 'NRR',
    value_num: 1.12,
    value_text: null,
    unit: '%',
    industry_module: 'SaaS',
    standard: 'FLEX',
  },
  {
    id: 'b2222222-2222-4222-8222-222222222202',
    entity_id: 'ENT-002',
    period: SEED_PERIOD,
    flex_key: 'cac',
    label: 'CAC',
    value_num: 4200,
    value_text: null,
    unit: '$',
    industry_module: 'SaaS',
    standard: 'FLEX',
  },
  {
    id: 'b2222222-2222-4222-8222-222222222203',
    entity_id: 'ENT-002',
    period: SEED_PERIOD,
    flex_key: 'ltv',
    label: 'LTV',
    value_num: 38000,
    value_text: null,
    unit: '$',
    industry_module: 'SaaS',
    standard: 'FLEX',
  },
  {
    id: 'b2222222-2222-4222-8222-222222222204',
    entity_id: 'ENT-R619',
    period: SEED_PERIOD,
    flex_key: 'placements',
    label: 'Recruit 619 Placements',
    value_num: 11,
    value_text: null,
    unit: 'count',
    industry_module: 'Recruiting',
    standard: 'FLEX',
  },
  {
    id: 'b2222222-2222-4222-8222-222222222205',
    entity_id: 'ENT-R619',
    period: SEED_PERIOD,
    flex_key: 'fill_time_days',
    label: 'Recruit 619 Avg Fill Time',
    value_num: 28,
    value_text: null,
    unit: 'days',
    industry_module: 'Recruiting',
    standard: 'FLEX',
  },
  {
    id: 'b2222222-2222-4222-8222-222222222206',
    entity_id: 'ENT-R619',
    period: SEED_PERIOD,
    flex_key: 'gp_per_desk',
    label: 'Recruit 619 GP per Desk',
    value_num: 18.5,
    value_text: null,
    unit: '$k',
    industry_module: 'Recruiting',
    standard: 'FLEX',
  },
];
