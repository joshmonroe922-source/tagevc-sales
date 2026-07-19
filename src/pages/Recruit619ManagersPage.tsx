import { Navigate, useParams } from 'react-router-dom';
import type { SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

/**
 * Managers live in Recruiting Desk (TalentDesk), not Manage Portfolio.
 * Legacy route redirects to Platform (SSO entry).
 */
export function Recruit619ManagersPage({ salesUser: _salesUser }: Props) {
  const { id = '' } = useParams();
  return <Navigate to={`/sales/ops/entities/${id}/platform`} replace />;
}
