import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ErrorStateProps = {
  title?: string;
  description?: string;
  onRetryHref?: string;
  onRetryLabel?: string;
  supportHref?: string;
  className?: string;
};

/** Recoverable error block — retry + optional ticket/support link. */
export function ErrorState({
  title = 'Something went wrong',
  description = 'Try again. If it keeps failing, open a Shared Services ticket.',
  onRetryHref,
  onRetryLabel = 'Retry',
  supportHref = '/shared-services?service=All',
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center',
        className,
      )}
      role="alert"
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onRetryHref ? (
          <Button render={<Link href={onRetryHref} />} size="sm">
            {onRetryLabel}
          </Button>
        ) : null}
        {supportHref ? (
          <Button
            render={<Link href={supportHref} />}
            size="sm"
            variant="outline"
          >
            Open tickets
          </Button>
        ) : null}
      </div>
    </div>
  );
}
