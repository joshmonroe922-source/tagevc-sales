import { describe, expect, it } from 'vitest';
import {
  allReportingWindows,
  isIsoInReportingWindow,
  parseReportingPeriodParam,
  reportingWindow,
  resolveReportingTimeZone,
} from '@/lib/platform/reporting-timeframes';

describe('reporting-timeframes', () => {
  it('resolves invalid timezone to default', () => {
    expect(resolveReportingTimeZone('Not/AZone')).toBe('America/New_York');
    expect(resolveReportingTimeZone('America/Los_Angeles')).toBe(
      'America/Los_Angeles',
    );
  });

  it('builds day/week/month windows with labels', () => {
    const now = new Date('2026-07-15T18:00:00.000Z'); // Wed
    const tz = 'America/Los_Angeles';
    const day = reportingWindow('day', tz, now);
    const week = reportingWindow('week', tz, now);
    const month = reportingWindow('month', tz, now);

    expect(day.label).toBe('Today');
    expect(week.label).toBe('This week');
    expect(month.label).toBe('This month');
    expect(day.start.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(week.start.getTime()).toBeLessThanOrEqual(day.start.getTime());
    expect(month.start.getTime()).toBeLessThanOrEqual(week.start.getTime());
  });

  it('builds quarter and ytd', () => {
    const now = new Date('2026-07-15T18:00:00.000Z');
    const q = reportingWindow('quarter', 'America/New_York', now);
    const ytd = reportingWindow('ytd', 'America/New_York', now);
    expect(q.label).toBe('This quarter');
    expect(ytd.label).toBe('YTD');
    expect(ytd.start.getTime()).toBeLessThanOrEqual(q.start.getTime());
  });

  it('filters ISO timestamps against a window', () => {
    const now = new Date('2026-07-15T18:00:00.000Z');
    const win = reportingWindow('month', 'UTC', now);
    expect(isIsoInReportingWindow('2026-07-10T12:00:00.000Z', win)).toBe(true);
    expect(isIsoInReportingWindow('2026-06-01T12:00:00.000Z', win)).toBe(false);
    expect(isIsoInReportingWindow(null, win)).toBe(false);
  });

  it('parses period query params', () => {
    expect(parseReportingPeriodParam('month')).toBe('month');
    expect(parseReportingPeriodParam('nope', 'day')).toBe('day');
  });

  it('returns default chip set', () => {
    const all = allReportingWindows('America/New_York');
    expect(Object.keys(all).sort()).toEqual(['day', 'month', 'week']);
  });
});
