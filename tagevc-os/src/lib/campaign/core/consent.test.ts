import { describe, expect, it } from 'vitest';
import { canSendMarketing, normalizeEmail } from './consent';

describe('canSendMarketing', () => {
  it('allows default opted_in', () => {
    expect(
      canSendMarketing({ email: 'a@b.com', emailPermission: 'opted_in' }),
    ).toEqual({ allow: true });
  });

  it('blocks opted_out', () => {
    const r = canSendMarketing({
      email: 'a@b.com',
      emailPermission: 'opted_out',
    });
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.code).toBe('OPTED_OUT');
  });

  it('blocks suppressions and kill switch', () => {
    expect(
      canSendMarketing({ email: 'a@b.com', suppressed: true }).allow,
    ).toBe(false);
    expect(
      canSendMarketing({ email: 'a@b.com', killSwitch: true }).allow,
    ).toBe(false);
  });

  it('normalizes email', () => {
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });
});
