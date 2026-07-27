/** Portal-wide card vs list preference (localStorage). */

export type ViewMode = 'cards' | 'list';

/** Prefix for per-surface keys: `tagevc.view.mode.v1.<surface>` */
export const VIEW_MODE_STORAGE_PREFIX = 'tagevc.view.mode.v1';

export function viewModeStorageKey(surface: string): string {
  return `${VIEW_MODE_STORAGE_PREFIX}.${surface}`;
}

export function parseViewMode(
  raw: string | null | undefined,
  fallback: ViewMode,
): ViewMode {
  if (raw === 'cards' || raw === 'list') return raw;
  return fallback;
}

/** High-traffic item grids — defaults match current layouts. */
export const VIEW_MODE_DEFAULTS = {
  entities: 'cards',
  'shared-services-functions': 'cards',
  'documents-entities': 'cards',
  'deal-flow-tracks': 'cards',
  'hr-employees-snapshot': 'cards',
  'ic-queue-open': 'cards',
  'role-dashboard': 'cards',
  'dashboard-portfolio-summary': 'cards',
  'dashboard-portfolio-health': 'cards',
  'dashboard-operating-cadence': 'cards',
  'command-center-funnel': 'cards',
  'command-center-capital': 'cards',
  'command-center-portfolio-health': 'cards',
  'firm-ops-command-metrics': 'cards',
} as const satisfies Record<string, ViewMode>;

export type ViewModeSurface = keyof typeof VIEW_MODE_DEFAULTS;
