/**
 * Shared Services hub module catalog.
 * Function homes vs center ops kept separate for clearer UX.
 */

export type SsHubModule = {
  id: string;
  href: string;
  title: string;
  service: 'Legal' | 'IT' | 'Finance' | 'HR' | 'Marketing' | 'All';
  status: 'live' | 'planned' | 'foundation';
  description: string;
  docs?: string;
  /** Short label for compact nav chips. */
  short?: string;
};

/** Per-function operating homes (existing modules). */
export const SS_FUNCTION_MODULES: SsHubModule[] = [
  {
    id: 'tage_vc_af',
    href: '/shared-services/af',
    title: 'Tage VC A&F',
    short: 'A&F',
    service: 'Finance',
    status: 'live',
    description:
      'Accounting · Finance · Audit · Controls. Canonical A&F (replaces legacy Shared Services → Finance).',
    docs: 'docs/TAGE_VC_AF.md',
  },
  // Legacy `/shared-services/finance` removed from hub — redirects to A&F Finance.
  {
    id: 'hr',
    href: '/shared-services/hr',
    title: 'Human Resources',
    short: 'HR',
    service: 'HR',
    status: 'live',
    description:
      'Roster · joiner/mover/leaver · onboarding/offboarding · access readiness.',
    docs: 'docs/OS_PHASE57.md',
  },
  {
    id: 'it_assets',
    href: '/shared-services/it/assets',
    title: 'Technology',
    short: 'Technology',
    service: 'IT',
    status: 'live',
    description:
      'Assets · licenses · Intune posture · provisioning dual-approve.',
    docs: 'docs/OS_PHASE57.md',
  },
  {
    id: 'partner_stack',
    href: '/shared-services/it/technology',
    title: 'Partner stack',
    short: 'Partners',
    service: 'IT',
    status: 'foundation',
    description:
      'Spine vendors · contracts · payments · expirations · entity enablement.',
    docs: 'docs/PARTNER_SPINE.md',
  },
  {
    id: 'marketing',
    href: '/shared-services/marketing',
    title: 'Marketing',
    short: 'Marketing',
    service: 'Marketing',
    status: 'live',
    description:
      'Campaigns · approvals · publishing · brand voice · revenue rails.',
    docs: 'docs/OS_PHASE58.md',
  },
  {
    id: 'marketing_presence',
    href: '/shared-services/marketing/presence',
    title: 'Marketing presence',
    short: 'Presence',
    service: 'Marketing',
    status: 'foundation',
    description:
      'Google Business · GA4 · LinkedIn Company Pages per entity.',
    docs: 'docs/PARTNER_SPINE.md',
  },
  {
    id: 'partner_bi',
    href: '/shared-services/bi',
    title: 'Partner BI',
    short: 'BI',
    service: 'All',
    status: 'foundation',
    description:
      'AI Business Intelligence shell across partner systems + unified DB.',
    docs: 'docs/PARTNER_SPINE.md',
  },
  {
    id: 'legal',
    href: '/shared-services/legal',
    title: 'Legal / Counsel',
    short: 'Legal',
    service: 'Legal',
    status: 'live',
    description:
      'Matters · period tasks · counsel ops (DocuSign under Admin).',
    docs: 'docs/OS_PHASE56.md',
  },
  {
    id: 'docusign',
    href: '/shared-services/legal/docusign',
    title: 'DocuSign',
    short: 'DocuSign',
    service: 'Legal',
    status: 'live',
    description:
      'Phase 56 · capital dual-control · template governance · archive integrity (Admin).',
    docs: 'docs/OS_PHASE56.md',
  },
];

/** Cross-function SSC command surfaces. */
export const SS_CENTER_OPS_MODULES: SsHubModule[] = [
  {
    id: 'checklists',
    href: '/shared-services/checklists',
    title: 'Period checklists',
    short: 'Checklists',
    service: 'All',
    status: 'live',
    description:
      'Weekly → annual cadence · scope · time nav · checkoff · AI briefing.',
  },
  {
    id: 'audits',
    href: '/shared-services/audits',
    title: 'Startup & annual audits',
    short: 'Audits',
    service: 'All',
    status: 'live',
    description:
      'Per-company startup readiness and annual compliance across all functions.',
  },
];

/** @deprecated Prefer SS_FUNCTION_MODULES + SS_CENTER_OPS_MODULES */
export const SS_HUB_MODULES: SsHubModule[] = [
  {
    id: 'tickets',
    href: '/shared-services',
    title: 'Tickets & autonomy',
    service: 'All',
    status: 'live',
    description:
      'Intake → Diagnose → Act → Resolve · allow/forbid lists and band queue.',
  },
  ...SS_FUNCTION_MODULES,
  ...SS_CENTER_OPS_MODULES,
];

/** Modules shown as navigable cards on the hub (exclude self-link tickets). */
export function getSsHubCardModules(): SsHubModule[] {
  return [...SS_FUNCTION_MODULES, ...SS_CENTER_OPS_MODULES];
}

export function getSsFunctionModules(): SsHubModule[] {
  return SS_FUNCTION_MODULES;
}

export function getSsCenterOpsModules(): SsHubModule[] {
  return SS_CENTER_OPS_MODULES;
}

export function ssHubStatusLabel(
  status: SsHubModule['status'],
): string {
  if (status === 'live') return 'Live';
  if (status === 'foundation') return 'Foundation';
  return 'Planned';
}
