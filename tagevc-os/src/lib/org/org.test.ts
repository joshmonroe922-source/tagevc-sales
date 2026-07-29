import { describe, expect, it } from 'vitest';
import {
  buildOrgForest,
  collectDirectReportIds,
  collectSubtreeIds,
  ownerIdsForEosView,
  wouldCreateCycle,
  type OrgProfileNode,
} from '@/lib/org/tree';
import {
  buildMonthlyImpact,
  fullyLoadedAnnual,
} from '@/lib/hire/impact';
import { buildL10DocBody, buildL10WordHtml } from '@/lib/eos/l10-meetings';

function p(
  partial: Partial<OrgProfileNode> & Pick<OrgProfileNode, 'id' | 'email'>,
): OrgProfileNode {
  return {
    full_name: partial.full_name ?? partial.email,
    job_title: partial.job_title ?? null,
    role: partial.role ?? 'associate',
    entity_id: partial.entity_id ?? 'ENT-R619',
    manager_profile_id: partial.manager_profile_id ?? null,
    avatar_url: null,
    active: partial.active ?? true,
    ...partial,
  };
}

describe('org tree', () => {
  const people = [
    p({ id: 'a', email: 'a@x', full_name: 'A', job_title: 'CEO' }),
    p({
      id: 'b',
      email: 'b@x',
      full_name: 'B',
      job_title: 'Lead',
      manager_profile_id: 'a',
    }),
    p({
      id: 'c',
      email: 'c@x',
      full_name: 'C',
      job_title: 'Rep',
      manager_profile_id: 'b',
    }),
  ];

  it('builds forest with children', () => {
    const forest = buildOrgForest(people);
    expect(forest).toHaveLength(1);
    expect(forest[0].id).toBe('a');
    expect(forest[0].children[0].id).toBe('b');
    expect(forest[0].children[0].children[0].id).toBe('c');
  });

  it('zooms to subtree', () => {
    const forest = buildOrgForest(people, 'b');
    expect(forest).toHaveLength(1);
    expect(forest[0].id).toBe('b');
    expect(forest[0].children[0].id).toBe('c');
  });

  it('collects subtree and direct reports', () => {
    expect([...collectSubtreeIds(people, 'a')].sort()).toEqual(['a', 'b', 'c']);
    expect([...collectDirectReportIds(people, 'a')]).toEqual(['b']);
  });

  it('filters EOS owners by view mode', () => {
    expect([...ownerIdsForEosView('me', people, 'b')!]).toEqual(['b']);
    const team = ownerIdsForEosView('team', people, 'b')!;
    expect(team.has('b')).toBe(true);
    expect(team.has('c')).toBe(true);
    expect(ownerIdsForEosView('entity', people, 'b')).toBeNull();
  });

  it('detects cycles', () => {
    expect(wouldCreateCycle(people, 'a', 'c')).toBe(true);
    expect(wouldCreateCycle(people, 'c', 'a')).toBe(false);
  });
});

describe('hire impact', () => {
  it('computes fully loaded + monthly curve', () => {
    const annual = fullyLoadedAnnual({
      base_salary_annual: 100000,
      burden_pct: 0.3,
      tools_annual: 2400,
    });
    expect(annual).toBe(132400);
    const months = buildMonthlyImpact({
      start_month: '2026-07',
      months: 3,
      base_salary_annual: 120000,
      burden_pct: 0.3,
      tools_annual: 1200,
      recruiting_one_time: 5000,
    });
    expect(months).toHaveLength(3);
    expect(months[0].recruiting).toBe(5000);
    expect(months[1].recruiting).toBe(0);
    expect(months[2].cumulative).toBeGreaterThan(months[0].cumulative);
  });
});

describe('L10 doc', () => {
  it('builds markdown + word html', () => {
    const body = buildL10DocBody({
      title: '2026-W31 · Test L10',
      weekKey: '2026-W31',
      entityId: 'ENT-R619',
      ownerName: 'Lead',
      snapshot: {
        rocks: [{ title: 'Rock 1', status: 'on_track' }],
        issues: [],
        todos: [],
        scorecard: [{ label: 'NPS', actual: 40, goal: 50, on_track: false }],
      },
      notesBody: 'Segue notes',
    });
    expect(body).toContain('Rock 1');
    expect(body).toContain('Segue notes');
    const html = buildL10WordHtml(body, 'Test');
    expect(html).toContain('WordDocument');
    expect(html).toContain('<h1>');
  });
});
