import { describe, expect, it } from 'vitest';
import { checkMutex } from './mutex';

describe('mutex', () => {
  it('blocks same mutex group', () => {
    const r = checkMutex({
      active: [{ id: 'e1', journeyId: 'j1', mutexGroup: 'recruiting_outreach' }],
      nextMutexGroup: 'recruiting_outreach',
    });
    expect(r.ok).toBe(false);
  });

  it('allows different groups under global cap', () => {
    const r = checkMutex({
      active: [{ id: 'e1', journeyId: 'j1', mutexGroup: 'nda' }],
      nextMutexGroup: 'recruiting_outreach',
    });
    expect(r).toEqual({ ok: true });
  });
});
