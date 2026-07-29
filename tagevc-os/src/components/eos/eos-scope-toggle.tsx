'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { EOS_SCOPE_ENTITIES } from '@/lib/eos/types';
import { cn } from '@/lib/utils';

export function EosScopeToggle({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <div
      className={cn(
        'flex flex-wrap gap-1 rounded-md border border-border bg-muted/40 p-1',
        className,
      )}
      role="tablist"
      aria-label="EOS entity scope"
    >
      {EOS_SCOPE_ENTITIES.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={pending}
            className={cn(
              'rounded px-2.5 py-1.5 text-xs font-medium transition-colors',
              active
                ? 'bg-[#3a414f] text-white'
                : 'text-muted-foreground hover:bg-background hover:text-foreground',
            )}
            onClick={() => {
              const next = new URLSearchParams(searchParams.toString());
              if (opt.value === 'consolidated') next.delete('entity');
              else next.set('entity', opt.value);
              startTransition(() => {
                router.push(
                  next.toString()
                    ? `${pathname}?${next.toString()}`
                    : pathname,
                );
              });
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
