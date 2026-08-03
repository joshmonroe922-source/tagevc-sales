import { describe, expect, it } from 'vitest';
import { decideMergeField } from '@/lib/spine/merge/engine';

describe('suggestion accept merge rules (C8)', () => {
  it('user-owned fields stay suggest-only for agents', () => {
    const d = decideMergeField({
      field: 'title',
      value: 'VP Sales',
      source: 'apollo',
      existingValue: 'Director',
      existingSource: 'user',
      locked: false,
      confidence: 0.8,
    });
    expect(d.action).toBe('suggest');
  });

  it('empty values skip', () => {
    const d = decideMergeField({
      field: 'title',
      value: '  ',
      source: 'agent',
    });
    expect(d.action).toBe('skip');
  });
});
