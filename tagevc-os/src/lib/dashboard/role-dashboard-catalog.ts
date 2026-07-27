/**
 * Role dashboard KPI catalog — goals vs actuals scaffolding.
 * Cards always render; data_state is live | partial | not_connected.
 * Never invent metric values.
 */

import type { AppRole } from '@/lib/types/roles';
import { APP_ROLE_LABELS } from '@/lib/types/roles';

export type DashboardDataState = 'live' | 'partial' | 'not_connected';
export type DashboardScopeMode = 'consolidated' | 'by_company' | 'company';

export type RoleDashboardKpiDef = {
  kpi_id: string;
  label: string;
  description: string;
  /** Leading vs lagging indicator preference */
  kind: 'leading' | 'lagging' | 'health';
};

export type RoleDashboardCard = RoleDashboardKpiDef & {
  actual: string | number | null;
  goal: string | number | null;
  variance_label: string | null;
  on_track: boolean | null;
  data_state: DashboardDataState;
  company_id?: string | null;
  company_name?: string | null;
};

/** Matches Visionary Role Switcher order (View as on Dashboard). */
export const DASHBOARD_VIEW_ROLES: AppRole[] = [
  'visionary',
  'partner',
  'coo',
  'sub_lead',
  'counsel_ops',
  'ssc_finance',
  'ssc_hr',
  'ssc_legal',
  'ssc_it',
  'ssc_marketing',
  'service_lead',
  'ma_associate',
  're_sourcer',
  'associate',
  'admin',
];

export function dashboardRoleLabel(role: AppRole): string {
  return APP_ROLE_LABELS[role] ?? role;
}

const CATALOG: Record<AppRole, RoleDashboardKpiDef[]> = {
  visionary: [
    { kpi_id: 'aum_dry_powder', label: 'AUM & dry powder', description: 'Capital available to deploy', kind: 'lagging' },
    { kpi_id: 'fund_returns', label: 'Fund returns by vintage', description: 'IRR · TVPI · DPI · MOIC · RVPI', kind: 'lagging' },
    { kpi_id: 'portfolio_health', label: 'Portfolio health', description: 'Overall value creation', kind: 'health' },
    { kpi_id: 'capital_raised', label: 'Capital raised vs target', description: 'LP commitment pipeline', kind: 'lagging' },
    { kpi_id: 'strategic_initiatives', label: 'Strategic initiatives', description: 'Progress against firm priorities', kind: 'leading' },
    { kpi_id: 'pipeline_quality', label: 'Pipeline quality', description: 'VC + RE + M&A conversion (top level)', kind: 'leading' },
    { kpi_id: 'risk_concentration', label: 'Risk / concentration', description: 'Exposure across thesis', kind: 'health' },
    { kpi_id: 'org_capacity', label: 'Org health / capacity', description: 'Bandwidth and coverage', kind: 'health' },
    { kpi_id: 'macro_signals', label: 'Macro / market signals', description: 'Thesis-relevant environment', kind: 'leading' },
    { kpi_id: 'brand_network', label: 'Brand / network strength', description: 'Reputation indicators', kind: 'leading' },
  ],
  partner: [
    { kpi_id: 'deal_pipeline', label: 'Deal pipeline', description: 'Stage + conversion', kind: 'leading' },
    { kpi_id: 'attributable_returns', label: 'Attributable fund returns', description: 'Investments under coverage', kind: 'lagging' },
    { kpi_id: 'portfolio_performance', label: 'Portfolio company performance', description: 'Covered companies', kind: 'lagging' },
    { kpi_id: 'exit_pipeline', label: 'Exit pipeline', description: 'Realized vs unrealized', kind: 'lagging' },
    { kpi_id: 'deployment_pace', label: 'Deployment pace', description: 'Dry powder in focus areas', kind: 'leading' },
    { kpi_id: 'lp_readiness', label: 'LP reporting readiness', description: 'Relationship health', kind: 'health' },
    { kpi_id: 'concentration', label: 'Active investment concentration', description: 'Risk/return mix', kind: 'health' },
    { kpi_id: 'diligence_throughput', label: 'Diligence → IC throughput', description: 'Quality and speed', kind: 'leading' },
    { kpi_id: 'team_contribution', label: 'Team contribution', description: 'Collaboration effectiveness', kind: 'leading' },
    { kpi_id: 'follow_on_reserves', label: 'Follow-on reserves', description: 'Capital needs', kind: 'lagging' },
  ],
  associate: [
    { kpi_id: 'opps_sourced', label: 'Opportunities sourced', description: 'Stage / sector / geography', kind: 'leading' },
    { kpi_id: 'funnel_conversion', label: 'Funnel conversion', description: 'Intro → meeting → diligence → term sheet', kind: 'leading' },
    { kpi_id: 'velocity', label: 'Stage velocity', description: 'Time-to-stage', kind: 'leading' },
    { kpi_id: 'source_effectiveness', label: 'Source effectiveness', description: 'Channel quality', kind: 'leading' },
    { kpi_id: 'pipeline_coverage', label: 'Pipeline vs thesis', description: 'Coverage targets', kind: 'leading' },
    { kpi_id: 'outreach_volume', label: 'Outreach / meetings', description: 'Volume + response rates', kind: 'leading' },
    { kpi_id: 'deal_quality', label: 'Deal quality score', description: 'Scoring where configured', kind: 'leading' },
    { kpi_id: 'win_loss', label: 'Win / loss reasons', description: 'Competitive intensity', kind: 'lagging' },
    { kpi_id: 'network_growth', label: 'Network growth', description: 'Relationship indicators', kind: 'leading' },
    { kpi_id: 'diligence_handoff', label: 'Diligence handoff', description: 'Completeness / speed', kind: 'leading' },
  ],
  re_sourcer: [
    { kpi_id: 'properties_review', label: 'Properties under review', description: 'Pipeline value', kind: 'leading' },
    { kpi_id: 're_conversion', label: 'Stage conversion', description: 'Sourcing → LOI → diligence → close', kind: 'leading' },
    { kpi_id: 'underwriting', label: 'Underwriting metrics', description: 'Cap rate · NOI · IRR · cash-on-cash', kind: 'leading' },
    { kpi_id: 'time_to_close', label: 'Time-to-close', description: 'Residential vs commercial', kind: 'leading' },
    { kpi_id: 'market_coverage', label: 'Market coverage', description: 'Geography + inventory velocity', kind: 'leading' },
    { kpi_id: 'acquisition_basis', label: 'Acquisition vs target basis', description: 'Cost discipline', kind: 'lagging' },
    { kpi_id: 'occupancy_rent', label: 'Occupancy / rent / tenants', description: 'Where applicable', kind: 'lagging' },
    { kpi_id: 'diligence_flags', label: 'Diligence risk flags', description: 'Open issues', kind: 'health' },
    { kpi_id: 'bid_success', label: 'Bid success rate', description: 'Win rate on offers', kind: 'lagging' },
    { kpi_id: 'pw_pipeline', label: 'Probability-weighted pipeline', description: 'Expected value', kind: 'leading' },
  ],
  ma_associate: [
    { kpi_id: 'ma_pipeline', label: 'M&A pipeline', description: 'Volume / quality / stage', kind: 'leading' },
    { kpi_id: 'target_kpis', label: 'Target financial KPIs', description: 'Operating metrics', kind: 'leading' },
    { kpi_id: 'valuation_synergy', label: 'Valuation + synergies', description: 'Vs criteria', kind: 'leading' },
    { kpi_id: 'ma_conversion', label: 'Conversion / time-in-stage', description: 'Throughput', kind: 'leading' },
    { kpi_id: 'diligence_risk', label: 'Diligence / risk scores', description: 'Open issues', kind: 'health' },
    { kpi_id: 'deal_lead_win', label: 'Deal-lead win rate', description: 'Relationship activity', kind: 'lagging' },
    { kpi_id: 'reg_integration', label: 'Regulatory / integration', description: 'Planning status', kind: 'leading' },
    { kpi_id: 'post_close_value', label: 'Post-close value creation', description: 'Tracking', kind: 'lagging' },
    { kpi_id: 'acq_goals', label: 'Pipeline vs acquisition goals', description: 'Annual targets', kind: 'lagging' },
    { kpi_id: 'retention_indicators', label: 'Employee / customer retention', description: 'On targets', kind: 'health' },
  ],
  coo: [
    { kpi_id: 'sub_financials', label: 'Subsidiary financials', description: 'Aggregate + by company', kind: 'lagging' },
    { kpi_id: 'okr_attainment', label: 'Leadership OKR attainment', description: 'By subsidiary head', kind: 'leading' },
    { kpi_id: 'synergies', label: 'Cross-sub synergies', description: 'Shared-resource utilization', kind: 'leading' },
    { kpi_id: 'ops_red_flags', label: 'Risk / compliance red flags', description: 'Across entities', kind: 'health' },
    { kpi_id: 'resource_allocation', label: 'Capital / resource allocation', description: 'Efficiency', kind: 'lagging' },
    { kpi_id: 'leadership_retention', label: 'Subsidiary leadership retention', description: 'Turnover', kind: 'health' },
    { kpi_id: 'runway_funding', label: 'Cash runway / funding needs', description: 'By subsidiary', kind: 'lagging' },
    { kpi_id: 'integration_status', label: 'Integration / initiatives', description: 'Status', kind: 'leading' },
    { kpi_id: 'benchmark_targets', label: 'Benchmark vs targets', description: 'Performance gaps', kind: 'lagging' },
    { kpi_id: 'escalation_effectiveness', label: 'Escalation volume / resolution', description: 'Effectiveness', kind: 'leading' },
  ],
  sub_lead: [
    { kpi_id: 'revenue_arr', label: 'Revenue / ARR growth', description: 'Top-line', kind: 'lagging' },
    { kpi_id: 'unit_economics', label: 'Profitability / unit economics', description: 'Margins', kind: 'lagging' },
    { kpi_id: 'cash_runway', label: 'Cash / burn / runway', description: 'Liquidity', kind: 'lagging' },
    { kpi_id: 'customer_metrics', label: 'Customer metrics', description: 'Acquisition · retention · LTV:CAC', kind: 'leading' },
    { kpi_id: 'ops_efficiency', label: 'Operational efficiency', description: 'Throughput', kind: 'leading' },
    { kpi_id: 'delivery_kpis', label: 'Delivery / product KPIs', description: 'Service quality', kind: 'leading' },
    { kpi_id: 'team_performance', label: 'Team / headcount / retention', description: 'Productivity', kind: 'health' },
    { kpi_id: 'okr_goals', label: 'OKR / strategic goals', description: 'Attainment', kind: 'leading' },
    { kpi_id: 'competitive_position', label: 'Competitive position', description: 'Indicators', kind: 'leading' },
    { kpi_id: 'compliance_status', label: 'Risk / compliance', description: 'Status', kind: 'health' },
  ],
  service_lead: [
    { kpi_id: 'due_status_rate', label: 'Due-status attainment', description: 'On-time service delivery', kind: 'leading' },
    { kpi_id: 'cost_per_unit', label: 'Cost per service unit', description: 'Vs budget', kind: 'lagging' },
    { kpi_id: 'cycle_time', label: 'Cycle / turnaround time', description: 'Speed', kind: 'leading' },
    { kpi_id: 'quality_rework', label: 'Error / rework / quality', description: 'Defect rates', kind: 'health' },
    { kpi_id: 'csat', label: 'Internal customer satisfaction', description: 'Feedback', kind: 'lagging' },
    { kpi_id: 'utilization', label: 'Team utilization / capacity', description: 'Load', kind: 'leading' },
    { kpi_id: 'automation_rate', label: 'Automation / process improvement', description: 'Rate of change', kind: 'leading' },
    { kpi_id: 'volume_backlog', label: 'Volume + backlog', description: 'Handled vs open', kind: 'leading' },
    { kpi_id: 'audit_findings', label: 'Compliance / audit findings', description: 'Open items', kind: 'health' },
    { kpi_id: 'efficiency_gains', label: 'Efficiency gains delivered', description: 'Improvements', kind: 'lagging' },
  ],
  counsel_ops: [
    { kpi_id: 'matter_volume', label: 'Matter / caseload volume', description: 'By type', kind: 'leading' },
    { kpi_id: 'legal_turnaround', label: 'Legal turnaround times', description: 'Speed', kind: 'leading' },
    { kpi_id: 'legal_spend', label: 'Legal spend vs budget', description: 'Activity cost', kind: 'lagging' },
    { kpi_id: 'legal_risk', label: 'Risk scores / open issues', description: 'High priority', kind: 'health' },
    { kpi_id: 'contract_review', label: 'Contract / deal review progress', description: 'Throughput', kind: 'leading' },
    { kpi_id: 'regulatory_status', label: 'Compliance / regulatory', description: 'Status', kind: 'health' },
    { kpi_id: 'client_sat', label: 'Internal client satisfaction', description: 'Feedback', kind: 'lagging' },
    { kpi_id: 'outside_counsel', label: 'Outside counsel spend', description: 'Performance', kind: 'lagging' },
    { kpi_id: 'ip_status', label: 'IP status', description: 'Where relevant', kind: 'health' },
    { kpi_id: 'dispute_trends', label: 'Litigation / dispute trends', description: 'Volume direction', kind: 'lagging' },
    { kpi_id: 'ops_cycle', label: 'Deal / fund process cycle times', description: 'Ops throughput', kind: 'leading' },
    { kpi_id: 'ops_cost', label: 'Ops cost vs budget', description: 'Structure', kind: 'lagging' },
  ],
  ssc_finance: [
    { kpi_id: 'close_ontime', label: 'Close on-time', description: 'Period close attainment', kind: 'leading' },
    { kpi_id: 'exception_volume', label: 'Open exceptions', description: 'Close / KPI exceptions', kind: 'health' },
    { kpi_id: 'kpi_pack_ready', label: 'KPI pack readiness', description: 'Subsidiary packs complete', kind: 'leading' },
    { kpi_id: 'dual_approve_queue', label: 'Dual-approve queue', description: 'Write-backs awaiting review', kind: 'leading' },
    { kpi_id: 'cash_visibility', label: 'Cash visibility', description: 'IES sync freshness', kind: 'lagging' },
  ],
  ssc_hr: [
    { kpi_id: 'roster_accuracy', label: 'Roster accuracy', description: 'Headcount vs systems', kind: 'health' },
    { kpi_id: 'jml_cycle', label: 'JML cycle time', description: 'Joiner / mover / leaver', kind: 'leading' },
    { kpi_id: 'onboarding_completion', label: 'Onboarding completion', description: 'Open vs complete', kind: 'leading' },
    { kpi_id: 'screening_sla', label: 'Screening SLA', description: 'Verified First turnaround', kind: 'leading' },
    { kpi_id: 'hr_ticket_backlog', label: 'HR ticket backlog', description: 'Open SSC tickets', kind: 'lagging' },
  ],
  ssc_legal: [
    { kpi_id: 'matter_volume', label: 'Matter / caseload volume', description: 'By type', kind: 'leading' },
    { kpi_id: 'legal_turnaround', label: 'Legal turnaround times', description: 'Speed', kind: 'leading' },
    { kpi_id: 'docusign_queue', label: 'DocuSign queue', description: 'Pending envelopes', kind: 'leading' },
    { kpi_id: 'legal_risk', label: 'Risk scores / open issues', description: 'High priority', kind: 'health' },
    { kpi_id: 'contract_review', label: 'Contract review progress', description: 'Throughput', kind: 'leading' },
  ],
  ssc_it: [
    { kpi_id: 'asset_coverage', label: 'Asset coverage', description: 'Devices enrolled', kind: 'health' },
    { kpi_id: 'intune_posture', label: 'Intune posture', description: 'Compliance drift', kind: 'health' },
    { kpi_id: 'license_utilization', label: 'License utilization', description: 'Assigned vs purchased', kind: 'lagging' },
    { kpi_id: 'provision_queue', label: 'Provisioning queue', description: 'Dual-approve pending', kind: 'leading' },
    { kpi_id: 'it_ticket_sla', label: 'IT ticket SLA', description: 'On-time resolution', kind: 'leading' },
  ],
  ssc_marketing: [
    { kpi_id: 'campaign_pipeline', label: 'Campaign pipeline', description: 'In flight vs planned', kind: 'leading' },
    { kpi_id: 'publish_queue', label: 'Publish queue', description: 'Approvals pending', kind: 'leading' },
    { kpi_id: 'brand_compliance', label: 'Brand compliance', description: 'Voice / asset flags', kind: 'health' },
    { kpi_id: 'revenue_attribution', label: 'Revenue attribution', description: 'Pipeline influenced', kind: 'lagging' },
    { kpi_id: 'mkt_ticket_sla', label: 'Marketing ticket SLA', description: 'On-time resolution', kind: 'leading' },
  ],
  /** Ops / platform Admin — not Visionary firm KPIs. */
  admin: [
    { kpi_id: 'active_users', label: 'Active users', description: 'Profiles with OS access', kind: 'health' },
    { kpi_id: 'ticket_backlog', label: 'Ticket backlog', description: 'Open · overdue · due soon', kind: 'leading' },
    { kpi_id: 'ticket_sla', label: 'Ticket SLA', description: 'On-time resolution', kind: 'leading' },
    { kpi_id: 'ssc_health', label: 'SSC health', description: 'Shared Services queue pressure', kind: 'health' },
    { kpi_id: 'doc_library', label: 'Document library', description: 'Active files indexed', kind: 'lagging' },
    { kpi_id: 'access_control', label: 'Access control', description: 'Roles in use · ACL coverage', kind: 'health' },
    { kpi_id: 'help_desk_load', label: 'Help Desk load', description: 'Open requester tickets', kind: 'leading' },
    { kpi_id: 'admin_queue', label: 'Admin queue', description: 'Users · roles · system health', kind: 'leading' },
  ],
};

export function catalogForRole(role: AppRole): RoleDashboardKpiDef[] {
  return CATALOG[role] ?? CATALOG.admin;
}

export function emptyCardsForRole(role: AppRole): RoleDashboardCard[] {
  return catalogForRole(role).map((def) => ({
    ...def,
    actual: null,
    goal: null,
    variance_label: 'Goal not set',
    on_track: null,
    data_state: 'not_connected' as const,
  }));
}
