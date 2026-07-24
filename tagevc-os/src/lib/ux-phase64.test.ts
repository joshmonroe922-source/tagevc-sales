import { describe, expect, it } from 'vitest';
import {
  DUE_STATUS_HEADER,
  dueStatusLabel,
} from '@/lib/shared-services/due-status';
import { catalogForRole, emptyCardsForRole } from '@/lib/dashboard/role-dashboard-catalog';
import {
  formatInTimezone,
  windowsTimezoneToIana,
} from '@/lib/timezone/user-timezone';
import { isEffectivelyDnd } from '@/lib/messaging/availability';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Phase 64 UX upgrade foundations', () => {
  it('uses Due status plain language', () => {
    expect(DUE_STATUS_HEADER).toBe('Due status');
    expect(dueStatusLabel('breached')).toBe('Overdue');
    expect(dueStatusLabel('ok')).toBe('On time');
    expect(dueStatusLabel('none')).toBe('No due date');
  });

  it('formats timestamps in a known timezone', () => {
    const label = formatInTimezone('2026-01-15T15:00:00.000Z', 'America/New_York', 'date');
    expect(label).toMatch(/Jan/);
    expect(windowsTimezoneToIana('Eastern Standard Time')).toBe('America/New_York');
  });

  it('treats calendar busy as effective DND', () => {
    expect(
      isEffectivelyDnd({
        profile_id: 'x',
        status: 'available',
        source: 'calendar',
        calendar_busy_until: new Date(Date.now() + 60_000).toISOString(),
        microsoft_timezone: null,
        updated_at: new Date().toISOString(),
      }),
    ).toBe(true);
  });

  it('exposes full role dashboard catalogs without inventing numbers', () => {
    const visionary = emptyCardsForRole('visionary');
    expect(visionary.length).toBe(catalogForRole('visionary').length);
    expect(visionary.every((c) => c.data_state === 'not_connected')).toBe(true);
    expect(catalogForRole('service_lead').some((c) => c.kpi_id === 'due_status_rate')).toBe(
      true,
    );
  });

  it('ships presence SQL + API route', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase64_presence_due_status.sql'),
      'utf8',
    );
    const api = readFileSync(
      resolve(process.cwd(), 'src/app/api/presence/route.ts'),
      'utf8',
    );
    expect(sql).toContain('os_user_availability');
    expect(sql).toContain('os_message_soft_alerts');
    expect(api).toContain('TAGE_PRESENCE_SECRET');
  });
});
