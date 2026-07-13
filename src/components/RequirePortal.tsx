import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { portalsAllowedForPath, userHasPortal } from '../lib/portals';
import type { SalesUser } from '../lib/types';

type Props = {
  salesUser: SalesUser;
  children: ReactNode;
};

/** Redirects to the portal picker when the route belongs to a portal the user lacks. */
export function RequirePortal({ salesUser, children }: Props) {
  const location = useLocation();
  const allowed = portalsAllowedForPath(location.pathname);

  if (allowed && !allowed.some((slug) => userHasPortal(salesUser, slug))) {
    return <Navigate to="/sales" replace />;
  }

  return <>{children}</>;
}
