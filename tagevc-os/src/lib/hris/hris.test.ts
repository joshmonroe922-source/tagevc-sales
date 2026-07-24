import { describe, expect, it } from 'vitest';
import {
  addDays,
  assertRevokeFirstOrder,
  completionPct,
  computeDueDate,
  isStepOverdue,
  nextMonday,
} from './timing';
import { buildRecruitAssignment, recruitPeopleHref } from './recruit-hook';
import { templateSlugFor } from './runs';

describe('hris timing', () => {
  it('computes due dates from start_date offsets', () => {
    expect(
      computeDueDate({
        timing_anchor: 'start_date',
        offset_days: -7,
        start_date: '2026-08-03',
      }),
    ).toBe('2026-07-27');
    expect(
      computeDueDate({
        timing_anchor: 'start_date',
        offset_days: 30,
        start_date: '2026-08-03',
      }),
    ).toBe('2026-09-02');
  });

  it('uses offer_accepted and end_date anchors', () => {
    expect(
      computeDueDate({
        timing_anchor: 'offer_accepted',
        offset_days: 2,
        offer_accepted_at: '2026-07-20',
      }),
    ).toBe('2026-07-22');
    expect(
      computeDueDate({
        timing_anchor: 'end_date',
        offset_days: 0,
        end_date: '2026-09-15',
      }),
    ).toBe('2026-09-15');
  });

  it('detects overdue pending steps', () => {
    expect(
      isStepOverdue(
        { due_at: '2026-07-01', status: 'pending' },
        '2026-07-24',
      ),
    ).toBe(true);
    expect(
      isStepOverdue({ due_at: '2026-07-01', status: 'done' }, '2026-07-24'),
    ).toBe(false);
  });

  it('computes completion percent', () => {
    expect(
      completionPct([
        { status: 'done' },
        { status: 'pending' },
        { status: 'waived' },
        { status: 'na' },
      ]),
    ).toBe(75);
  });

  it('nextMonday returns a Monday', () => {
    const d = nextMonday(new Date('2026-07-24T12:00:00Z'));
    expect(new Date(`${d}T12:00:00Z`).getUTCDay()).toBe(1);
  });

  it('addDays works', () => {
    expect(addDays('2026-07-24', 7)).toBe('2026-07-31');
  });
});

describe('hris offboarding order', () => {
  it('requires access revoke before equipment', () => {
    expect(
      assertRevokeFirstOrder([
        { category: 'Access revoke', sort_order: 40, destructive: true },
        { category: 'Equipment', sort_order: 80, destructive: false },
      ]),
    ).toBe(true);
    expect(
      assertRevokeFirstOrder([
        { category: 'Equipment', sort_order: 20, destructive: false },
        { category: 'Access revoke', sort_order: 80, destructive: true },
      ]),
    ).toBe(false);
  });
});

describe('recruit assignment hook', () => {
  it('only attaches for ENT-R619', () => {
    expect(buildRecruitAssignment('ENT-FIRM')).toBeNull();
    const a = buildRecruitAssignment('ENT-R619');
    expect(a?.status).toBe('pending_link');
    expect(a?.portal_hint).toContain('recruit619');
    expect(recruitPeopleHref(a)).toContain('recruit619.com');
  });
});

describe('template slug', () => {
  it('maps entity to r619 templates', () => {
    expect(templateSlugFor('onboarding', 'ENT-R619')).toBe(
      'r619-onboarding-v1',
    );
    expect(templateSlugFor('offboarding', 'ENT-R619')).toBe(
      'r619-offboarding-v1',
    );
  });
});
