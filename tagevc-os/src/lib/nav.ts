import type { NavModule } from '@/lib/types/roles';

export type NavItem = {
  module: NavModule;
  href: string;
  label: string;
  description?: string;
};

export const MAIN_NAV: NavItem[] = [
  {
    module: 'command_center',
    href: '/command-center',
    label: 'Command Center',
    description: 'Firm funnel · capital · portfolio pulse',
  },
  {
    module: 'command_center',
    href: '/activity',
    label: 'Activity',
    description: 'Recent firm actions',
  },
  {
    module: 'deal_flow_vc',
    href: '/deal-flow',
    label: 'Deal Flow',
    description: 'VC · M&A · RE hub',
  },
  {
    module: 'deal_flow_vc',
    href: '/deal-flow/vc',
    label: 'Deal Flow · VC',
    description: 'Pipeline · IC · deal desk',
  },
  {
    module: 'deal_flow_ma',
    href: '/deal-flow/ma',
    label: 'Deal Flow · M&A',
    description: 'Targets · LOI · integration',
  },
  {
    module: 'deal_flow_re',
    href: '/deal-flow/re',
    label: 'Deal Flow · RE',
    description: 'Resi / CRE pipeline',
  },
  {
    module: 'portfolio',
    href: '/portfolio',
    label: 'Portfolio',
    description: 'Active · handoff · roll-up',
  },
  {
    module: 'portfolio',
    href: '/entities',
    label: 'Entities',
    description: 'Subsidiary OS · CORE / FLEX',
  },
  {
    module: 'deal_flow_vc',
    href: '/deal-flow/vc/intake',
    label: 'Lead Intake',
    description: 'Inbound → Pipeline',
  },
  {
    module: 'shared_services',
    href: '/shared-services',
    label: 'Shared Services',
    description: 'Tickets · SLAs · audits',
  },
  {
    module: 'firm',
    href: '/firm',
    label: 'Firm',
    description: 'Capital · governance · rhythm',
  },
  {
    module: 'documents',
    href: '/documents',
    label: 'Documents',
    description: 'Library · DocuSign',
  },
  {
    module: 'admin',
    href: '/admin',
    label: 'Admin',
    description: 'Users · roles · enums',
  },
];
