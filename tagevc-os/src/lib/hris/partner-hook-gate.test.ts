import { describe, expect, it } from 'vitest';
import {
  evaluatePartnerHookSoftStop,
  softStopOverrideAudit,
} from '@/lib/hris/partner-hook-gate';

describe('partner hook soft stop (D07)', () => {
  it('allows complete when all live', () => {
    const d = evaluatePartnerHookSoftStop([
      { hookId: 'a', label: 'Dialpad', status: 'live_ok' },
    ]);
    expect(d.canComplete).toBe(true);
    expect(d.requiresOverride).toBe(false);
  });

  it('soft-stops dry-run and notifies Visionary + HR', () => {
    const d = evaluatePartnerHookSoftStop([
      { hookId: 'a', label: 'Gusto', status: 'dry_run' },
    ]);
    expect(d.canComplete).toBe(false);
    expect(d.requiresOverride).toBe(true);
    expect(d.notifyRoles).toEqual(['visionary', 'hr']);
  });

  it('records override audit payload', () => {
    const audit = softStopOverrideAudit({
      actorId: 'u1',
      note: 'Manual Graph provision done',
      hooks: [{ hookId: 'g', label: 'Graph', status: 'dry_run' }],
    });
    expect(audit.kind).toBe('partner_hook_soft_stop_override');
    expect(audit.note).toContain('Manual');
  });
});
