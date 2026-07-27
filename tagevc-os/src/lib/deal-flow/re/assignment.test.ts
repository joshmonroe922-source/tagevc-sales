import { describe, expect, it } from 'vitest';
import {
  filterReDealsAssignedToSourcer,
  isReDealAssignedToSourcer,
  reSourcerMatchesAssignee,
} from '@/lib/deal-flow/re/assignment';

describe('Sourcer (re_sourcer) assignment filter', () => {
  it('matches role-label and name sourcers', () => {
    expect(reSourcerMatchesAssignee('Sourcer')).toBe(true);
    expect(reSourcerMatchesAssignee('RE Sourcer')).toBe(true);
    expect(reSourcerMatchesAssignee('RE Sourcer — Resi')).toBe(true);
    expect(reSourcerMatchesAssignee('RE Sourcer — CRE')).toBe(true);
    expect(reSourcerMatchesAssignee('Partner')).toBe(false);
    expect(reSourcerMatchesAssignee(null)).toBe(false);
    expect(reSourcerMatchesAssignee('Josh Monroe', 'Josh Monroe')).toBe(true);
    expect(reSourcerMatchesAssignee('Sarah Chen', 'Josh Monroe')).toBe(false);
  });

  it('filters deals for re_sourcer only', () => {
    const deals = [
      { re_id: 'RE-001', sourcer: 'Partner' },
      { re_id: 'RE-002', sourcer: 'RE Sourcer — Resi' },
      { re_id: 'RE-003', sourcer: null },
    ];
    expect(
      filterReDealsAssignedToSourcer(deals, {
        role: 're_sourcer',
        profileFullName: 'Josh Monroe',
      }).map((d) => d.re_id),
    ).toEqual(['RE-002']);

    expect(
      filterReDealsAssignedToSourcer(deals, {
        role: 'visionary',
      }),
    ).toEqual(deals);
  });

  it('isReDealAssignedToSourcer is open for non-scoped roles', () => {
    expect(
      isReDealAssignedToSourcer({
        role: 'partner',
        deal: { sourcer: 'Partner' },
      }),
    ).toBe(true);
  });
});
