'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useState, useTransition } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  exitEntityOsAction,
  switchEntityOsAction,
} from '@/app/(app)/entity-os/actions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FIRM_OS_ENTITY_ID, type EntityOsOption } from '@/lib/rbac/entity-os';
import { cn } from '@/lib/utils';

type Props = {
  /** Every OS the operator may enter. Empty when switching is not allowed. */
  options: EntityOsOption[];
  /** Locked subsidiary OS, or null for the firm-wide parent OS. */
  active: string | null;
  canSwitch: boolean;
  /** Brand line shown when switching is unavailable (single-OS users). */
  fallbackLabel: string;
};

/**
 * Sidebar brand block. For a firm-wide Visionary it becomes the Entity OS
 * switcher; for everyone else it stays the static brand line of the one OS
 * they belong to.
 */
export function EntityOsSwitcher({
  options,
  active,
  canSwitch,
  fallbackLabel,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const activeId = active ?? FIRM_OS_ENTITY_ID;
  const current = options.find((o) => o.entityId === activeId);
  const brandLine = current?.shortLabel ?? fallbackLabel;

  if (!canSwitch || options.length < 2) {
    return <BrandLines eyebrow={brandLine} />;
  }

  function select(entityId: string) {
    if (entityId === activeId) return;
    setError(null);
    startTransition(async () => {
      const result =
        entityId === FIRM_OS_ENTITY_ID
          ? await exitEntityOsAction()
          : await switchEntityOsAction(entityId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.entityId) {
        router.push(`/entities/${result.entityId}`);
      }
      router.refresh();
    });
  }

  return (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={pending}
          aria-label="Switch entity operating system"
          className={cn(
            'group -mx-2 flex w-[calc(100%+1rem)] items-start gap-2 rounded-lg px-2 py-1.5 text-left',
            'hover:bg-sidebar-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
            pending && 'opacity-60',
          )}
        >
          <span className="min-w-0 flex-1">
            <BrandLines eyebrow={brandLine} />
          </span>
          <ChevronDown className="mt-1 size-4 shrink-0 text-sidebar-foreground/60 transition-transform group-data-[popup-open]:rotate-180" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64" align="start">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Operating system</DropdownMenuLabel>
            {options.map((option, index) => (
              <Fragment key={option.entityId}>
                {index === 1 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem
                  onClick={() => select(option.entityId)}
                  className="justify-between"
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {option.entityId === activeId ? (
                    <Check className="size-4 shrink-0" />
                  ) : null}
                </DropdownMenuItem>
              </Fragment>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <p className="mt-1 text-[11px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function BrandLines({ eyebrow }: { eyebrow: string }) {
  return (
    <>
      <p className="truncate text-xs font-medium tracking-[0.18em] text-sidebar-foreground/60 uppercase">
        {eyebrow}
      </p>
      <h1 className="mt-1 font-heading text-lg font-semibold tracking-tight text-sidebar-foreground">
        Operating System
      </h1>
    </>
  );
}
