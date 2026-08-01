import { describe, expect, it } from 'vitest';
import { FIRM_TRAINING_CATALOG } from '@/lib/training/catalog';

describe('firm training catalog', () => {
  it('has scaffold tracks plus R619 live pointer', () => {
    expect(FIRM_TRAINING_CATALOG.length).toBeGreaterThanOrEqual(4);
    expect(FIRM_TRAINING_CATALOG.some((t) => t.status === 'live')).toBe(true);
    expect(FIRM_TRAINING_CATALOG.every((t) => t.id && t.title)).toBe(true);
  });
});
