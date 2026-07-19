import { PortfolioEntityShell } from '../components/PortfolioEntityShell';
import { ThinkTankPanel } from '../components/ThinkTankPanel';
import type { SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

export function EntityThinkTankPage({ salesUser }: Props) {
  return (
    <PortfolioEntityShell section="think-tank">
      {(entity) => (
        <ThinkTankPanel
          userId={salesUser.id}
          scope="entity"
          entityId={entity.id}
          subtitle="Entity journal · Grok coach"
          intro={`Journal company status, development ideas, hiring next-in-line, revenue upside, and spend discipline for ${entity.name}${entity.slug ? ` (${entity.slug})` : ''}. This thread is separate from your personal Think Tank.`}
          emptyHint="Start with status: what is working, what is stuck, and what hire would unlock the most revenue."
        />
      )}
    </PortfolioEntityShell>
  );
}
