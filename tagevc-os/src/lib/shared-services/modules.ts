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
    id: 'finance',
    href: '/shared-services/finance',
    title: 'Accounting & Finance',
    short: 'Finance',
    service: 'Finance',
    status: 'live',
    description:
      'KPI pack · close checklists · exceptions · dual-approve write-backs (IES is system of record).',
    docs: 'docs/OS_PHASE55.md',
  },
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
    title: 'Technology / IT',
    short: 'IT',
    service: 'IT',
    status: 'live',
    description:
      'Assets · licenses · Intune posture · provisioning dual-approve.',
    docs: 'docs/OS_PHASE57.md',
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
    id: 'docusign',
    href: '/shared-services/legal/docusign',
    title: 'Legal / Counsel',
    short: 'Legal',
    service: 'Legal',
    status: 'live',
    description:
      'DocuSign · capital dual-control · template governance · archive integrity.',
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
