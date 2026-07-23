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
    title: 'Finance control plane',
    service: 'Finance',
    status: 'live',
    description:
      'IES orchestration · KPI panels, close checklists, anomaly alerts, dual-approve write-backs.',
    docs: 'docs/OS_PHASE55.md',
  },
  {
    id: 'hr',
    href: '/shared-services/hr',
    title: 'HR operations',
    service: 'HR',
    status: 'live',
    description:
      'Onboarding/offboarding completeness · revocation evidence · exception aging (Phase 57).',
    docs: 'docs/OS_PHASE57.md',
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
