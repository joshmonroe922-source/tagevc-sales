import type { IndustryModule, KpiRollupMethod } from '@/lib/types';

/** CORE KPI keys editable in-app; money CORE stays on financials form. */
export const EDITABLE_CORE_KPI_KEYS = [
  'gross_margin',
  'health',
  'top_risk',
  'customer_concentration',
  'headcount_fte',
  'pipeline_coverage',
] as const;

/**
 * Authoritative CORE KPI catalog — Core Subsidiary Structure §3.
 * Portal table: entity_month_kpi. Do not invent alternate names.
 */
export const CORE_KPI_CATALOG = [
  {
    kpi_key: 'revenue_arr',
    label: 'Revenue / ARR',
    unit: '$k',
    method: 'SUM' as KpiRollupMethod,
    required: true,
  },
  {
    kpi_key: 'mom_growth',
    label: 'MoM Growth %',
    unit: '%',
    method: 'WEIGHTED' as KpiRollupMethod,
    required: true,
  },
  {
    kpi_key: 'gross_margin',
    label: 'Gross Margin %',
    unit: '%',
    method: 'WEIGHTED' as KpiRollupMethod,
    required: true,
  },
  {
    kpi_key: 'net_burn',
    label: 'Net Burn $k',
    unit: '$k',
    method: 'SUM' as KpiRollupMethod,
    required: true,
  },
  {
    kpi_key: 'ending_cash',
    label: 'Ending Cash $k',
    unit: '$k',
    method: 'SUM' as KpiRollupMethod,
    required: true,
  },
  {
    kpi_key: 'runway_mo',
    label: 'Runway months',
    unit: 'mo',
    method: 'MIN_FLAG' as KpiRollupMethod,
    required: true,
  },
  {
    kpi_key: 'health',
    label: 'Health',
    unit: null,
    method: 'COUNT' as KpiRollupMethod,
    required: true,
  },
  {
    kpi_key: 'top_risk',
    label: 'Top Risk',
    unit: null,
    method: 'LIST' as KpiRollupMethod,
    required: false,
  },
  {
    kpi_key: 'customer_concentration',
    label: 'Customer concentration %',
    unit: '%',
    method: 'MIN_FLAG' as KpiRollupMethod,
    required: true,
  },
  {
    kpi_key: 'headcount_fte',
    label: 'Headcount FTE',
    unit: 'FTE',
    method: 'SUM' as KpiRollupMethod,
    required: true,
  },
  {
    kpi_key: 'pipeline_coverage',
    label: 'Pipeline coverage (GTM)',
    unit: 'x',
    method: 'n/a' as KpiRollupMethod,
    required: false,
  },
] as const;

export type CoreKpiKey = (typeof CORE_KPI_CATALOG)[number]['kpi_key'];

/** Industry FLEX playbooks — Core §3C / Entity Master.industry_module. */
export const FLEX_KPI_BY_MODULE: Record<
  string,
  Array<{ flex_key: string; label: string; unit: string | null }>
> = {
  SaaS: [
    { flex_key: 'nrr', label: 'NRR', unit: '%' },
    { flex_key: 'cac', label: 'CAC', unit: '$' },
    { flex_key: 'ltv', label: 'LTV', unit: '$' },
  ],
  Recruiting: [
    { flex_key: 'placements', label: 'Recruit 619 Placements', unit: 'count' },
    {
      flex_key: 'fill_time_days',
      label: 'Recruit 619 Avg Fill Time',
      unit: 'days',
    },
    { flex_key: 'gp_per_desk', label: 'Recruit 619 GP per Desk', unit: '$k' },
  ],
  'Real Estate Resi': [
    { flex_key: 'occupancy', label: 'Occupancy', unit: '%' },
    { flex_key: 'yield_on_basis', label: 'Yield on basis', unit: '%' },
  ],
};

export function flexKeysForModule(
  module: IndustryModule | string | null,
): Array<{ flex_key: string; label: string; unit: string | null }> {
  if (!module) return [];
  return FLEX_KPI_BY_MODULE[module] ?? [];
}
