import { cn } from '@/lib/utils';

type SkeletonProps = {
  className?: string;
};

/** Pulse placeholder block — prefer for lists/cards over blank main. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-muted motion-reduce:animate-none',
        className,
      )}
      aria-hidden
    />
  );
}

/** Standard SSC / app list loading layout. */
export function PageSkeleton({
  cards = 6,
  showTable = true,
}: {
  cards?: number;
  showTable?: boolean;
}) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: cards }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
      {showTable ? <Skeleton className="h-48 w-full rounded-lg" /> : null}
    </div>
  );
}
