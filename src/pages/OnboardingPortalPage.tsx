import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { getPortalDefinition, userHasPortal } from '../lib/portals';
import type { PortalSlug, SalesUser } from '../lib/types';

type Props = {
  salesUser: SalesUser;
};

const ONBOARDING: Record<
  'new-start-up' | 'new-acquisition',
  {
    eyebrow: string;
    headline: string;
    body: string;
    ctaLabel: string;
    ctaTo: string;
    templateLabel: string;
  }
> = {
  'new-start-up': {
    eyebrow: 'Portfolio onboarding',
    headline: 'Start a business into the portfolio',
    body: 'Clone the start-business checklist, seed document folders, and track launch work until the entity is ready for ongoing Entity Ops.',
    ctaLabel: 'Start a business',
    ctaTo: '/sales/ops/entities/new?template=start-business&from=new-start-up',
    templateLabel: 'start-business',
  },
  'new-acquisition': {
    eyebrow: 'Portfolio onboarding',
    headline: 'Mergers & acquisitions into the portfolio',
    body: 'Clone the acquire-business checklist, seed document folders, and track diligence and closing work until the entity is ready for ongoing Entity Ops.',
    ctaLabel: 'Acquire a business',
    ctaTo: '/sales/ops/entities/new?template=acquire-business&from=new-acquisition',
    templateLabel: 'acquire-business',
  },
};

function slugFromPath(pathname: string, paramSlug?: string): string {
  if (paramSlug) return paramSlug;
  if (pathname === '/sales/new-start-up' || pathname.startsWith('/sales/new-start-up/')) {
    return 'new-start-up';
  }
  if (
    pathname === '/sales/new-acquisition' ||
    pathname.startsWith('/sales/new-acquisition/')
  ) {
    return 'new-acquisition';
  }
  return '';
}

export function OnboardingPortalPage({ salesUser }: Props) {
  const location = useLocation();
  const { slug: paramSlug } = useParams<{ slug: string }>();
  const slug = slugFromPath(location.pathname, paramSlug);
  const def = getPortalDefinition(slug);
  const copy = ONBOARDING[slug as keyof typeof ONBOARDING];

  if (!def || !copy) {
    return <Navigate to="/sales" replace />;
  }

  if (!userHasPortal(salesUser, def.slug as PortalSlug)) {
    return <Navigate to="/sales" replace />;
  }

  const hasManagePortfolio = userHasPortal(salesUser, 'manage-portfolio');

  return (
    <>
      <div className="page-header">
        <div>
          <p className="crumb">
            <Link to="/sales">Portals</Link> / {def.name}
          </p>
          <h1>{def.name}</h1>
          <p className="muted">{def.description}</p>
        </div>
        <div className="page-actions">
          <Link to="/sales" className="btn ghost">
            All portals
          </Link>
        </div>
      </div>

      <div className="portal-stub onboarding-portal">
        <p className="portal-stub-eyebrow">{copy.eyebrow}</p>
        <h2>{copy.headline}</h2>
        <p className="muted">{copy.body}</p>
        <p className="muted small">
          Uses Entity Ops checklist template <code>{copy.templateLabel}</code>. After create,
          the entity lives under Manage Portfolio (Entity Ops).
        </p>
        <div className="form-actions">
          <Link to={copy.ctaTo} className="btn primary">
            {copy.ctaLabel}
          </Link>
          {hasManagePortfolio ? (
            <Link to="/sales/ops" className="btn ghost">
              Open Entity Ops
            </Link>
          ) : null}
        </div>
      </div>

      <p className="muted small portal-todo-hint">
        Use <strong>Add To Do</strong> in the header to capture tasks in Microsoft To Do.
      </p>
    </>
  );
}
