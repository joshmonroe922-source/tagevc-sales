/**
 * Tage OS platform primitives — copy into subsidiary OS scaffolds
 * (Recruit 619, Instant NDA, Signent, future) under `src/lib/platform/`.
 *
 * Shell UX (AppTopBar Alerts + Create Ticket split): see `shell/` and
 * `docs/SUBSIDIARY_OS_SHELL.md`. Help Desk is Create Ticket dropdown only.
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
