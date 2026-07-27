import { describe, expect, it } from 'vitest';
import {
  filterMaTargetsAssignedToAssociate,
  isMaTargetAssignedToAssociate,
  maOwnerMatchesAssociate,
} from '@/lib/deal-flow/ma/assignment';

describe('M&A Associate assignment filter', () => {
  it('matches role-label and name owners', () => {
    expect(maOwnerMatchesAssociate('Associate')).toBe(true);
    expect(maOwnerMatchesAssociate('M&A Associate')).toBe(true);
    expect(maOwnerMatchesAssociate('Partner')).toBe(false);
    expect(maOwnerMatchesAssociate(null)).toBe(false);
    expect(maOwnerMatchesAssociate('Josh Monroe', 'Josh Monroe')).toBe(true);
    expect(maOwnerMatchesAssociate('Sarah Chen', 'Josh Monroe')).toBe(false);
  });

  it('filters targets for ma_associate only', () => {
    const targets = [
      { ma_id: 'MA-001', owner: 'Partner' },
      { ma_id: 'MA-002', owner: 'Associate' },
      { ma_id: 'MA-003', owner: null },
    ];
    expect(
      filterMaTargetsAssignedToAssociate(targets, {
        role: 'ma_associate',
        profileFullName: 'Josh Monroe',
      }).map((t) => t.ma_id),
    ).toEqual(['MA-002']);

    expect(
      filterMaTargetsAssignedToAssociate(targets, {
        role: 'visionary',
      }),
    ).toEqual(targets);
  });

  it('isMaTargetAssignedToAssociate is open for non-scoped roles', () => {
    expect(
      isMaTargetAssignedToAssociate({
        role: 'partner',
        target: { owner: 'Partner' },
      }),
    ).toBe(true);
  });
});
