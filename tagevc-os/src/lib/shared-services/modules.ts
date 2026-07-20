/**
 * Shared Services hub module catalog (Phase 20 scaffolding).
 * Ticketing remains the live surface; Legal/IT cards point at architecture stubs.
 */

export type SsHubModule = {
  id: string;
  href: string;
  title: string;
  service: 'Legal' | 'IT' | 'Finance' | 'HR' | 'Marketing' | 'All';
  status: 'live' | 'planned';
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
    status: 'planned',
    description:
      'Real Connect + envelopes for Documents · capital gates preserved.',
    docs: 'docs/OS_DOCUSIGN.md',
  },
  {
    id: 'it_assets',
    href: '/shared-services/it/assets',
    title: 'Hardware, software & licensing',
    service: 'IT',
    status: 'planned',
    description:
      'Asset assignment, SaaS licenses, onboarding/offboarding hooks.',
    docs: 'docs/OS_IT_ASSETS.md',
  },
];
