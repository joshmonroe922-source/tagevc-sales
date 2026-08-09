import { describe, expect, it } from 'vitest';
import { isRecruit619DialpadPayload } from '@/lib/partners/dialpad-fanout';

describe('isRecruit619DialpadPayload', () => {
  it('accepts R619 office and unknown office', () => {
    expect(
      isRecruit619DialpadPayload({
        target: { office_id: 5109894981558272, type: 'user' },
      }),
    ).toBe(true);
    expect(isRecruit619DialpadPayload({ state: 'ringing' })).toBe(true);
  });

  it('rejects other offices', () => {
    expect(
      isRecruit619DialpadPayload({
        target: { office_id: '5312888585003008' },
      }),
    ).toBe(false);
  });
});
