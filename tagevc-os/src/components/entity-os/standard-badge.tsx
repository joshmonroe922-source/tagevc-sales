import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** CORE = required every cycle; FLEX = industry optional (§3C). */
export function StandardBadge({
  standard,
  className,
}: {
  standard: 'CORE' | 'FLEX';
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'font-medium tracking-wide',
        standard === 'CORE'
          ? 'border-[#3a414f]/40 bg-[#3a414f]/8 text-[#3a414f]'
          : 'border-[#9f957c]/50 bg-[#9f957c]/15 text-[#535c63]',
        className,
      )}
    >
      {standard}
    </Badge>
  );
}
