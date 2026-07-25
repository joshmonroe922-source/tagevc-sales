import { describe, expect, it } from 'vitest';
import {
  CLEANUP_CONFIRM_PHRASE,
  PROTECTED_ENTITY_IDS,
  SAMPLE_ENTITY_IDS,
} from './demo-data-cleanup-shared';

describe('demo data cleanup protect list', () => {
  it('protects core operating entities', () => {
    expect(PROTECTED_ENTITY_IDS.has('ENT-FIRM')).toBe(true);
    expect(PROTECTED_ENTITY_IDS.has('ENT-R619')).toBe(true);
    expect(PROTECTED_ENTITY_IDS.has('ENT-INDA')).toBe(true);
    expect(PROTECTED_ENTITY_IDS.has('ENT-001')).toBe(false);
  });

  it('samples are distinct from protected', () => {
    for (const id of SAMPLE_ENTITY_IDS) {
      expect(PROTECTED_ENTITY_IDS.has(id)).toBe(false);
    }
  });

  it('uses exact confirmation phrase', () => {
    expect(CLEANUP_CONFIRM_PHRASE).toBe('DELETE DEMO DATA');
  });
});
