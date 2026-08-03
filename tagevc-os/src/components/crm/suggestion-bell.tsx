'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export function SuggestionBell({ initialCount = 0 }: { initialCount?: number }) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/spine/suggestions?count=1', {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const json = (await res.json()) as { count?: number };
        if (!cancelled && typeof json.count === 'number') setCount(json.count);
      } catch {
        /* soft */
      }
    };
    void tick();
    const id = window.setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <Link
      href="/shared-services/crm/suggestions"
      className="relative inline-flex items-center rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted/50"
      title="Pending CRM suggestions"
    >
      Suggestions
      {count > 0 ? (
        <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-amber-600 px-1 text-[10px] font-semibold text-white">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  );
}
