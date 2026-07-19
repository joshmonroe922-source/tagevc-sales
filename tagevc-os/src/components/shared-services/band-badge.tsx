import { Badge } from '@/components/ui/badge';
import type { AutonomyBand } from '@/lib/types';
import { cn } from '@/lib/utils';

const STYLES: Record<AutonomyBand, string> = {
  AUTO: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  DRAFT: 'bg-amber-50 text-amber-950 border-amber-200',
  ESCALATE: 'bg-red-50 text-red-900 border-red-200',
};

export function BandBadge({ band }: { band: AutonomyBand }) {
  return (
    <Badge variant="outline" className={cn('font-semibold', STYLES[band])}>
      {band}
    </Badge>
  );
}
