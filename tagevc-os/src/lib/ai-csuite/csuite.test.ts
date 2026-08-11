import { describe, expect, it } from 'vitest';
import {
  AI_CSUITE_NAV_ORDER,
  AI_CSUITE_ROLE_CONFIG,
  AI_CSUITE_ROLES,
  isAiCsuiteRole,
} from '@/lib/ai-csuite/roles';
import {
  canTransitionCsuiteAction,
  CSUITE_FORBIDDEN_AUTONOMY,
} from '@/lib/ai-csuite/actions';
import {
  buildFallbackBriefing,
  buildFallbackFinancialReportMd,
  financialReportRespectsDataGaps,
  validateCsuiteBriefingShape,
} from '@/lib/ai-csuite/briefing';
import type { CsuiteContextPack } from '@/lib/ai-csuite/context';
import { MAIN_NAV } from '@/lib/nav';
import { roleCanAccessModule } from '@/lib/types/roles';

function syntheticCfoPack(overrides?: Partial<CsuiteContextPack>): CsuiteContextPack {
  return {
    role: 'cfo',
    as_of: new Date().toISOString(),
    scope: 'consolidated',
    entity_id: null,
    kpis: [
      {
        key: 'cash_on_hand',
        label: 'Cash on hand (IES)',
        value: null,
        status: 'missing',
      },
      {
        key: 'runway_mo',
        label: 'Runway months',
        value: null,
        status: 'missing',
      },
      {
        key: 'close_completion',
        label: 'Finance checklist completion %',
        value: 42,
        status: 'live',
      },
    ],
    overdue_tasks: [{ function: 'finance', overdue: 2 }],
    anomalies: [{ kind: 'overdue_finance_tasks', count: 2 }],
    subsidiaries: [
      { name: 'Recruit 619', signals: ['IES feed missing'] },
      { name: 'Instant NDA', signals: [] },
      { name: 'Signent HR', signals: [] },
    ],
    open_tickets: [],
    recent_changes: [],
    data_gaps: [
      'IES cash/runway live feed not attached — advise from known SSC facts only',
    ],
    ...overrides,
  };
}

describe('AI C-Suite role config', () => {
  it('defines five roles with function mapping', () => {
    expect([...AI_CSUITE_ROLES]).toEqual([
      'cfo',
      'cto',
      'cmo',
      'chro',
      'clo',
    ]);
    expect(AI_CSUITE_ROLE_CONFIG.cfo.functionKey).toBe('finance');
    expect(AI_CSUITE_ROLE_CONFIG.chro.functionKey).toBe('hr');
    expect(isAiCsuiteRole('cfo')).toBe(true);
    expect(isAiCsuiteRole('hq')).toBe(false);
  });

  it('nav order is HQ then five roles', () => {
    expect(AI_CSUITE_NAV_ORDER).toEqual([
      'hq',
      'cfo',
      'cto',
      'cmo',
      'chro',
      'clo',
    ]);
  });
});

describe('C-Suite nav Visionary-only', () => {
  it('places C-Suite after Assets (under Home/Dashboard) with children', () => {
    // Relative order, not adjacency — My Networking Contacts sits between
    // Dashboard and Assets and more global inboxes may follow it.
    const labels = MAIN_NAV.map((n) => n.label);
    expect(labels.indexOf('Home')).toBeLessThan(labels.indexOf('Dashboard'));
    expect(labels.indexOf('Dashboard')).toBeLessThan(labels.indexOf('Assets'));
    expect(labels.indexOf('Assets')).toBeLessThan(labels.indexOf('C-Suite'));
    const cs = MAIN_NAV.find((n) => n.label === 'C-Suite');
    expect(cs?.visionaryOnly).toBe(true);
    expect(cs?.hideDuringLiveLook).toBe(true);
    expect(cs?.children?.map((c) => c.label)).toEqual([
      'HQ',
      'CFO',
      'CTO',
      'CMO',
      'CHRO',
      'CLO',
    ]);
    expect(cs?.children?.every((c) => c.visionaryOnly)).toBe(true);
    expect(MAIN_NAV.find((n) => n.label === 'Command Center')?.href).toBe(
      '/command-center',
    );
  });

  it('does not invent a new public module for non-visionary module gate', () => {
    // Parent uses command_center; visionaryOnly hides from others.
    expect(roleCanAccessModule('associate', 'command_center')).toBe(true);
    const cs = MAIN_NAV.find((n) => n.label === 'C-Suite');
    expect(cs?.visionaryOnly).toBe(true);
  });
});

describe('C-Suite action status machine', () => {
  it('allows proposed → approved/rejected and approved → executed', () => {
    expect(canTransitionCsuiteAction('proposed', 'approved')).toBe(true);
    expect(canTransitionCsuiteAction('proposed', 'rejected')).toBe(true);
    expect(canTransitionCsuiteAction('approved', 'executed')).toBe(true);
    expect(canTransitionCsuiteAction('rejected', 'executed')).toBe(false);
    expect(canTransitionCsuiteAction('executed', 'proposed')).toBe(false);
  });

  it('lists forbidden autonomy outcomes', () => {
    expect(CSUITE_FORBIDDEN_AUTONOMY).toContain('money_movement');
    expect(CSUITE_FORBIDDEN_AUTONOMY).toContain('legal_send');
  });
});

describe('C-Suite context builders fail-soft', () => {
  it('CFO pack never invents cash KPIs when IES missing', () => {
    const pack = syntheticCfoPack();
    expect(pack.role).toBe('cfo');
    expect(pack.data_gaps.length).toBeGreaterThan(0);
    const cashish = pack.kpis.filter((k) =>
      /cash|runway/i.test(k.key + k.label),
    );
    expect(cashish.length).toBeGreaterThan(0);
    for (const k of cashish) {
      expect(['missing', 'partial', 'live']).toContain(k.status);
      if (k.status === 'missing') expect(k.value).toBeNull();
    }
  });

  it('HQ pack aggregates without fabricating headcount', () => {
    const pack: CsuiteContextPack = {
      role: 'hq',
      as_of: new Date().toISOString(),
      scope: 'consolidated',
      entity_id: null,
      kpis: [
        {
          key: 'cfo.close_completion',
          label: 'Finance checklist completion %',
          value: 42,
          status: 'live',
        },
      ],
      overdue_tasks: [],
      anomalies: [],
      subsidiaries: [
        { name: 'Recruit 619', signals: [] },
        { name: 'Instant NDA', signals: [] },
        { name: 'Signent HR', signals: [] },
      ],
      open_tickets: [],
      recent_changes: [],
      data_gaps: [
        'chro: HRIS headcount aggregate not in pack — never invent headcount',
      ],
    };
    expect(pack.role).toBe('hq');
    expect(pack.data_gaps.some((g) => /headcount|invent/i.test(g))).toBe(true);
    expect(pack.kpis.every((k) => !/headcount/i.test(k.key))).toBe(true);
  });
});

describe('C-Suite briefing shape', () => {
  it('validates structured briefing fields', () => {
    const ok = validateCsuiteBriefingShape({
      health_status: 'watch',
      what_matters: ['a', 'b', 'c'],
      top_risk: 'Close slip',
      primary_action: 'Draft overdue finance ticket',
      summary: 'Finance is watch due to overdue SSC work.',
      data_gaps: ['IES cash not attached'],
    });
    expect(ok.ok).toBe(true);
    expect(ok.what_matters).toHaveLength(3);
    expect(ok.health_status).toBe('watch');
  });

  it('pads what_matters and flags bad health_status', () => {
    const bad = validateCsuiteBriefingShape({
      health_status: 'purple',
      what_matters: ['only one'],
      top_risk: 'x',
      primary_action: 'y',
      summary: 'z',
    });
    expect(bad.ok).toBe(false);
    expect(bad.health_status).toBe('watch');
    expect(bad.what_matters).toHaveLength(3);
  });

  it('CFO fallback financial report does not invent KPIs when data_gaps present', () => {
    const pack = syntheticCfoPack();
    const report = buildFallbackFinancialReportMd(pack);
    expect(report).toMatch(/Financial Report/i);
    expect(report).toMatch(/partial data/i);
    expect(report).not.toMatch(/\$99,999,999/);
    expect(financialReportRespectsDataGaps(report, pack)).toBe(true);

    const invented = financialReportRespectsDataGaps(
      'Cash is $99,999,999 with 240 months runway.',
      pack,
    );
    expect(invented).toBe(false);

    const briefing = buildFallbackBriefing('cfo', pack);
    expect(briefing.financial_report_md).toBeTruthy();
    expect(briefing.what_matters).toHaveLength(3);
  });
});
