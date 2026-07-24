import type { NavModule } from '@/lib/types/roles';

export type NavItem = {
  module: NavModule;
  /** Omit href for group headers that only contain children. */
  href?: string;
  label: string;
  description?: string;
  children?: NavItem[];
};

/**
 * Left-nav information architecture (executive-facing labels).
 * Internal routes are unchanged; VC / M&A / RE live under Deal Flow only.
 */
export const MAIN_NAV: NavItem[] = [
  {
    module: 'command_center',
    href: '/command-center',
    label: 'Command Center',
    description: 'Firm health at a glance',
  },
  {
    module: 'command_center',
    href: '/think-tank',
    label: 'Think Tank',
    description: 'Personal Grok operating advisor',
  },
  {
    module: 'firm',
    href: '/firm',
    label: 'Firm',
    description: 'Capital · governance · rhythm',
  },
  {
    module: 'deal_flow_vc',
    label: 'Business Development',
    description: 'Leads and deal pipelines',
    children: [
      {
        module: 'deal_flow_vc',
        href: '/deal-flow/vc/intake',
        label: 'Lead Intake',
        description: 'Incoming opportunities',
      },
      {
        module: 'deal_flow_vc',
        href: '/deal-flow',
        label: 'Deal Flow',
        description: 'VC · M&A · Real Estate',
      },
    ],
  },
  {
    module: 'portfolio',
    href: '/portfolio',
    label: 'Dashboard',
    description: 'Company health overview',
  },
  {
    module: 'portfolio',
    href: '/entities',
    label: 'Entities',
    description: 'Companies and performance',
  },
  {
    module: 'shared_services',
    href: '/shared-services',
    label: 'Shared Services',
    description: 'Tickets · SLAs · service work',
  },
  {
    module: 'documents',
    href: '/documents',
    label: 'Document Library',
    description: 'Files · DocuSign',
  },
  {
    module: 'messages',
    href: '/messages',
    label: 'Message Center',
    description: 'Direct messages · groups',
  },
  {
    module: 'command_center',
    href: '/activity',
    label: 'Activity',
    description: 'Recent firm actions',
  },
  {
    module: 'admin',
    href: '/admin',
    label: 'Admin',
    description: 'Users · roles · settings',
  },
];

/** Flat list of navigable hrefs (for tests / active-path helpers). */
export function flattenNavItems(items: NavItem[] = MAIN_NAV): NavItem[] {
  const out: NavItem[] = [];
  for (const item of items) {
    if (item.href) out.push(item);
    if (item.children?.length) out.push(...flattenNavItems(item.children));
  }
  return out;
}
