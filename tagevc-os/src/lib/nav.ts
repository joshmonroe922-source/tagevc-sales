import type { NavModule } from '@/lib/types/roles';

export type NavItem = {
  module: NavModule;
  href?: string;
  label: string;
  description?: string;
  children?: NavItem[];
  /** When true, only shown when realRole is Visionary (not effective/impersonated). */
  visionaryOnly?: boolean;
};

/**
 * Home → Dashboard → modules → Help Desk.
 * Think Tank lives on Home (no standalone nav item).
 */
export const MAIN_NAV: NavItem[] = [
  {
    module: 'command_center',
    href: '/home',
    label: 'Home',
    description: 'AI briefing + Think Tank',
  },
  {
    module: 'portfolio',
    href: '/dashboard',
    label: 'Dashboard',
    description: 'Your KPIs at a glance',
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
    href: '/entities',
    label: 'Portfolio',
    description: 'Companies and performance',
  },
  {
    module: 'command_center',
    href: '/command-center',
    label: 'Command Center',
    description: 'Firm health at a glance',
  },
  {
    module: 'shared_services',
    href: '/shared-services',
    label: 'Shared Services',
    description: 'Service inbox · finance · HR',
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
    module: 'shared_services',
    href: '/help-desk',
    label: 'Help Desk',
    description: 'Your tickets · create request',
  },
  {
    module: 'admin',
    href: '/admin',
    label: 'Admin',
    description: 'Users · roles · settings',
  },
  {
    module: 'admin',
    href: '/admin/audit',
    label: 'Audit log',
    description: 'Visionary-only activity trail',
    visionaryOnly: true,
  },
];

export function flattenNavItems(items: NavItem[] = MAIN_NAV): NavItem[] {
  const out: NavItem[] = [];
  for (const item of items) {
    if (item.href) out.push(item);
    if (item.children?.length) out.push(...flattenNavItems(item.children));
  }
  return out;
}
