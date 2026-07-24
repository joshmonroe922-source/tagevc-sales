import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSscAiBriefing, draftAuditFinding } from './ai';
import { auditItemLibrary } from './audit-library';
import { periodBounds, shiftPeriod, classifyTimeNav } from './period';
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
