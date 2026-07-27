import { describe, expect, it } from 'vitest';
import {
  parseReportingPeriod,
  periodWindow,
  resolveReportingTimeZone,
  windowDaysApprox,
  isoInWindow,
} from '@/lib/reporting/timeframes';

describe('reporting timeframes', () => {
  it('parses chip query values', () => {
    expect(parseReportingPeriod('day')).toBe('day');
    expect(parseReportingPeriod('TODAY')).toBe('day');
    expect(parseReportingPeriod('week')).toBe('week');
    expect(parseReportingPeriod('month')).toBe('month');
    expect(parseReportingPeriod('nope')).toBe('week');
  });

  it('resolves IANA timezones with fallback', () => {
    expect(resolveReportingTimeZone('America/Los_Angeles')).toBe(
      'America/Los_Angeles',
    );
    expect(resolveReportingTimeZone('Not/AZone')).toBe('America/New_York');
  });

  it('builds day window starting at local midnight', () => {
    const now = new Date('2026-07-15T18:00:00.000Z');
    const win = periodWindow('day', 'America/New_York', now);
    expect(win.label).toBe('Today');
    expect(win.start.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(win.end.getTime()).toBe(now.getTime());
    expect(windowDaysApprox('day', 'America/New_York', now)).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('isoInWindow respects start/end', () => {
    const now = new Date('2026-07-15T18:00:00.000Z');
    const win = periodWindow('week', 'UTC', now);
    expect(isoInWindow(now.toISOString(), win)).toBe(true);
    expect(isoInWindow('2020-01-01T00:00:00.000Z', win)).toBe(false);
  });
});
