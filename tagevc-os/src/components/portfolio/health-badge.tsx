import { Badge } from '@/components/ui/badge';
import { healthBadgeClass } from '@/lib/portfolio/rollup';
import type { PortfolioHealth } from '@/lib/types';
import { cn } from '@/lib/utils';

export function HealthBadge({ health }: { health: PortfolioHealth }) {
  return (
    <Badge
      variant="outline"
      className={cn('font-medium', healthBadgeClass(health))}
    >
      {health}
    </Badge>
  );
}
