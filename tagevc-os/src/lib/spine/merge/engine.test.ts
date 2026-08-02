import { describe, expect, it } from 'vitest';
import {
  contactDedupeScore,
  decideMergeField,
} from '@/lib/spine/merge/engine';

describe('spine merge engine', () => {
  it('writes empty unlocked fields (R1)', () => {
    const d = decideMergeField({
      field: 'title',
      value: 'CEO',
      source: 'apollo',
      existingValue: null,
    });
    expect(d.action).toBe('write');
  });

  it('suggests when locked / user-owned (R2)', () => {
    const d = decideMergeField({
      field: 'primary_email',
      value: 'new@acme.com',
      source: 'apollo',
      emailStatus: 'valid',
      existingValue: 'old@acme.com',
      existingSource: 'user',
      existingLocked: true,
    });
    expect(d.action).toBe('suggest');
  });

  it('blocks unverified email writes (R3)', () => {
    const d = decideMergeField({
      field: 'primary_email',
      value: 'x@acme.com',
      source: 'hunter',
      emailStatus: 'unknown',
    });
    expect(d.action).toBe('skip');
  });

  it('prefers higher waterfall rank when verified (R4)', () => {
    const d = decideMergeField({
      field: 'title',
      value: 'CTO',
      source: 'hunter',
      existingValue: 'Engineer',
      existingSource: 'website',
    });
    expect(d.action).toBe('write');
  });

  it('dedupes by email then linkedin then name+account (R7)', () => {
    expect(
      contactDedupeScore(
        { email: 'a@x.com' },
        { email: 'a@x.com' },
      ),
    ).toBe(1);
    expect(
      contactDedupeScore(
        { linkedin: 'https://linkedin.com/in/a' },
        { linkedin: 'https://linkedin.com/in/a' },
      ),
    ).toBeGreaterThan(0.9);
    expect(
      contactDedupeScore(
        { fullName: 'Jane Doe', accountId: '1' },
        { fullName: 'Jane Doe', accountId: '1' },
      ),
    ).toBeGreaterThan(0.9);
  });
});
