import { Link, Navigate, useParams } from 'react-router-dom';
import { getPortalDefinition, userHasPortal } from '../lib/portals';
import type { SalesUser } from '../lib/types';

type Props = {
  salesUser: SalesUser;
};

export function PortalStubPage({ salesUser }: Props) {
  const { slug = '' } = useParams<{ slug: string }>();
  const def = getPortalDefinition(slug);

  if (!def) {
    return <Navigate to="/sales" replace />;
  }

  if (!userHasPortal(salesUser, def.slug)) {
    return <Navigate to="/sales" replace />;
  }

  // Live portals have real feature routes — don't show the stub shell.
  if (!def.stub) {
    return <Navigate to={def.homePath} replace />;
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{def.name}</h1>
          <p className="muted">{def.description}</p>
        </div>
        <div className="page-actions">
          <Link to="/sales" className="btn ghost">
            All portals
          </Link>
        </div>
      </div>
      <div className="portal-stub">
        <p className="portal-stub-eyebrow">Coming soon</p>
        <h2>This portal is ready for access control</h2>
        <p className="muted">
          You are assigned to <strong>{def.name}</strong>. Feature modules for this area have not
          shipped yet — the shell is gated so only assigned users can open it.
        </p>
      </div>
    </>
  );
}
