import { buildAfNavBranch } from '@/lib/platform/af/nav';
import {
  SSC_OPERATOR_ROLES,
  sscRolesHiddenFromFunction,
} from '@/lib/rbac/ssc-roles';
import type { AppRole, NavModule, Permission } from '@/lib/types/roles';

/** Canonical A&F spine (Accounting · Finance · Audit · Controls). */
const TAGE_VC_AF_NAV = buildAfNavBranch('Tage VC');


export type NavItem = {
  module: NavModule;
  href?: string;
  label: string;
  description?: string;
  children?: NavItem[];
  /**
   * When true, only shown when *effective* role is Visionary or Think Tank
   * (Role Switcher / Live Look hide these for other personas).
   */
  visionaryOnly?: boolean;
  /**
   * When true, only shown when *effective* role is Visionary (Josh).
   * Excludes Think Tank / Lauren — use for Personal ▼ and children.
   */
  visionaryExclusive?: boolean;
  /** Hide while Live Look is active (private capital / personal credit). */
  hideDuringLiveLook?: boolean;
  /** Extra permission gate beyond module access (e.g. IT / Marketing). */
  requiredPermission?: Permission;
  /**
   * Hide for these *effective* roles (impersonation / Live Look aware).
   * COO + Admin + SSC operator gates for Command Center / Firm / BD / Assets.
   */
  hiddenForRoles?: readonly AppRole[];
};

/** Firm-wide surfaces SSC operators should not see. */
const HIDE_FOR_SSC = SSC_OPERATOR_ROLES;

/** Firm-wide surfaces Admin should not see (ops desk, not Visionary firm IA). */
const HIDE_FOR_ADMIN = ['admin'] as const satisfies readonly AppRole[];

/** SSC function desks — Admin uses Docs / Ticket Portal / Admin instead. */
const HIDE_SSC_FUNCTIONS_FOR_ADMIN = HIDE_FOR_ADMIN;

/**
 * Home → Dashboard → Assets → C-Suite → To Do List → Firm → BD → Command Center → modules.
 * Assets stays under Home (not under Dashboard) — Portfolio→Assets rename + later IA.
 * Firm + Command Center are top-level (not nested under BD / C-Suite).
 * BD stays top-level (not under Assets) so associate / sourcer / sub_lead role transforms keep working.
 * To Do List aggregates SSC checklists + lead/deal follow-ups (not Help Desk tickets).
 * Shared Services holds Tage VC A&F + function homes + Ticket Portal + Admin.
 * Help Desk lives on the Create Ticket split-button dropdown (not left nav).
 * Admin accordion nests Document Library + DocuSign (routes unchanged).
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
    /** SSC operators skip Dashboard; Admin lands here for ops KPIs. */
    hiddenForRoles: HIDE_FOR_SSC,
  },
  {
    module: 'portfolio',
    label: 'Assets',
    description: 'Net Worth · Businesses · Real Estate · Investments',
    /** SSC + Admin + associates: not firm-wide portfolio companies. */
    hiddenForRoles: [
      'associate',
      'ma_associate',
      're_sourcer',
      ...HIDE_FOR_ADMIN,
      ...HIDE_FOR_SSC,
    ],
    children: [
      {
        module: 'portfolio',
        href: '/portfolio/net-worth',
        label: 'Net Worth',
        description: 'Company roll-up · businesses · RE · investments',
        visionaryOnly: true,
        hideDuringLiveLook: true,
      },
      {
        module: 'portfolio',
        href: '/entities',
        label: 'Businesses',
        description: 'Operating companies you lead',
      },
      {
        module: 'portfolio',
        href: '/portfolio/real-estate',
        label: 'Real Estate',
        description: 'RE assets you lead',
      },
      {
        module: 'portfolio',
        href: '/portfolio/investments',
        label: 'Investments',
        description: 'Retirement · stocks · crypto',
        visionaryOnly: true,
        hideDuringLiveLook: true,
      },
    ],
  },
  {
    module: 'command_center',
    label: 'C-Suite',
    description: 'AI executive intelligence',
    visionaryOnly: true,
    hideDuringLiveLook: true,
    hiddenForRoles: [
      'associate',
      'sub_lead',
      'ma_associate',
      're_sourcer',
      ...HIDE_FOR_ADMIN,
      ...HIDE_FOR_SSC,
    ],
    children: [
      {
        module: 'command_center',
        href: '/c-suite',
        label: 'HQ',
        description: 'Firm executive brief',
        visionaryOnly: true,
        hideDuringLiveLook: true,
        hiddenForRoles: [
          'associate',
          'sub_lead',
          'ma_associate',
          're_sourcer',
          ...HIDE_FOR_ADMIN,
          ...HIDE_FOR_SSC,
        ],
      },
      {
        module: 'command_center',
        href: '/c-suite/cfo',
        label: 'CFO',
        description: 'Cash · close · runway',
        visionaryOnly: true,
        hideDuringLiveLook: true,
        hiddenForRoles: [
          'associate',
          'sub_lead',
          'ma_associate',
          're_sourcer',
          ...HIDE_FOR_ADMIN,
          ...HIDE_FOR_SSC,
        ],
      },
      {
        module: 'command_center',
        href: '/c-suite/cto',
        label: 'CTO',
        description: 'Security · assets · uptime',
        visionaryOnly: true,
        hideDuringLiveLook: true,
        hiddenForRoles: [
          'associate',
          'sub_lead',
          'ma_associate',
          're_sourcer',
          ...HIDE_FOR_ADMIN,
          ...HIDE_FOR_SSC,
        ],
      },
      {
        module: 'command_center',
        href: '/c-suite/cmo',
        label: 'CMO',
        description: 'Pipeline · campaigns · ROI',
        visionaryOnly: true,
        hideDuringLiveLook: true,
        hiddenForRoles: [
          'associate',
          'sub_lead',
          'ma_associate',
          're_sourcer',
          ...HIDE_FOR_ADMIN,
          ...HIDE_FOR_SSC,
        ],
      },
      {
        module: 'command_center',
        href: '/c-suite/chro',
        label: 'CHRO',
        description: 'Headcount · JML · compliance',
        visionaryOnly: true,
        hideDuringLiveLook: true,
        hiddenForRoles: [
          'associate',
          'sub_lead',
          'ma_associate',
          're_sourcer',
          ...HIDE_FOR_ADMIN,
          ...HIDE_FOR_SSC,
        ],
      },
      {
        module: 'command_center',
        href: '/c-suite/clo',
        label: 'CLO',
        description: 'Matters · DocuSign · risk',
        visionaryOnly: true,
        hideDuringLiveLook: true,
        hiddenForRoles: [
          'associate',
          'sub_lead',
          'ma_associate',
          're_sourcer',
          ...HIDE_FOR_ADMIN,
          ...HIDE_FOR_SSC,
        ],
      },
    ],
  },
  {
    module: 'command_center',
    href: '/to-do',
    label: 'To Do List',
    description: 'SSC tasks · follow-ups · operator work',
  },
  {
    module: 'firm',
    href: '/firm',
    label: 'Firm',
    description: 'Capital · governance · rhythm',
    hiddenForRoles: [
      'coo',
      'associate',
      'ma_associate',
      're_sourcer',
      ...HIDE_FOR_ADMIN,
      ...HIDE_FOR_SSC,
    ],
  },
  {
    module: 'deal_flow_vc',
    label: 'Business Development',
    description: 'Leads and deal pipelines',
    hiddenForRoles: ['coo', ...HIDE_FOR_ADMIN, ...HIDE_FOR_SSC],
    children: [
      {
        module: 'deal_flow_vc',
        href: '/deal-flow/vc/intake',
        label: 'Lead Intake',
        description: 'Incoming opportunities',
        /** Associate / VC Sourcer: BD collapses to VC + M&A sourcing portals. */
        hiddenForRoles: [
          'coo',
          'associate',
          'ma_associate',
          're_sourcer',
          ...HIDE_FOR_ADMIN,
          ...HIDE_FOR_SSC,
        ],
      },
      {
        module: 'deal_flow_vc',
        href: '/deal-flow',
        label: 'Deal Flow',
        description: 'VC · M&A · Real Estate',
        hiddenForRoles: [
          'coo',
          'associate',
          'ma_associate',
          're_sourcer',
          ...HIDE_FOR_ADMIN,
          ...HIDE_FOR_SSC,
        ],
      },
      /**
       * VC / M&A / RE sourcing links are not default BD children (Visionary /
       * Think Tank / Partner see Lead Intake + Deal Flow only). Associate,
       * M&A Associate, and Sourcer get those surfaces via role transforms in
       * `applyRoleNavTransforms`.
       */
    ],
  },
  {
    module: 'command_center',
    href: '/command-center',
    label: 'Command Center',
    description: 'Firm health at a glance',
    hiddenForRoles: [
      'coo',
      'associate',
      'sub_lead',
      'ma_associate',
      're_sourcer',
      ...HIDE_FOR_ADMIN,
      ...HIDE_FOR_SSC,
    ],
  },
  {
    module: 'portfolio',
    label: 'Personal',
    description: 'Personal Finance · Credit Management (Josh / Visionary only)',
    visionaryOnly: true,
    visionaryExclusive: true,
    hideDuringLiveLook: true,
    hiddenForRoles: [
      'think_tank',
      'associate',
      'ma_associate',
      're_sourcer',
      'sub_lead',
      ...HIDE_FOR_ADMIN,
      ...HIDE_FOR_SSC,
    ],
    children: [
      {
        module: 'portfolio',
        href: '/personal/finance',
        label: 'Personal Finance',
        description: 'Books · cards · family · net worth',
        visionaryOnly: true,
        visionaryExclusive: true,
        hideDuringLiveLook: true,
        hiddenForRoles: ['think_tank'],
      },
      {
        module: 'portfolio',
        href: '/personal/credit',
        label: 'Credit Management',
        description: 'Personal + business bureau · FICO · disputes',
        visionaryOnly: true,
        visionaryExclusive: true,
        hideDuringLiveLook: true,
        hiddenForRoles: ['think_tank'],
      },
    ],
  },
  {
    module: 'shared_services',
    label: 'Shared Services',
    description: 'Tage VC A&F · Human Resources · Technology · Marketing · Legal · Admin',
    children: [
      {
        module: 'shared_services',
        href: TAGE_VC_AF_NAV.href,
        label: TAGE_VC_AF_NAV.label,
        description: TAGE_VC_AF_NAV.description,
        hiddenForRoles: [
          ...sscRolesHiddenFromFunction('Finance'),
          ...HIDE_SSC_FUNCTIONS_FOR_ADMIN,
        ],
        children: TAGE_VC_AF_NAV.children.map((child) => ({
          module: 'shared_services' as const,
          href: child.href,
          label: child.label,
          description: child.description,
          hiddenForRoles: [
            ...sscRolesHiddenFromFunction('Finance'),
            ...HIDE_SSC_FUNCTIONS_FOR_ADMIN,
          ],
        })),
      },
      // Legacy Shared Services → Finance (/shared-services/finance) sunsets;
      // use Tage VC A&F → Finance. Old route redirects.
      {
        module: 'shared_services',
        href: '/shared-services/hr',
        label: 'Human Resources',
        description: 'Roster · JML · onboarding · screening',
        hiddenForRoles: [
          ...sscRolesHiddenFromFunction('HR'),
          ...HIDE_SSC_FUNCTIONS_FOR_ADMIN,
        ],
        children: [
          {
            module: 'shared_services',
            href: '/eos',
            label: 'Performance Management',
            description: 'Traction EOS · rocks · scorecard · IDS · L10',
            hiddenForRoles: [
              ...sscRolesHiddenFromFunction('HR'),
              ...HIDE_SSC_FUNCTIONS_FOR_ADMIN,
            ],
          },
          {
            module: 'shared_services',
            href: '/shared-services/hr/screening',
            label: 'Screening',
            description: 'Verified First packages · orders',
            hiddenForRoles: [
              ...sscRolesHiddenFromFunction('HR'),
              ...HIDE_SSC_FUNCTIONS_FOR_ADMIN,
            ],
          },
        ],
      },
      {
        module: 'shared_services',
        href: '/shared-services/it/assets',
        label: 'Technology',
        description:
          'Assets · Vendor Management · Intune · partner stack · mobile launch',
        requiredPermission: 'read:it_assets',
        hiddenForRoles: [
          ...sscRolesHiddenFromFunction('IT'),
          ...HIDE_SSC_FUNCTIONS_FOR_ADMIN,
        ],
        children: [
          {
            module: 'shared_services',
            href: '/shared-services/it/vendor-mgmt',
            label: 'Vendor Management',
            description: 'Spend · renewals · licenses · people economics',
            requiredPermission: 'read:it_assets',
          },
          {
            module: 'shared_services',
            href: '/shared-services/it/technology-stack',
            label: 'Partner stack',
            description: 'Platform partners · contracts · payments · expirations',
            requiredPermission: 'read:it_assets',
          },
          {
            module: 'shared_services',
            href: '/shared-services/it/mobile-launch',
            label: 'Mobile launch',
            description:
              'App Store + Play playbook · EAS · Stripe · auth email',
            requiredPermission: 'read:it_assets',
          },
          {
            module: 'shared_services',
            href: '/shared-services/it/activity',
            label: 'Activity log',
            description: 'Operational IT activity trail',
            requiredPermission: 'read:it_assets',
          },
          {
            module: 'admin',
            href: '/admin/audit',
            label: 'Audit log',
            description: 'Visionary-only full OS audit',
            visionaryOnly: true,
          },
        ],
      },
      {
        module: 'shared_services',
        href: '/shared-services/marketing',
        label: 'Marketing',
        description: 'Campaigns · brand · presence · revenue',
        requiredPermission: 'read:marketing',
        hiddenForRoles: [
          ...sscRolesHiddenFromFunction('Marketing'),
          ...HIDE_SSC_FUNCTIONS_FOR_ADMIN,
        ],
        children: [
          {
            module: 'shared_services',
            href: '/shared-services/marketing/presence',
            label: 'Presence',
            description: 'Google Business · GA4 · LinkedIn Company Pages',
            requiredPermission: 'read:marketing',
            hiddenForRoles: [
              ...sscRolesHiddenFromFunction('Marketing'),
              ...HIDE_SSC_FUNCTIONS_FOR_ADMIN,
            ],
          },
        ],
      },
      {
        module: 'shared_services',
        href: '/shared-services/bi',
        label: 'Partner BI',
        description: 'AI insights across partner spine',
        hiddenForRoles: [...HIDE_SSC_FUNCTIONS_FOR_ADMIN],
      },
      {
        module: 'shared_services',
        href: '/shared-services/legal',
        label: 'Legal',
        description: 'Matters · tasks · counsel ops',
        hiddenForRoles: [
          ...sscRolesHiddenFromFunction('Legal'),
          ...HIDE_SSC_FUNCTIONS_FOR_ADMIN,
        ],
      },
      {
        module: 'command_center',
        href: '/activity',
        label: 'Ticket Portal',
        description: 'Tickets · notifications · firm actions',
      },
      {
        module: 'admin',
        href: '/admin',
        label: 'Admin',
        description: 'Users · docs · DocuSign · email · settings',
        children: [
          {
            module: 'admin',
            href: '/admin/org-chart',
            label: 'Org Chart',
            description: 'Reports-to · titles · zoom subtree',
          },
          {
            module: 'admin',
            href: '/admin/hire-impact',
            label: 'Hire impact',
            description: 'Fully loaded cost · budget curve',
          },
          {
            module: 'documents',
            href: '/documents',
            label: 'Document Library',
            description: 'Files · role ACL',
          },
          {
            module: 'shared_services',
            href: '/shared-services/legal/docusign',
            label: 'DocuSign',
            description: 'Envelopes · templates · archive',
            /** Counsel/Legal + firm roles; not other single-function SSC desks. */
            hiddenForRoles: sscRolesHiddenFromFunction('Legal'),
          },
          {
            module: 'admin',
            href: '/admin/email',
            label: 'Email analytics',
            description: 'Platform Graph/Resend opens · clicks',
          },
        ],
      },
    ],
  },
  {
    module: 'messages',
    href: '/messages',
    label: 'Message Center',
    description: 'Direct messages · groups',
  },
  {
    /** Grow spine — Performance Management + Training & Development (all entity OS clones). */
    module: 'shared_services',
    label: 'Grow',
    description: 'Performance · training & development',
    hiddenForRoles: [
      ...sscRolesHiddenFromFunction('HR'),
      ...HIDE_SSC_FUNCTIONS_FOR_ADMIN,
    ],
    children: [
      {
        module: 'shared_services',
        href: '/eos',
        label: 'Tage VC Performance Management',
        description: 'Rocks · scorecard · IDS · L10 · V/TO · rollup',
        hiddenForRoles: [
          ...sscRolesHiddenFromFunction('HR'),
          ...HIDE_SSC_FUNCTIONS_FOR_ADMIN,
        ],
      },
      {
        module: 'shared_services',
        href: '/training',
        label: 'Training & Development',
        description: 'LMS · courses · progress',
        hiddenForRoles: [
          ...sscRolesHiddenFromFunction('HR'),
          ...HIDE_SSC_FUNCTIONS_FOR_ADMIN,
        ],
      },
    ],
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
