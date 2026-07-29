'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { EosViewMode } from '@/lib/org/tree';

const MODES: Array<{ value: EosViewMode; label: string; tageOnly?: boolean }> = [
  { value: 'me', label: 'Me' },
  { value: 'team', label: 'Team' },
  { value: 'entity', label: 'Entity' },
  { value: 'consolidated', label: 'Consolidated', tageOnly: true },
];

export function EosViewModeToggle({
  value,
  showConsolidated = true,
}: {
  value: EosViewMode;
  showConsolidated?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <div className="flex flex-wrap gap-1.5">
      {MODES.filter((m) => showConsolidated || !m.tageOnly).map((m) => (
        <Button
          key={m.value}
          type="button"
          size="sm"
          variant={value === m.value ? 'default' : 'outline'}
          className={
            value === m.value
              ? 'bg-[#3a414f] text-white hover:bg-[#535c63]'
              : undefined
          }
          onClick={() => {
            const params = new URLSearchParams(searchParams.toString());
            params.set('view', m.value);
            router.push(`/eos?${params.toString()}`);
          }}
        >
          {m.label}
        </Button>
      ))}
    </div>
  );
}
