import { describe, expect, it } from 'vitest';
import { buildIdempotencyKey } from './website-intake';

describe('website intake idempotency', () => {
  it('is stable for same email/company/path/day', () => {
    const a = buildIdempotencyKey({
      email: 'a@x.com',
      company: 'Acme',
      deal_path: 'launch',
      day: '2026-07-24',
    });
    const b = buildIdempotencyKey({
      email: 'A@X.com',
      company: 'acme',
      deal_path: 'launch',
      day: '2026-07-24',
    });
    expect(a).toBe(b);
  });

  it('differs across days', () => {
    const a = buildIdempotencyKey({
      email: 'a@x.com',
      company: 'Acme',
      deal_path: 'launch',
      day: '2026-07-24',
    });
    const b = buildIdempotencyKey({
      email: 'a@x.com',
      company: 'Acme',
      deal_path: 'launch',
      day: '2026-07-25',
    });
    expect(a).not.toBe(b);
  });

  it('prefers client key', () => {
    expect(
      buildIdempotencyKey({
        email: 'a@x.com',
        company: 'Acme',
        deal_path: 'launch',
        client_key: 'client-abc-12345678',
      }),
    ).toBe('client-abc-12345678');
  });
});
