import { describe, expect, it } from 'vitest';
import {
  isJoshMonroeEmail,
  isLaurenMonroeEmail,
  JOSH_MONROE_JOB_TITLE,
  LAUREN_MONROE_JOB_TITLE,
  staffJobTitleForEmail,
} from '@/lib/org/staff-titles';

describe('staff titles', () => {
  it('uses Principal Strategist spelling for Lauren', () => {
    expect(LAUREN_MONROE_JOB_TITLE).toBe('Principal Strategist');
    expect(LAUREN_MONROE_JOB_TITLE.toLowerCase()).not.toContain('principle');
    expect(isLaurenMonroeEmail('lauren@tagevc.com')).toBe(true);
    expect(isLaurenMonroeEmail('joshmonroe@tagevc.com')).toBe(false);
  });

  it('uses Founder / CEO only for Josh emails', () => {
    expect(JOSH_MONROE_JOB_TITLE).toBe('Founder / CEO');
    expect(isJoshMonroeEmail('joshmonroe@tagevc.com')).toBe(true);
    expect(isJoshMonroeEmail('joshmonroe@recruit619.com')).toBe(true);
    expect(isJoshMonroeEmail('dennis@recruit619.com')).toBe(false);
    expect(staffJobTitleForEmail('joshmonroe@tagevc.com')).toBe(
      'Founder / CEO',
    );
    expect(staffJobTitleForEmail('dennis@recruit619.com', 'Recruiter')).toBe(
      'Recruiter',
    );
  });
});
