/**
 * Shared Services hub module catalog (Phase 22).
 */

export type SsHubModule = {
  id: string;
  href: string;
  title: string;
  service: 'Legal' | 'IT' | 'Finance' | 'HR' | 'Marketing' | 'All';
  status: 'live' | 'planned' | 'foundation';
  description: string;
  docs?: string;
};

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
  {
    id: 'docusign',
    href: '/shared-services/legal/docusign',
    title: 'DocuSign integration',
    service: 'Legal',
    status: 'live',
    description:
      'JWT send + Connect · capital dual-control · template governance · archive integrity (Phase 56).',
    docs: 'docs/OS_PHASE56.md',
  },
  {
    id: 'it_assets',
    href: '/shared-services/it/assets',
    title: 'Hardware, software & licensing',
    service: 'IT',
    status: 'live',
    description:
      'Assets/licenses · onboarding/offboarding completeness · dual-approve inbox aging (Phase 57).',
    docs: 'docs/OS_PHASE57.md',
  },
  {
    id: 'marketing',
    href: '/shared-services/marketing',
    title: 'Multichannel Marketing',
    service: 'Marketing',
    status: 'live',
    description:
      'Campaigns + revenue rails · approval SLA · publishing controls · brand-voice · Recruit acquisition (Phase 58).',
    docs: 'docs/OS_PHASE58.md',
  },
  {
    id: 'finance',
    href: '/shared-services/finance',
    title: 'Finance & Accounting',
    service: 'Finance',
    status: 'live',
    description:
      'KPI pack · close checklists · company visibility · exceptions · dual-approve write-backs (IES stays system of record).',
    docs: 'docs/OS_PHASE55.md',
  },
  {
    id: 'hr',
    href: '/shared-services/hr',
    title: 'HR operations',
    service: 'HR',
    status: 'live',
    description:
      'People roster · joiner/mover/leaver · onboarding/offboarding · access readiness · service requests.',
    docs: 'docs/OS_PHASE57.md',
  },
  {
    id: 'checklists',
    href: '/shared-services/checklists',
    title: 'SSC period checklists',
    service: 'All',
    status: 'live',
    description:
      'Weekly → annual cadence · scope toggles · task checkoff · evidence · AI briefing (Phase 66).',
  },
  {
    id: 'audits',
    href: '/shared-services/audits',
    title: 'Startup & annual audits',
    service: 'All',
    status: 'live',
    description:
      'Per-company startup readiness + annual compliance audits across all SSC functions.',
  },
];

/** Modules shown as navigable cards on the hub (exclude self-link tickets). */
export function getSsHubCardModules(): SsHubModule[] {
  return SS_HUB_MODULES.filter((m) => m.id !== 'tickets');
}

export function ssHubStatusLabel(
  status: SsHubModule['status'],
): string {
  if (status === 'live') return 'Live';
  if (status === 'foundation') return 'Foundation';
  return 'Planned';
}
