import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FINANCE_REQUEST_TEMPLATES,
  IES_BOUNDARY,
  companyFinanceHref,
  financeTicketHref,
  labelFinanceFeedStatus,
  splitCloseChecklists,
} from '@/lib/shared-services/finance-ops-phase62';
import {
  HR_POLICY_SKELETON,
  HR_REQUEST_TEMPLATES,
  hrChecklistPacks,
  hrTicketHref,
  mapProfileToRosterPerson,
} from '@/lib/shared-services/hr-ops-phase62';

describe('Phase 62 Finance + HR ops depth', () => {
  it('keeps IES as system of record and never automates money', () => {
    expect(IES_BOUNDARY.systemOfRecord).toMatch(/IES|Intuit/i);
    expect(IES_BOUNDARY.neverAutomated).toEqual(
      expect.arrayContaining([
        'Money movement',
        'Silent IES writes',
        'Auto-approve of financial mutations',
      ]),
    );
  });

  it('splits month-end and year-end checklists', () => {
    const { month_end, year_end } = splitCloseChecklists([
      {
        entity_id: null,
        close_kind: 'month_end',
        period_key: '2026-07',
        item_key: 'bank_rec',
        item_label: 'Bank rec',
        status: 'open',
        created_at: '2026-07-01',
      },
      {
        entity_id: null,
        close_kind: 'year_end',
        period_key: '2026',
        item_key: 'year_end_accruals',
        item_label: 'Accruals',
        status: 'open',
        created_at: '2026-07-01',
      },
    ]);
    expect(month_end).toHaveLength(1);
    expect(year_end).toHaveLength(1);
  });

  it('builds finance and HR ticket deep links with company names in UI helpers', () => {
    expect(financeTicketHref('fin_anomaly_review', 'ENT-R619')).toContain(
      'service=Finance',
    );
    expect(financeTicketHref('fin_anomaly_review', 'ENT-R619')).toContain(
      'template=fin_anomaly_review',
    );
    expect(companyFinanceHref('ENT-R619')).toBe('/entities/ENT-R619#financials');
    expect(hrTicketHref('hr_new_hire')).toContain('service=HR');
    expect(FINANCE_REQUEST_TEMPLATES.length).toBeGreaterThan(0);
    expect(HR_REQUEST_TEMPLATES.length).toBeGreaterThan(0);
    expect(labelFinanceFeedStatus('missing')).toBe('Waiting on books feed');
  });

  it('maps roster people with company display names', () => {
    const person = mapProfileToRosterPerson({
      id: 'u1',
      email: 'a@example.com',
      full_name: 'Ada',
      role: 'coo',
      entity_id: 'ENT-R619',
      active: true,
    });
    expect(person.company_name).toBe('Recruit 619');
    expect(person.role_label.length).toBeGreaterThan(0);
  });

  it('exposes modular JML packs and policy skeleton', () => {
    const packs = hrChecklistPacks('ENT-FIRM');
    expect(packs.some((p) => p.lifecycle === 'joiner')).toBe(true);
    expect(packs.some((p) => p.lifecycle === 'leaver')).toBe(true);
    expect(packs.some((p) => p.audience === 'outsourced_hr')).toBe(true);
    expect(HR_POLICY_SKELETON.length).toBeGreaterThanOrEqual(3);
  });

  it('wires Phase 62 SQL + UI surfaces', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/phase62_finance_hr_ops.sql'),
      'utf8',
    );
    const financeUi = readFileSync(
      resolve(
        process.cwd(),
        'src/components/shared-services/finance-control-plane-client.tsx',
      ),
      'utf8',
    );
    const hrPage = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/shared-services/hr/page.tsx'),
      'utf8',
    );
    const hrDepth = readFileSync(
      resolve(
        process.cwd(),
        'src/components/shared-services/hr-ops-depth-client.tsx',
      ),
      'utf8',
    );
    const createTicket = readFileSync(
      resolve(
        process.cwd(),
        'src/components/shared-services/create-ticket-form.tsx',
      ),
      'utf8',
    );

    expect(sql).toContain('os_ies_finance_feed');
    expect(sql).toContain('seed_finance_year_end_checklist_phase62');
    expect(sql).toContain('os_ss_request_templates_phase62');
    expect(sql).toContain('money');
    expect(financeUi).toContain('IES_BOUNDARY');
    expect(financeUi).toContain('splitCloseChecklists');
    expect(financeUi).toContain('Finance & Accounting');
    expect(financeUi).toContain('portfolioBridge');
    expect(hrPage).toContain('getHrOpsBundlePhase62');
    expect(hrPage).toContain('HrOpsDepthClient');
    expect(hrDepth).toContain('People roster');
    expect(hrDepth).toContain('Joiner');
    expect(hrDepth).toContain('CompanySelect');
    expect(createTicket).toContain('prefill');
    expect(createTicket).toContain('FINANCE_REQUEST_TEMPLATES');
    expect(createTicket).toContain('CompanySelect');
    expect(createTicket).toContain('entityDisplayName');

    const hrServer = readFileSync(
      resolve(
        process.cwd(),
        'src/lib/shared-services/hr-ops-phase62-server.ts',
      ),
      'utf8',
    );
    expect(hrServer).toContain('listOnboardingRuns(12, entityId)');
    expect(hrServer).toContain('listOffboardingRuns(12, entityId)');
    expect(hrServer).toContain('listOnboardingCandidateTickets(entityId)');
  });
});
