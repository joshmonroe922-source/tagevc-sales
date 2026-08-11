'use client';

import { Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * Portable twin of the Tage `EntityOsSwitcher` brand block (sidebar header).
 *
 * Presentation only — the host app supplies the option list, the current
 * selection, and an `onSelect` handler wired to its own server action. A
 * subsidiary portal that has no cross-entity operators simply omits
 * `onSelect` (or passes a single option) and gets the static brand lines.
 *
 * See `docs/OS_ENTITY_SWITCHER.md`.
 */

export type ShellEntityOsOption = {
  entityId: string;
  /** Full company name for the menu row. */
  label: string;
  /** Compact company name for the brand line. */
  shortLabel: string;
};

type Props = {
  options: ShellEntityOsOption[];
  activeEntityId: string;
  /** Second brand line — usually "Operating System". */
  title?: string;
  /** Omit to render a static brand block (no switcher). */
  onSelect?: (entityId: string) => void;
  pending?: boolean;
  error?: string | null;
};

export function ShellEntityOsBrand({
  options,
  activeEntityId,
  title = 'Operating System',
  onSelect,
  pending = false,
  error = null,
}: Props) {
  const current = options.find((o) => o.entityId === activeEntityId);
  const brandLine = current?.shortLabel ?? activeEntityId;

  if (!onSelect || options.length < 2) {
    return <BrandLines eyebrow={brandLine} title={title} />;
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
            <BrandLines eyebrow={brandLine} title={title} />
          </span>
          <ChevronDown className="mt-1 size-4 shrink-0 text-sidebar-foreground/60 transition-transform group-data-[popup-open]:rotate-180" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64" align="start">
          <DropdownMenuLabel>Operating system</DropdownMenuLabel>
          {options.map((option, index) => (
            <div key={option.entityId}>
              {index === 1 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                onClick={() => onSelect(option.entityId)}
                className="justify-between"
              >
                <span className="min-w-0 truncate">{option.label}</span>
                {option.entityId === activeEntityId ? (
                  <Check className="size-4 shrink-0" />
                ) : null}
              </DropdownMenuItem>
            </div>
          ))}
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

function BrandLines({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <>
      <p className="truncate text-xs font-medium tracking-[0.18em] text-sidebar-foreground/60 uppercase">
        {eyebrow}
      </p>
      <h1 className="mt-1 font-heading text-lg font-semibold tracking-tight text-sidebar-foreground">
        {title}
      </h1>
    </>
  );
}
