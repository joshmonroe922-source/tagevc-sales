import { describe, expect, it } from 'vitest';
import { canSendMarketing } from '@/lib/campaign/core/consent';
import { checkMutex, DEFAULT_MUTEX_POLICY } from '@/lib/campaign/core/mutex';

describe('slim enrollments consent/mutex', () => {
  it('blocks opted_out contacts', () => {
    const gate = canSendMarketing({
      email: 'a@example.com',
      permission: 'opted_out',
    });
    expect(gate.allow).toBe(false);
    if (!gate.allow) expect(gate.code).toBe('OPTED_OUT');
  });

  it('allows opted_in contacts', () => {
    expect(
      canSendMarketing({ email: 'a@example.com', permission: 'opted_in' }).allow,
    ).toBe(true);
  });

  it('enforces max global mutex', () => {
    const result = checkMutex({
      active: [
        { id: '1', journeyId: 'j1' },
        { id: '2', journeyId: 'j2' },
        { id: '3', journeyId: 'j3' },
      ],
      policy: DEFAULT_MUTEX_POLICY,
    });
    expect(result.ok).toBe(false);
  });
});
