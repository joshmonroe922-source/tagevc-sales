import { Navigate, useParams } from 'react-router-dom';
import type { SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

/** @deprecated Use EntityLeadershipPage — kept for import safety. */
export function Recruit619LeadershipPage({ salesUser: _salesUser }: Props) {
  const { id = '' } = useParams();
  return <Navigate to={`/sales/ops/entities/${id}/leadership`} replace />;
}
