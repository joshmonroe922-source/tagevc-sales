/**
 * Instant NDA SaaS reporting roles → KPI sets + report inventory.
 */

import type { IndaKpiId } from '@/lib/inda-saas/dictionary';

export type SaasReportRole =
  | 'vc_leadership'
  | 'partner'
  | 'coo_subsidiaries'
  | 'subsidiary_leader'
  | 'vp_sales_ops'
  | 'manager'
  | 'sales'
  | 'admin';

export const SAAS_REPORT_ROLE_LABELS: Record<SaasReportRole, string> = {
  vc_leadership: 'VC Leadership',
  partner: 'Partner',
  coo_subsidiaries: 'COO of Subsidiaries',
  subsidiary_leader: 'Subsidiary Leader',
  vp_sales_ops: 'VP Sales & Operations',
  manager: 'Manager',
  sales: 'Sales',
  admin: 'Admin',
};

/** Report inventory (dashboard sections / report pages). */
export const SAAS_REPORTS = [
  {
    id: 'executive_scorecard',
    name: 'Executive SaaS Scorecard',
    description: 'ARR/MRR, growth, retention, activation, billing risk.',
  },
  {
    id: 'mrr_bridge',
    name: 'MRR Movement Bridge',
    description: 'New, expansion, churned, and net new MRR.',
  },
  {
    id: 'acquisition_funnel',
    name: 'Acquisition Funnel (Web + App Stores)',
    description: 'Impressions, installs, signup conversion, channel mix.',
  },
  {
    id: 'activation_funnel',
    name: 'Activation Funnel',
    description: 'Signup → activated → time to first value.',
  },
  {
    id: 'trial_conversion',
    name: 'Trial Conversion Report',
    description: 'Trial starts and trial → paid conversion.',
  },
  {
    id: 'retention_cohort',
    name: 'Retention / Churn Cohort Report',
    description: 'Logo/revenue churn, cohorts, quick ratio.',
  },
  {
    id: 'billing_health',
    name: 'Billing Health / Past Due Report',
    description: 'Past due, recovery, upgrades, refunds.',
  },
  {
    id: 'product_usage',
    name: 'Product Usage Report',
    description: 'NDA volume, completion, platform mix, engagement.',
  },
  {
    id: 'sales_pipeline',
    name: 'Sales Pipeline Report',
    description: 'Leads, enterprise pipeline, sales-assisted wins.',
  },
  {
    id: 'support_quality',
    name: 'Support & Quality Report',
    description: 'Tickets, response times, store ratings, crashes.',
  },
  {
    id: 'goals_vs_actuals',
    name: 'Goals vs Actuals Scorecard',
    description: 'Goal attainment by role and period.',
  },
  {
    id: 'hot_work',
    name: 'Hot Work / Action Queue',
    description: 'Overdue, past due, stalled leads, open tickets.',
  },
] as const;

export type SaasReportId = (typeof SAAS_REPORTS)[number]['id'];

const ROLE_KPIS: Record<SaasReportRole, IndaKpiId[]> = {
  vc_leadership: [
    'arr',
    'mrr',
    'net_new_mrr',
    'nrr',
    'grr',
    'active_subscriptions',
    'trialing_accounts',
    'trial_to_paid',
    'signup_to_activated',
    'past_due',
    'installs_ios',
    'installs_android',
    'quick_ratio',
    'burn_contribution',
  ],
  partner: [
    'arr',
    'mrr',
    'nrr',
    'grr',
    'expansion_mrr',
    'churned_mrr',
    'signup_to_activated',
    'sales_assisted_pipeline',
    'cac',
    'payback_period',
    'gross_margin_proxy',
    'cohort_retention',
  ],
  coo_subsidiaries: [
    'mrr',
    'arr',
    'net_new_mrr',
    'logo_churn',
    'trial_to_paid',
    'signup_to_activated',
    'past_due',
    'tickets_opened',
    'ticket_rate_per_100',
    'revenue_per_fte',
    'support_cost_per_account',
    'active_accounts_30d',
  ],
  subsidiary_leader: [
    'mrr',
    'arr',
    'net_new_mrr',
    'trial_to_paid',
    'signup_to_activated',
    'time_to_first_value',
    'logo_churn',
    'revenue_churn',
    'past_due_recovery',
    'ndas_created',
    'ndas_signed',
    'active_subscriptions',
    'trialing_accounts',
    'past_due',
  ],
  vp_sales_ops: [
    'sales_assisted_pipeline',
    'channel_mix',
    'trial_starts',
    'trial_to_paid',
    'new_mrr',
    'expansion_mrr',
    'past_due',
    'past_due_recovery',
    'web_signup_conversion',
    'install_to_signup',
    'tickets_opened',
    'plan_mix',
  ],
  manager: [
    'ndas_created',
    'ndas_signed',
    'nda_completion_rate',
    'past_due',
    'past_due_recovery',
    'tickets_opened',
    'time_to_first_response',
    'time_to_resolve',
    'reactivations',
    'feature_adoption',
    'downgrade_rate',
  ],
  sales: [
    'sales_assisted_pipeline',
    'trial_starts',
    'trial_to_paid',
    'upgrade_rate',
    'new_mrr',
    'channel_mix',
  ],
  admin: [
    'tickets_opened',
    'tickets_resolved',
    'refund_rate',
    'crash_free_sessions',
    'past_due',
    'active_subscriptions',
  ],
};

const ROLE_REPORTS: Record<SaasReportRole, SaasReportId[]> = {
  vc_leadership: [
    'executive_scorecard',
    'mrr_bridge',
    'retention_cohort',
    'acquisition_funnel',
    'goals_vs_actuals',
  ],
  partner: [
    'executive_scorecard',
    'mrr_bridge',
    'retention_cohort',
    'sales_pipeline',
    'goals_vs_actuals',
  ],
  coo_subsidiaries: [
    'executive_scorecard',
    'billing_health',
    'support_quality',
    'hot_work',
    'goals_vs_actuals',
  ],
  subsidiary_leader: [
    'executive_scorecard',
    'mrr_bridge',
    'trial_conversion',
    'activation_funnel',
    'product_usage',
    'billing_health',
    'hot_work',
    'goals_vs_actuals',
  ],
  vp_sales_ops: [
    'sales_pipeline',
    'trial_conversion',
    'acquisition_funnel',
    'billing_health',
    'hot_work',
    'goals_vs_actuals',
  ],
  manager: [
    'product_usage',
    'billing_health',
    'support_quality',
    'hot_work',
    'goals_vs_actuals',
  ],
  sales: ['sales_pipeline', 'trial_conversion', 'hot_work', 'goals_vs_actuals'],
  admin: ['support_quality', 'billing_health', 'hot_work', 'goals_vs_actuals'],
};

const REPORT_KPIS: Record<SaasReportId, IndaKpiId[]> = {
  executive_scorecard: [
    'mrr',
    'arr',
    'net_new_mrr',
    'nrr',
    'grr',
    'active_subscriptions',
    'trialing_accounts',
    'trial_to_paid',
    'past_due',
    'ndas_signed',
  ],
  mrr_bridge: ['new_mrr', 'expansion_mrr', 'churned_mrr', 'net_new_mrr', 'mrr'],
  acquisition_funnel: [
    'ios_impressions',
    'android_impressions',
    'installs_ios',
    'installs_android',
    'install_to_signup',
    'web_signup_conversion',
    'channel_mix',
  ],
  activation_funnel: [
    'signup_to_activated',
    'time_to_first_value',
    'ndas_created',
    'ndas_signed',
  ],
  trial_conversion: ['trial_starts', 'trial_to_paid', 'trialing_accounts'],
  retention_cohort: [
    'logo_churn',
    'revenue_churn',
    'cohort_retention',
    'quick_ratio',
    'nrr',
    'grr',
  ],
  billing_health: [
    'past_due',
    'past_due_recovery',
    'upgrade_rate',
    'downgrade_rate',
    'refund_rate',
    'active_subscriptions',
  ],
  product_usage: [
    'dau',
    'wau',
    'mau',
    'stickiness',
    'ndas_created',
    'ndas_signed',
    'nda_completion_rate',
    'platform_mix',
    'active_accounts_7d',
    'active_accounts_30d',
  ],
  sales_pipeline: [
    'sales_assisted_pipeline',
    'channel_mix',
    'trial_starts',
    'new_mrr',
  ],
  support_quality: [
    'tickets_opened',
    'tickets_resolved',
    'time_to_first_response',
    'time_to_resolve',
    'ticket_rate_per_100',
    'csat_nps',
    'app_store_rating',
    'crash_free_sessions',
  ],
  goals_vs_actuals: [
    'mrr',
    'arr',
    'trial_to_paid',
    'ndas_signed',
    'past_due',
    'nrr',
  ],
  hot_work: [
    'past_due',
    'tickets_opened',
    'sales_assisted_pipeline',
    'trialing_accounts',
  ],
};

export function kpisForRole(role: SaasReportRole): IndaKpiId[] {
  return ROLE_KPIS[role];
}

export function reportsForRole(role: SaasReportRole): SaasReportId[] {
  return ROLE_REPORTS[role];
}

export function kpisForReport(reportId: SaasReportId): IndaKpiId[] {
  return REPORT_KPIS[reportId];
}

/**
 * Map Instant NDA app roles / view-as personas onto SaaS report roles.
 * Parent Tage roles map to VC / Partner / COO views.
 */
export function resolveSaasReportRole(input: {
  appRole?: string | null;
  viewAs?: string | null;
  realRole?: string | null;
}): SaasReportRole {
  const real = (input.realRole ?? '').toLowerCase();
  const view = (input.viewAs ?? '').toLowerCase();
  const app = (input.appRole ?? '').toLowerCase();

  // Explicit parent roles when operating from Tage context
  if (real === 'visionary' || app === 'visionary') return 'vc_leadership';
  if (real === 'partner' || app === 'partner') return 'partner';
  if (real === 'coo' || app === 'coo') return 'coo_subsidiaries';

  if (view === 'admin' || app === 'admin') return 'admin';
  if (view === 'sales') return 'sales';
  if (view === 'success' || view === 'vp_sales_ops') return 'vp_sales_ops';
  if (view === 'support' || view === 'manager') return 'manager';
  if (view === 'leadership' || app === 'sub_lead') return 'subsidiary_leader';
  if (app === 'service_lead') return 'vp_sales_ops';

  // Default Instant NDA operator view
  return 'subsidiary_leader';
}
