import { cn } from '@/lib/utils';

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  /** Scope / company context line (display names only). */
  context?: string;
  primaryAction?: React.ReactNode;
  secondaryActions?: React.ReactNode;
  className?: string;
};

/** Shared page title row — SSC + shell consistency. */
export function PageHeader({
  eyebrow,
  title,
  description,
  context,
  primaryAction,
  secondaryActions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-start justify-between gap-3',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        {eyebrow ? (
          <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          {title}
        </h1>
        {context ? (
          <p className="text-xs font-medium text-muted-foreground">{context}</p>
        ) : null}
        {description ? (
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {(primaryAction || secondaryActions) && (
        <div className="flex flex-wrap items-center gap-2">
          {secondaryActions}
          {primaryAction}
        </div>
      )}
    </header>
  );
}
