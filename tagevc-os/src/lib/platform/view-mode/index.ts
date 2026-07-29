/**
 * Platform Cards | List preference — canonical for Tage + every subsidiary OS.
 *
 * Copy this module (`src/lib/platform/view-mode/`) and
 * `src/components/ui/view-mode-toggle.tsx` + `src/components/platform/module-link-board.tsx`
 * when scaffolding. See `docs/SUBSIDIARY_OS_SHELL.md` § Cards | List.
 *
 * Preference persists in localStorage: `tagevc.view.mode.v1.<surface>`.
 * New card sections MUST use ViewModeLayout / ModuleLinkBoard — do not ship
 * card-only grids for navigational or metric boards.
 */

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

/**
 * Known surfaces + defaults. Any string surface is valid at runtime;
 * add new keys here when shipping a board so defaults stay documented.
 */
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
  // A&F / Personal / Net Worth (platform-required)
  'af-hub-entities': 'cards',
  'af-hub-accounting': 'cards',
  'af-hub-finance': 'cards',
  'af-hub-assurance': 'cards',
  'af-accounting-modules': 'cards',
  'af-finance-modules': 'cards',
  'af-finance-kpis': 'cards',
  'af-finance-buckets': 'cards',
  'af-setup-progress': 'cards',
  'af-audit-modules': 'cards',
  'af-controls-modules': 'cards',
  'personal-finance-modules': 'cards',
  'net-worth-breakdown': 'cards',
  'investments-breakdown': 'cards',
  'credit-management-summary': 'cards',
} as const satisfies Record<string, ViewMode>;

export type ViewModeSurface = keyof typeof VIEW_MODE_DEFAULTS;

export function defaultViewModeFor(surface: string): ViewMode {
  if (surface in VIEW_MODE_DEFAULTS) {
    return VIEW_MODE_DEFAULTS[surface as ViewModeSurface];
  }
  return 'cards';
}
