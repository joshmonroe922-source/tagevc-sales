import type { PortalSlug, SalesPortal, SalesUser } from './types';

export type PortalNavItem = {
  to: string;
  label: string;
  /** Match nested routes (e.g. /sales/deal-sourcing/leads/:id) */
  matchPrefix?: string;
  /** Only highlight on exact path (e.g. Legal Overview at /sales/legal) */
  end?: boolean;
};

export type PortalDefinition = {
  slug: PortalSlug;
  name: string;
  description: string;
  /** Default landing when entering this portal */
  homePath: string;
  nav: PortalNavItem[];
  /** Path prefixes that require this portal */
  pathPrefixes: string[];
  /** True when only a stub shell exists */
  stub: boolean;
};

/**
 * Client-side catalog + route mapping. DB `sales_portals` is the access source of
 * truth; this file maps portals → existing (or stub) routes.
 */
export const PORTAL_DEFINITIONS: PortalDefinition[] = [
  {
    slug: 'deal-sourcing',
    name: 'Deal Sourcing',
    description: 'Pipeline, follow-ups, and founder nurture.',
    homePath: '/sales/deal-sourcing/leads',
    stub: false,
    // Include legacy flat sales-app paths so RequirePortal still gates bookmarks/emails.
    pathPrefixes: [
      '/sales/deal-sourcing',
      '/sales/leads',
      '/sales/tasks',
      '/sales/automation',
    ],
    nav: [
      {
        to: '/sales/deal-sourcing/leads',
        label: 'Deal flow',
        matchPrefix: '/sales/deal-sourcing/leads',
      },
      {
        to: '/sales/deal-sourcing/accounts',
        label: 'Accounts',
        matchPrefix: '/sales/deal-sourcing/accounts',
      },
      {
        to: '/sales/deal-sourcing/contacts',
        label: 'Contacts',
        matchPrefix: '/sales/deal-sourcing/contacts',
      },
      {
        to: '/sales/deal-sourcing/tasks',
        label: 'Deal tasks',
        matchPrefix: '/sales/deal-sourcing/tasks',
      },
      {
        to: '/sales/deal-sourcing/automation',
        label: 'Nurture',
        matchPrefix: '/sales/deal-sourcing/automation',
      },
    ],
  },
  {
    slug: 'due-diligence',
    name: 'Due Diligence',
    description: 'Diligence checklist and deal workspace before term sheet or close.',
    homePath: '/sales/due-diligence',
    stub: false,
    pathPrefixes: ['/sales/due-diligence'],
    nav: [
      {
        to: '/sales/due-diligence',
        label: 'Workspace',
        matchPrefix: '/sales/due-diligence',
      },
    ],
  },
  {
    slug: 'new-start-up',
    name: 'New Start Up',
    description: 'Onboard a newly launched business into the portfolio.',
    homePath: '/sales/new-start-up',
    stub: false,
    pathPrefixes: ['/sales/new-start-up'],
    nav: [
      { to: '/sales/new-start-up', label: 'Overview', matchPrefix: '/sales/new-start-up' },
      {
        to: '/sales/ops/entities/new?template=start-business&from=new-start-up',
        label: 'Start business',
        matchPrefix: '/sales/ops/entities/new',
      },
    ],
  },
  {
    slug: 'new-acquisition',
    name: 'New Mergers & Acquisitions',
    description: 'Onboard an M&A target into the portfolio after diligence and close.',
    homePath: '/sales/new-acquisition',
    stub: false,
    pathPrefixes: ['/sales/new-acquisition'],
    nav: [
      {
        to: '/sales/new-acquisition',
        label: 'Overview',
        matchPrefix: '/sales/new-acquisition',
      },
      {
        to: '/sales/ops/entities/new?template=acquire-business&from=new-acquisition',
        label: 'Acquire business',
        matchPrefix: '/sales/ops/entities/new',
      },
    ],
  },
  {
    slug: 'manage-portfolio',
    name: 'Manage Portfolio',
    description: 'Portfolio companies, checklists, folders, and operations.',
    homePath: '/sales/ops',
    stub: false,
    pathPrefixes: ['/sales/ops'],
    nav: [
      { to: '/sales/ops', label: 'Companies', matchPrefix: '/sales/ops' },
    ],
  },
  {
    slug: 'executive-leadership',
    name: 'Executive Leadership',
    description: 'Leadership overview and cross-portal priorities.',
    homePath: '/sales/portals/executive-leadership',
    stub: true,
    pathPrefixes: ['/sales/portals/executive-leadership'],
    nav: [
      {
        to: '/sales/portals/executive-leadership',
        label: 'Overview',
        matchPrefix: '/sales/portals/executive-leadership',
      },
    ],
  },
  {
    slug: 'reporting',
    name: 'Reporting',
    description: 'Deal-flow metrics and performance views.',
    homePath: '/sales/reports',
    stub: false,
    pathPrefixes: ['/sales/reports'],
    nav: [
      { to: '/sales/reports', label: 'Deal flow reports', matchPrefix: '/sales/reports' },
    ],
  },
  {
    slug: 'accounting-finance',
    name: 'Accounting and Finance',
    description:
      'Accounting & finance audit, month/year-end close, Intuit Suite controls, and open finance tasks across parent + subsidiaries.',
    homePath: '/sales/finance',
    stub: false,
    pathPrefixes: ['/sales/finance', '/sales/portals/accounting-finance'],
    nav: [
      { to: '/sales/finance', label: 'Overview', end: true },
      {
        to: '/sales/finance/controls',
        label: 'Compliance',
        matchPrefix: '/sales/finance/controls',
      },
      {
        to: '/sales/finance/month-end',
        label: 'Month End Close',
        matchPrefix: '/sales/finance/month-end',
      },
      {
        to: '/sales/finance/year-end',
        label: 'Year End Close',
        matchPrefix: '/sales/finance/year-end',
      },
      {
        to: '/sales/finance/tasks',
        label: 'Tasks',
        matchPrefix: '/sales/finance/tasks',
      },
      {
        to: '/sales/finance/tickets',
        label: 'Tickets',
        matchPrefix: '/sales/finance/tickets',
      },
    ],
  },
  {
    slug: 'legal',
    name: 'Legal',
    description:
      'Corporate legal audit, filings, and open tasks across parent + subsidiaries.',
    homePath: '/sales/legal',
    stub: false,
    pathPrefixes: ['/sales/legal', '/sales/portals/legal'],
    nav: [
      { to: '/sales/legal', label: 'Overview', end: true },
      {
        to: '/sales/legal/controls',
        label: 'Corporate audit',
        matchPrefix: '/sales/legal/controls',
      },
      {
        to: '/sales/legal/tasks',
        label: 'Tasks',
        matchPrefix: '/sales/legal/tasks',
      },
      {
        to: '/sales/legal/filings',
        label: 'Filings',
        matchPrefix: '/sales/legal/filings',
      },
      {
        to: '/sales/legal/contracts',
        label: 'Contracts',
        matchPrefix: '/sales/legal/contracts',
      },
      {
        to: '/sales/legal/ra-notices',
        label: 'RA notices',
        matchPrefix: '/sales/legal/ra-notices',
      },
      {
        to: '/sales/legal/tickets',
        label: 'Tickets',
        matchPrefix: '/sales/legal/tickets',
      },
    ],
  },
  {
    slug: 'marketing',
    name: 'Marketing',
    description:
      'Marketing plan & audit across parent + subsidiaries, plus blog/social content ops.',
    homePath: '/sales/marketing',
    stub: false,
    pathPrefixes: ['/sales/marketing', '/sales/content', '/sales/portals/marketing'],
    nav: [
      { to: '/sales/marketing', label: 'Overview', end: true },
      {
        to: '/sales/marketing/controls',
        label: 'Plan & audit',
        matchPrefix: '/sales/marketing/controls',
      },
      {
        to: '/sales/marketing/tasks',
        label: 'Tasks',
        matchPrefix: '/sales/marketing/tasks',
      },
      {
        to: '/sales/marketing/tickets',
        label: 'Tickets',
        matchPrefix: '/sales/marketing/tickets',
      },
      { to: '/sales/content', label: 'Content hub', matchPrefix: '/sales/content' },
      { to: '/sales/content/blog', label: 'Blog', matchPrefix: '/sales/content/blog' },
      { to: '/sales/content/social', label: 'Social', matchPrefix: '/sales/content/social' },
    ],
  },
  {
    slug: 'technology',
    name: 'Technology',
    description:
      'Technology plan & audit across parent + subsidiaries — hybrid IT, Suite integrations, and security.',
    homePath: '/sales/technology',
    stub: false,
    pathPrefixes: ['/sales/technology', '/sales/portals/technology'],
    nav: [
      { to: '/sales/technology', label: 'Overview', end: true },
      {
        to: '/sales/technology/controls',
        label: 'Plan & audit',
        matchPrefix: '/sales/technology/controls',
      },
      {
        to: '/sales/technology/tasks',
        label: 'Tasks',
        matchPrefix: '/sales/technology/tasks',
      },
      {
        to: '/sales/technology/tickets',
        label: 'Tickets',
        matchPrefix: '/sales/technology/tickets',
      },
    ],
  },
  {
    slug: 'administrative',
    name: 'Administrative',
    description:
      'Office operations, facilities, vendor management, and general admin shared services across parent + subsidiaries.',
    homePath: '/sales/administrative',
    stub: false,
    pathPrefixes: ['/sales/administrative', '/sales/portals/administrative'],
    nav: [
      { to: '/sales/administrative', label: 'Overview', end: true },
      {
        to: '/sales/administrative/controls',
        label: 'Plan & audit',
        matchPrefix: '/sales/administrative/controls',
      },
      {
        to: '/sales/administrative/tasks',
        label: 'Tasks',
        matchPrefix: '/sales/administrative/tasks',
      },
      {
        to: '/sales/administrative/tickets',
        label: 'Tickets',
        matchPrefix: '/sales/administrative/tickets',
      },
    ],
  },
  {
    slug: 'human-resources',
    name: 'Human Resources',
    description:
      'Employee files + company HR compliance (parent and portfolio) — shared services only.',
    homePath: '/sales/hr/employees',
    stub: false,
    pathPrefixes: ['/sales/hr', '/sales/portals/human-resources'],
    nav: [
      {
        to: '/sales/hr/employees',
        label: 'Employee files',
        matchPrefix: '/sales/hr/employees',
      },
      {
        to: '/sales/hr/talent-acquisition',
        label: 'Talent acquisition',
        matchPrefix: '/sales/hr/talent-acquisition',
      },
      {
        to: '/sales/hr/onboarding',
        label: 'Onboarding',
        matchPrefix: '/sales/hr/onboarding',
      },
      {
        to: '/sales/hr/offboarding',
        label: 'Offboarding',
        matchPrefix: '/sales/hr/offboarding',
      },
      {
        to: '/sales/hr/compliance',
        label: 'Compliance',
        matchPrefix: '/sales/hr/compliance',
      },
      {
        to: '/sales/hr/tickets',
        label: 'Tickets',
        matchPrefix: '/sales/hr/tickets',
      },
    ],
  },
];

const BY_SLUG = new Map(PORTAL_DEFINITIONS.map((p) => [p.slug, p]));

export function getPortalDefinition(slug: string): PortalDefinition | undefined {
  return BY_SLUG.get(slug as PortalSlug);
}

/** Portals that share Entity Ops routes for start/acquire onboarding. */
const OPS_SHARED_PORTALS: PortalSlug[] = [
  'manage-portfolio',
  'new-start-up',
  'new-acquisition',
];

export function pathRequiresPortal(pathname: string): PortalSlug | null {
  // Admin + portal picker + global tools are not portal-scoped
  if (
    pathname === '/sales' ||
    pathname === '/sales/' ||
    pathname.startsWith('/sales/admin/') ||
    pathname === '/sales/today' ||
    pathname.startsWith('/sales/today/') ||
    pathname === '/sales/calendar' ||
    pathname.startsWith('/sales/calendar/') ||
    pathname === '/sales/todo' ||
    pathname.startsWith('/sales/todo/') ||
    pathname === '/sales/to-do' ||
    pathname.startsWith('/sales/to-do/') ||
    pathname === '/sales/planner' ||
    pathname.startsWith('/sales/planner/') ||
    pathname === '/sales/chat' ||
    pathname.startsWith('/sales/chat/') ||
    pathname === '/sales/meetings' ||
    pathname.startsWith('/sales/meetings/') ||
    pathname === '/sales/files' ||
    pathname.startsWith('/sales/files/') ||
    pathname === '/sales/mail' ||
    pathname.startsWith('/sales/mail/') ||
    pathname === '/sales/tickets' ||
    pathname.startsWith('/sales/tickets/') ||
    pathname === '/sales/portals' ||
    pathname === '/sales/portals/'
  ) {
    return null;
  }

  // Stub portal pages: /sales/portals/:slug
  const stubMatch = pathname.match(/^\/sales\/portals\/([^/]+)/);
  if (stubMatch) {
    const slug = stubMatch[1] as PortalSlug;
    if (BY_SLUG.has(slug)) return slug;
  }

  for (const portal of PORTAL_DEFINITIONS) {
    for (const prefix of portal.pathPrefixes) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        return portal.slug;
      }
    }
  }

  return null;
}

/**
 * Portals that may open this path. Entity Ops is shared by Manage Portfolio plus
 * New Start Up / New Mergers & Acquisitions onboarding entry points.
 */
export function portalsAllowedForPath(pathname: string): PortalSlug[] | null {
  const primary = pathRequiresPortal(pathname);
  if (!primary) return null;
  if (primary === 'manage-portfolio') return OPS_SHARED_PORTALS;
  return [primary];
}

/** Prefer `from` query (onboarding deep-link), else first assigned shared portal. */
export function activePortalForPath(
  pathname: string,
  search: string,
  user: Pick<SalesUser, 'role' | 'portals'>,
): PortalSlug | null {
  const allowed = portalsAllowedForPath(pathname);
  if (!allowed) return null;

  const from = new URLSearchParams(search).get('from');
  if (from && allowed.includes(from as PortalSlug) && userHasPortal(user, from)) {
    return from as PortalSlug;
  }

  // Prefer Manage Portfolio when the user has it (ongoing ops home).
  if (allowed.includes('manage-portfolio') && userHasPortal(user, 'manage-portfolio')) {
    return 'manage-portfolio';
  }

  return allowed.find((slug) => userHasPortal(user, slug)) ?? null;
}

export function userHasPortal(
  userOrPortals: Pick<SalesUser, 'role' | 'portals'> | Pick<SalesPortal, 'slug'>[] | undefined,
  slug: PortalSlug | string,
): boolean {
  // Admin always has full portal access (Josh / allowlisted admins)
  if (userOrPortals && !Array.isArray(userOrPortals) && 'role' in userOrPortals) {
    if (userOrPortals.role === 'admin') return true;
    return (userOrPortals.portals ?? []).some((p) => p.slug === slug);
  }
  return (userOrPortals ?? []).some((p) => p.slug === slug);
}

export function firstAssignedHomePath(portals: SalesPortal[]): string {
  if (!portals.length) return '/sales';
  const ordered = [...PORTAL_DEFINITIONS]
    .filter((d) => portals.some((p) => p.slug === d.slug))
    .sort((a, b) => {
      const ao = portals.find((p) => p.slug === a.slug)?.sort_order ?? a.pathPrefixes.length;
      const bo = portals.find((p) => p.slug === b.slug)?.sort_order ?? b.pathPrefixes.length;
      return ao - bo;
    });
  return ordered[0]?.homePath ?? '/sales';
}

/** Portal picker for multi-portal users; single-portal users land in their home. */
export function postAuthHomePath(user: Pick<SalesUser, 'role' | 'portals'>): string {
  if (user.role === 'admin' || (user.portals?.length ?? 0) !== 1) return '/sales';
  return firstAssignedHomePath(user.portals);
}

export function mergePortalRows(rows: SalesPortal[]): SalesPortal[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}
