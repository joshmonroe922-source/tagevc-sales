'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  parseViewMode,
  viewModeStorageKey,
  type ViewMode,
} from '@/lib/platform/view-mode';

export function useViewMode(
  surface: string,
  defaultMode: ViewMode = 'cards',
): [ViewMode, (next: ViewMode) => void] {
  const [mode, setModeState] = useState<ViewMode>(defaultMode);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(viewModeStorageKey(surface));
      setModeState(parseViewMode(stored, defaultMode));
    } catch {
      /* private mode / quota */
    }
  }, [surface, defaultMode]);

  function setMode(next: ViewMode) {
    setModeState(next);
    try {
      window.localStorage.setItem(viewModeStorageKey(surface), next);
    } catch {
      /* ignore */
    }
  }

  return [mode, setMode];
}

type ToggleProps = {
  mode: ViewMode;
  onChange: (next: ViewMode) => void;
  className?: string;
  id?: string;
};

/** Accessible Cards | List segmented control. */
export function ViewModeToggle({ mode, onChange, className, id }: ToggleProps) {
  const baseId = id ?? 'view-mode';
  return (
    <div
      role="group"
      aria-label="View mode"
      className={cn(
        'inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs',
        className,
      )}
    >
      {(['cards', 'list'] as const).map((option) => {
        const selected = mode === option;
        return (
          <button
            key={option}
            type="button"
            id={`${baseId}-${option}`}
            aria-pressed={selected}
            onClick={() => onChange(option)}
            className={cn(
              'rounded-md px-2.5 py-1 font-medium capitalize transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              selected
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option === 'cards' ? 'Cards' : 'List'}
          </button>
        );
      })}
    </div>
  );
}

type LayoutProps = {
  surface: string;
  defaultMode?: ViewMode;
  cards: ReactNode;
  list: ReactNode;
  /** Optional label shown left of the toggle */
  label?: string;
  className?: string;
  toolbarClassName?: string;
};

/**
 * Renders either the cards or list tree based on a persisted preference.
 * Pass both trees from the server page; only the active mode is shown.
 */
export function ViewModeLayout({
  surface,
  defaultMode = 'cards',
  cards,
  list,
  label,
  className,
  toolbarClassName,
}: LayoutProps) {
  const [mode, setMode] = useViewMode(surface, defaultMode);

  return (
    <div className={cn('space-y-3', className)}>
      <div
        className={cn(
          'flex flex-wrap items-center justify-end gap-2',
          toolbarClassName,
        )}
      >
        {label ? (
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
        ) : (
          <span className="sr-only">View as cards or list</span>
        )}
        <ViewModeToggle
          mode={mode}
          onChange={setMode}
          id={`view-mode-${surface}`}
        />
      </div>
      {mode === 'cards' ? cards : list}
    </div>
  );
}
