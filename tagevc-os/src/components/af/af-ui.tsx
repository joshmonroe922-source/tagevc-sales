import Link from 'next/link';
import { cn } from '@/lib/utils';

export function AfModuleGrid({
  modules,
  qs = '',
}: {
  modules: readonly {
    id: string;
    label: string;
    path: string;
    description: string;
  }[];
  qs?: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {modules.map((m) => (
        <Link
          key={m.id}
          href={`${m.path}${qs}`}
          className="group relative overflow-hidden rounded-xl border border-border/80 bg-gradient-to-br from-white via-[#f7f6f3] to-[#eef1f6] px-4 py-4 transition-all hover:border-[#3a414f]/30 hover:shadow-sm"
        >
          <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-[#3a414f]/[0.04] transition-transform group-hover:scale-110" />
          <p className="font-heading text-base font-semibold text-[#3a414f]">
            {m.label}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{m.description}</p>
        </Link>
      ))}
    </div>
  );
}

export function AfEntityChips({
  active,
  qsBuilder,
}: {
  active?: string | null;
  qsBuilder: (code: string | null) => string;
}) {
  const entities = [
    { code: null, label: 'All' },
    { code: 'TVC', label: 'Tage VC' },
    { code: 'R619', label: 'Recruit 619' },
    { code: 'SHR', label: 'Signent HR' },
    { code: 'INDA', label: 'Instant NDA' },
  ] as const;

  return (
    <div className="flex flex-wrap gap-2">
      {entities.map((e) => {
        const selected =
          (e.code === null && !active) || e.code === active;
        return (
          <Link
            key={e.label}
            href={qsBuilder(e.code)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              selected
                ? 'bg-[#3a414f] text-white'
                : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground',
            )}
          >
            {e.label}
          </Link>
        );
      })}
    </div>
  );
}

export function Money({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
  return <span className={cn('tabular-nums', className)}>{formatted}</span>;
}

export function StatusPill({
  status,
}: {
  status: string;
}) {
  const tone =
    status === 'Paid' || status === 'Done' || status === 'Matched'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
      : status === 'Approved' || status === 'Sent' || status === 'In progress'
        ? 'bg-sky-50 text-sky-800 border-sky-200'
        : status === 'Draft' || status === 'Not started' || status === 'Unmatched'
          ? 'bg-amber-50 text-amber-900 border-amber-200'
          : status === 'Blocked' || status === 'Rejected' || status === 'Critical'
            ? 'bg-rose-50 text-rose-800 border-rose-200'
            : 'bg-muted text-muted-foreground border-border';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium',
        tone,
      )}
    >
      {status}
    </span>
  );
}

export function AfBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
    >
      ← {label}
    </Link>
  );
}
