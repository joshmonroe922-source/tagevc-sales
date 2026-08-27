'use client';

import { useEffect, useState } from 'react';
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
  const [hash, setHash] = useState('');

  useEffect(() => {
    const sync = () => setHash(window.location.hash.replace(/^#/, ''));
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  return (
    <nav
      className={cn(
        'flex flex-wrap gap-1 border-b border-border pb-2',
        className,
      )}
      aria-label="Subsidiary OS sections"
    >
      {ENTITY_OS_SECTIONS.map((s) => {
        const active = hash === s.id || (!hash && s.id === 'overview');
        return (
          <a
            key={s.id}
            href={`#${s.id}`}
            aria-current={active ? 'true' : undefined}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              active
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {s.label}
          </a>
        );
      })}
    </nav>
  );
}
