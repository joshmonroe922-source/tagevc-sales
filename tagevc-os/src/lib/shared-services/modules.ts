/**
 * Shared Services hub module catalog.
 * Ticketing + DocuSign + IT assets are live surfaces (Phase 21).
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
];
