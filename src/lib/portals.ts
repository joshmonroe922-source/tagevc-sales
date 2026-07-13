import type { PortalSlug, SalesPortal, SalesUser } from './types';

export type PortalNavItem = {
  to: string;
  label: string;
  /** Match nested routes (e.g. /sales/deal-sourcing/leads/:id) */
  matchPrefix?: string;
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
        to: '/sales/deal-sourcing/tasks',
        label: 'Follow-ups',
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
    description: 'Portfolio companies, checklists, folders, and compliance.',
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
    description: 'Finance workspace (coming soon).',
    homePath: '/sales/portals/accounting-finance',
    stub: true,
    pathPrefixes: ['/sales/portals/accounting-finance'],
    nav: [
      {
        to: '/sales/portals/accounting-finance',
        label: 'Overview',
        matchPrefix: '/sales/portals/accounting-finance',
      },
    ],
  },
  {
    slug: 'legal',
    name: 'Legal',
    description: 'Legal workspace (coming soon).',
    homePath: '/sales/portals/legal',
    stub: true,
    pathPrefixes: ['/sales/portals/legal'],
    nav: [
      { to: '/sales/portals/legal', label: 'Overview', matchPrefix: '/sales/portals/legal' },
    ],
  },
  {
    slug: 'marketing',
    name: 'Marketing',
    description: 'Blog, social, and content operations.',
    homePath: '/sales/content',
    stub: false,
    pathPrefixes: ['/sales/content'],
    nav: [
      { to: '/sales/content', label: 'Content hub', matchPrefix: '/sales/content' },
      { to: '/sales/content/blog', label: 'Blog', matchPrefix: '/sales/content/blog' },
      { to: '/sales/content/social', label: 'Social', matchPrefix: '/sales/content/social' },
    ],
  },
  {
    slug: 'technology',
    name: 'Technology',
    description: 'Technology workspace (coming soon).',
    homePath: '/sales/portals/technology',
    stub: true,
    pathPrefixes: ['/sales/portals/technology'],
    nav: [
      {
        to: '/sales/portals/technology',
        label: 'Overview',
        matchPrefix: '/sales/portals/technology',
      },
    ],
  },
  {
    slug: 'human-resources',
    name: 'Human Resources',
    description: 'HR workspace (coming soon).',
    homePath: '/sales/portals/human-resources',
    stub: true,
    pathPrefixes: ['/sales/portals/human-resources'],
    nav: [
      {
        to: '/sales/portals/human-resources',
        label: 'Overview',
        matchPrefix: '/sales/portals/human-resources',
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
    pathname.startsWith('/sales/admin') ||
    pathname === '/sales/calendar' ||
    pathname.startsWith('/sales/calendar/') ||
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
