import { cn } from '@/lib/utils';

export const ENTITY_OS_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'rollup', label: 'Rollup' },
  { id: 'financials', label: 'Financials' },
  { id: 'core-kpis', label: 'CORE KPIs' },
  { id: 'flex-kpis', label: 'FLEX KPIs' },
  { id: 'leads', label: 'Leads' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'docs', label: 'Docs' },
  { id: 'tickets', label: 'SS Tickets' },
] as const;

export function EntitySectionNav({
  className,
}: {
  className?: string;
}) {
  return (
    <nav
      className={cn(
        'flex flex-wrap gap-1 border-b border-border pb-2',
        className,
      )}
      aria-label="Subsidiary OS sections"
    >
      {ENTITY_OS_SECTIONS.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}
