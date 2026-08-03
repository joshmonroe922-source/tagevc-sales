import { describe, expect, it } from 'vitest';
import { scoreEngagement } from './engagement';

describe('engagement score', () => {
  it('weights clicks and replies over opens', () => {
    expect(scoreEngagement({ openCount: 1 })).toBe(1);
    expect(scoreEngagement({ clickCount: 1 })).toBe(3);
    expect(scoreEngagement({ replied: true, clickCount: 1 })).toBe(8);
  });
});
