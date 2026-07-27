import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSscAiBriefing, draftAuditFinding } from './ai';
import { auditItemLibrary } from './audit-library';
import {
  periodBounds,
  shiftPeriod,
  classifyTimeNav,
  normalizeTimeNav,
  compareSscTaskUrgency,
  classifySscAttention,
  addDaysToDateStr,
} from './period';
import { partitionFunctionHomeGlance } from './function-home-glance';
import { resolveScopeEntityIds } from './scope';
import { libraryStats, templatesFor, SSC_TASK_LIBRARY } from './task-library';
import {
  SSC_FUNCTIONS,
  SSC_PERIOD_TYPES,
  SSC_PHASE66_CONTRACT,
} from './types';

describe('SSC Phase 66 checklist libraries', () => {
  it('has practical coverage across all functions and periods', () => {
    const stats = libraryStats();
    expect(stats.total).toBeGreaterThanOrEqual(70);
    for (const fn of SSC_FUNCTIONS) {
      expect(stats.by_function[fn] ?? 0).toBeGreaterThanOrEqual(12);
    }
    for (const p of SSC_PERIOD_TYPES) {
      expect(stats.by_period[p] ?? 0).toBeGreaterThanOrEqual(5);
    }
  });

  it('templatesFor filters correctly', () => {
    const monthlyFinance = templatesFor('finance', 'monthly');
    expect(monthlyFinance.every((t) => t.function === 'finance')).toBe(true);
    expect(monthlyFinance.every((t) => t.period_type === 'monthly')).toBe(
      true,
    );
    expect(monthlyFinance.length).toBeGreaterThanOrEqual(4);
  });

  it('startup and annual audit libraries are complete', () => {
    expect(auditItemLibrary('startup').length).toBeGreaterThanOrEqual(7);
    expect(auditItemLibrary('annual').length).toBeGreaterThanOrEqual(7);
    expect(
      auditItemLibrary('startup').some((i) => i.function_key === 'legal'),
    ).toBe(true);
  });
});

describe('SSC period helpers', () => {
  it('builds weekly/monthly/quarterly/annual keys', () => {
    const ref = new Date(2026, 6, 15); // Jul 15 2026
    expect(periodBounds('monthly', ref).period_key).toBe('2026-07');
    expect(periodBounds('quarterly', ref).period_key).toBe('2026-Q3');
    expect(periodBounds('annual', ref).period_key).toBe('2026');
    expect(periodBounds('weekly', ref).period_key).toMatch(/^2026-W\d{2}$/);
  });

  it('shifts and classifies time nav', () => {
    const ref = new Date(2026, 6, 15);
    const next = shiftPeriod('monthly', ref, 1);
    expect(periodBounds('monthly', next).period_key).toBe('2026-08');
    const b = periodBounds('monthly', ref);
    expect(classifyTimeNav(b.period_start, b.period_end, ref)).toBe('current');
    expect(classifyTimeNav('2020-01-01', '2020-01-31', ref)).toBe('past');
    expect(classifyTimeNav('2099-01-01', '2099-01-31', ref)).toBe('future');
  });

  it('normalizes past/current to active operator view', () => {
    expect(normalizeTimeNav('past')).toBe('active');
    expect(normalizeTimeNav('current')).toBe('active');
    expect(normalizeTimeNav('active')).toBe('active');
    expect(normalizeTimeNav(undefined)).toBe('active');
    expect(normalizeTimeNav('future')).toBe('future');
  });

  it('sorts most overdue first, then due soon', () => {
    const rows = [
      { is_overdue: false, due_date: '2026-07-20' },
      { is_overdue: true, due_date: '2026-07-01' },
      { is_overdue: true, due_date: '2026-06-15' },
      { is_overdue: false, due_date: null },
      { is_overdue: false, due_date: '2026-07-10' },
    ];
    const sorted = [...rows].sort(compareSscTaskUrgency);
    expect(sorted.map((r) => r.due_date)).toEqual([
      '2026-06-15',
      '2026-07-01',
      '2026-07-10',
      '2026-07-20',
      null,
    ]);
  });

  it('addDaysToDateStr stays on calendar days', () => {
    expect(addDaysToDateStr('2026-07-26', 7)).toBe('2026-08-02');
    expect(addDaysToDateStr('2026-07-26', 5)).toBe('2026-07-31');
  });

  it('classifies Needs attention beyond overdue/due today', () => {
    const today = '2026-07-26';
    const period_end = '2026-07-31';

    expect(
      classifySscAttention({
        status: 'not_started',
        due_date: '2026-07-20',
        today,
        period_end,
      }).attention_kind,
    ).toBe('overdue');

    expect(
      classifySscAttention({
        status: 'in_progress',
        due_date: '2026-07-26',
        today,
        period_end,
      }).attention_kind,
    ).toBe('due_today');

    // Jul 31 is within 7 days of Jul 26 — due soon (Josh screenshot case)
    expect(
      classifySscAttention({
        status: 'not_started',
        due_date: '2026-07-31',
        today,
        period_end,
      }).attention_kind,
    ).toBe('due_soon');

    // Dated past period end still counts as open at-risk on the active period
    expect(
      classifySscAttention({
        status: 'not_started',
        due_date: '2026-08-10',
        today: '2026-07-01',
        period_end: '2026-07-31',
      }),
    ).toMatchObject({ needs_attention: true, attention_kind: 'open' });

    expect(
      classifySscAttention({
        status: 'not_started',
        due_date: '2026-07-25',
        today: '2026-07-01',
        period_end: '2026-07-31',
      }).attention_kind,
    ).toBe('due_this_period');

    expect(
      classifySscAttention({
        status: 'blocked',
        due_date: null,
        today,
        period_end,
      }).attention_kind,
    ).toBe('open');

    expect(
      classifySscAttention({
        status: 'done',
        due_date: '2026-07-20',
        today,
        period_end,
      }).needs_attention,
    ).toBe(false);
  });
});

describe('SSC function-home glance', () => {
  it('puts due-soon and open unfinished period tasks in Needs attention', () => {
    // Josh screenshot: Overdue 0, Open 20, due 2026-07-31 on Jul 26 → was empty
    // under overdue/due-today-only; must surface as due_soon / open.
    const glance = partitionFunctionHomeGlance({
      today: '2026-07-26',
      period_end: '2026-07-31',
      companyName: () => 'Tage VC',
      tasks: [
        {
          id: '1',
          title: 'Month-end close',
          status: 'not_started',
          due_date: '2026-07-31',
          entity_id: 'ENT-FIRM',
        },
        {
          id: '2',
          title: 'Access review',
          status: 'in_progress',
          due_date: null,
          entity_id: 'ENT-R619',
        },
        {
          id: '3',
          title: 'Done already',
          status: 'done',
          due_date: '2026-07-20',
          entity_id: 'ENT-FIRM',
        },
        {
          id: '4',
          title: 'Late invoice',
          status: 'not_started',
          due_date: '2026-07-01',
          entity_id: 'ENT-INDA',
        },
      ],
    });

    expect(glance.open_count).toBe(3);
    expect(glance.needs_attention.map((t) => t.id)).toEqual(['4', '1', '2']);
    expect(glance.needs_attention[0].attention_kind).toBe('overdue');
    expect(glance.needs_attention[1].attention_kind).toBe('due_soon');
    expect(glance.needs_attention[2].attention_kind).toBe('open');
    expect(glance.overdue_count).toBe(1);
    expect(glance.due_soon_count).toBe(1);
  });
});

describe('SSC scope', () => {
  it('resolves parent / subs / parent_subs / single', () => {
    expect(resolveScopeEntityIds('parent')).toEqual(['ENT-FIRM']);
    expect(resolveScopeEntityIds('subs')).toEqual(
      expect.arrayContaining(['ENT-R619', 'ENT-INDA']),
    );
    expect(resolveScopeEntityIds('parent_subs')).toEqual(
      expect.arrayContaining(['ENT-FIRM', 'ENT-R619', 'ENT-INDA']),
    );
    expect(resolveScopeEntityIds('single', 'ENT-INDA')).toEqual(['ENT-INDA']);
  });
});

describe('SSC AI drafts', () => {
  it('builds briefing with guardrails', () => {
    const briefing = buildSscAiBriefing({
      tasks: [
        {
          id: '1',
          instance_id: 'i',
          template_key: 'fin.m.close',
          title: 'Month-end close',
          description: null,
          function_key: 'finance',
          period_type: 'monthly',
          owner_role: 'service_lead',
          entity_id: 'ENT-FIRM',
          company_name: 'Tage Venture Capital',
          status: 'not_started',
          due_date: '2020-01-01',
          completed_at: null,
          completed_by: null,
          evidence_ticket_id: null,
          evidence_url: null,
          evidence_note: null,
          automation_source: 'auto',
          risk_level: 'critical',
          sort_order: 0,
          ai_suggestion: null,
          is_overdue: true,
        },
      ],
      monitoring: [
        {
          function_key: 'all',
          completion_pct: 10,
          total_tasks: 1,
          done_tasks: 0,
          overdue_tasks: 1,
          blocked_tasks: 0,
          waived_tasks: 0,
          audit_open_items: 2,
          risk_badge: 'red',
          trend_label: 'Behind',
        },
      ],
      periodLabel: 'Monthly 2026-07',
      functionFilter: 'all',
    });
    expect(briefing.summary).toContain('overdue');
    expect(briefing.guardrails).toContain('No autonomous money movement');
    expect(briefing.recommended_order[0]).toContain('OVERDUE');
    expect(briefing.provider).toBe('rules');
  });

  it('drafts audit findings as human-confirm drafts', () => {
    const draft = draftAuditFinding({
      title: 'Access recertification',
      company_name: 'Recruit 619',
      status: 'not_started',
    });
    expect(draft).toContain('draft');
    expect(draft).toContain('Human confirmation');
  });
});

describe('SSC Phase 66 SQL', () => {
  it('is additive and never touches os_store_snapshots', () => {
    const sql = readFileSync(
      join(process.cwd(), 'supabase/phase66_ssc_checklist_audit.sql'),
      'utf8',
    );
    expect(sql).not.toContain('os_store_snapshots');
    expect(sql).toContain('os_ssc_checklist_instances');
    expect(sql).toContain('os_ssc_audits');
    expect(sql).toContain('os_ssc_sync_snapshots');
    expect(sql).toMatch(/append-only/i);
    expect(SSC_PHASE66_CONTRACT).toContain('phase66');
    expect(SSC_TASK_LIBRARY.length).toBeGreaterThan(70);
  });
});
