/**
 * Tage OS platform primitives — copy into subsidiary OS scaffolds
 * (Recruit 619, Instant NDA, Signent) under `src/lib/platform/`.
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
