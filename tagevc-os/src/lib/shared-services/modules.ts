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
      'JWT send + Connect webhook · events in os_docusign_events · capital gates.',
    docs: 'docs/OS_DOCUSIGN.md',
  },
  {
    id: 'it_assets',
    href: '/shared-services/it/assets',
    title: 'Hardware, software & licensing',
    service: 'IT',
    status: 'live',
    description:
      'CRUD assets/licenses · assign/return · seat grant/revoke · history.',
    docs: 'docs/OS_IT_ASSETS.md',
  },
  {
    id: 'marketing',
    href: '/shared-services/marketing',
    title: 'Multichannel Marketing',
    service: 'Marketing',
    status: 'foundation',
    description:
      'Campaigns, content, social accounts, AI + schedule frameworks for firm and subsidiaries.',
    docs: 'docs/OS_MARKETING.md',
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
