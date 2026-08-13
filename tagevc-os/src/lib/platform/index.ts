/**
 * Tage OS platform primitives — copy into subsidiary OS scaffolds
 * (Recruit 619, Instant NDA, Signent, future) under `src/lib/platform/`.
 *
 * Shell UX (AppTopBar Alerts + Create Ticket + phone Menu order): see `shell/`
 * and `docs/SUBSIDIARY_OS_SHELL.md`. Phone order: Create Ticket | Alerts | Menu.
 * Help Desk is Create Ticket dropdown only.
 *
 * A&F spine (Accounting · Finance · Audit · Controls): see `af/` and
 * `docs/TAGE_VC_AF.md`. Future OS clones inherit the same four sections
 * under `{Entity Name} A&F`.
 *
 * Cards | List: see `view-mode/` + `docs/SUBSIDIARY_OS_SHELL.md` § Cards | List.
 * New card sections must use ViewModeLayout / ModuleLinkBoard / MetricCardBoard.
 *
 * Think Tank (named threads + document upload): copy `think-tank/` into each
 * new OS. See `docs/THINK_TANK.md` and `docs/SUBSIDIARY_OS_SHELL.md` § Think Tank.
 */
export {
  DEFAULT_REPORTING_PERIODS,
  DEFAULT_REPORTING_TIMEZONE,
  EXTENDED_REPORTING_PERIODS,
  allReportingWindows,
  isIsoInReportingWindow,
  isValidIanaTimeZone,
  parseReportingPeriodParam,
  reportingWindow,
  resolveReportingTimeZone,
  zonedLocalToUtc,
  type CustomReportingRange,
  type ReportingPeriod,
  type ReportingWindow,
} from '@/lib/platform/reporting-timeframes';

export * from '@/lib/platform/email';

export {
  AF_HUB_PATH,
  AF_SECTIONS,
  afHubLabel,
  buildAfNavBranch,
  buildAfNavFlat,
  buildAfNavSectionItems,
  type AfNavBranch,
  type AfNavLeaf,
  type AfSection,
  type AfSectionId,
} from '@/lib/platform/af';

export {
  VIEW_MODE_DEFAULTS,
  VIEW_MODE_STORAGE_PREFIX,
  defaultViewModeFor,
  parseViewMode,
  viewModeStorageKey,
  type ViewMode,
  type ViewModeSurface,
} from '@/lib/platform/view-mode';
