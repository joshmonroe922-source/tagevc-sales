import { describe, expect, it } from 'vitest';

import {
  compareOperatorTodos,
  sscFunctionsForRole,
  summarizeOperatorTodos,
  type OperatorTodoItem,
} from '@/lib/todo/operator-todo-list';
import { flattenNavItems, MAIN_NAV } from '@/lib/nav';

describe('operator todo list', () => {
  it('sorts overdue before dated open items', () => {
    const items: OperatorTodoItem[] = [
      {
        id: 'b',
        source: 'lead_task',
        source_label: 'Lead task',
        title: 'Later',
        subtitle: null,
        status: 'Open',
        due_date: '2026-08-01',
        href: '/',
        is_overdue: false,
      },
      {
        id: 'a',
        source: 'ssc_checklist',
        source_label: 'SSC checklist',
        title: 'Overdue close',
        subtitle: null,
        status: 'not_started',
        due_date: '2026-07-01',
        href: '/',
        is_overdue: true,
      },
    ];
    expect([...items].sort(compareOperatorTodos).map((i) => i.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('summarizes SSC vs pipeline vs follow-ups (no tickets)', () => {
    const list = summarizeOperatorTodos([
      {
        id: '1',
        source: 'ssc_checklist',
        source_label: 'SSC checklist',
        title: 'Close books',
        subtitle: null,
        status: 'not_started',
        due_date: null,
        href: '/shared-services/checklists',
        is_overdue: false,
      },
      {
        id: '2',
        source: 'lead_task',
        source_label: 'Lead task',
        title: 'Call founder',
        subtitle: null,
        status: 'Open',
        due_date: null,
        href: '/deal-flow/vc/leads/LD-1',
        is_overdue: false,
      },
      {
        id: '3',
        source: 'lead_followup',
        source_label: 'Lead follow-up',
        title: 'Send NDA',
        subtitle: null,
        status: 'Qualified',
        due_date: null,
        href: '/deal-flow/vc/leads/LD-1',
        is_overdue: false,
      },
    ]);
    expect(list.counts).toEqual({
      total: 3,
      ssc: 1,
      pipeline: 1,
      followups: 1,
    });
    expect(list.items.every((i) => !i.source.includes('ticket'))).toBe(true);
  });

  it('scopes SSC functions for Finance operator', () => {
    expect(sscFunctionsForRole('ssc_finance')).toEqual(['finance']);
    expect(sscFunctionsForRole('counsel_ops')).toEqual(['legal']);
    expect(sscFunctionsForRole('visionary')).toEqual([
      'finance',
      'hr',
      'it',
      'marketing',
      'legal',
    ]);
  });
});

describe('to-do nav', () => {
  it('adds SSC Task List under Shared Services and keeps Help Desk off left nav', () => {
    const flat = flattenNavItems(MAIN_NAV);
    expect(flat.some((n) => n.href === '/to-do' && n.label === 'SSC Task List')).toBe(
      true,
    );
    expect(flat.some((n) => n.href === '/help-desk')).toBe(false);
    expect(flat.some((n) => n.label === 'Help Desk')).toBe(false);
  });
});
