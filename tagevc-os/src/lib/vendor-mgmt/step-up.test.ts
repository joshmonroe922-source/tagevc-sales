import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { __testSign } from '@/lib/vendor-mgmt/step-up';

describe('vm step-up signing', () => {
  it('signs deterministically with env secret', () => {
    const prev = process.env.VM_STEPUP_SECRET;
    process.env.VM_STEPUP_SECRET = 'unit-test-secret';
    const a = __testSign('email.123');
    const b = createHmac('sha256', 'unit-test-secret')
      .update('email.123')
      .digest('base64url');
    expect(a).toBe(b);
    if (prev === undefined) delete process.env.VM_STEPUP_SECRET;
    else process.env.VM_STEPUP_SECRET = prev;
  });
});
