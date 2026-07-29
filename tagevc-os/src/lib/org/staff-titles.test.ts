import { describe, expect, it } from 'vitest';
import {
  isLaurenMonroeEmail,
  LAUREN_MONROE_JOB_TITLE,
} from '@/lib/org/staff-titles';

describe('staff titles', () => {
  it('uses Principal Strategist spelling for Lauren', () => {
    expect(LAUREN_MONROE_JOB_TITLE).toBe('Principal Strategist');
    expect(LAUREN_MONROE_JOB_TITLE.toLowerCase()).not.toContain('principle');
    expect(isLaurenMonroeEmail('lauren@tagevc.com')).toBe(true);
    expect(isLaurenMonroeEmail('joshmonroe@tagevc.com')).toBe(false);
  });
});
