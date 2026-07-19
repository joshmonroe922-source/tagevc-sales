import { ThinkTankPanel } from '../components/ThinkTankPanel';
import type { SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

/**
 * Global personal Think Tank — available to every logged-in portal user.
 * Entity-scoped journals remain under Manage Portfolio → entity → Think Tank.
 */
export function ThinkTankPage({ salesUser }: Props) {
  return (
    <div className="page think-tank-page">
      <ThinkTankPanel
        userId={salesUser.id}
        scope="personal"
        subtitle="Personal journal · Grok coach"
        intro="Your private Think Tank for priorities, decisions, and operating cadence across Tage. Separate from any subsidiary entity journal under Manage Portfolio."
        emptyHint="Start with what matters this week: blockers, decisions you need to make, and where coaching would help most."
      />
    </div>
  );
}
