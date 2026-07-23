import Link from 'next/link';
import { cn } from '@/lib/utils';

const TRACKS = [
  { id: 'hub' as const, href: '/deal-flow', label: 'All tracks' },
  { id: 'vc' as const, href: '/deal-flow/vc', label: 'VC' },
  { id: 'ma' as const, href: '/deal-flow/ma', label: 'M&A' },
  { id: 're' as const, href: '/deal-flow/re', label: 'Real Estate' },
];

type Props = {
  active: 'hub' | 'vc' | 'ma' | 're';
  className?: string;
};

export function DealFlowTrackTabs({ active, className }: Props) {
  return (
    <div
      className={cn(
        'flex flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-1',
        className,
      )}
      role="tablist"
      aria-label="Deal Flow tracks"
    >
      {TRACKS.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            active === t.id
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
