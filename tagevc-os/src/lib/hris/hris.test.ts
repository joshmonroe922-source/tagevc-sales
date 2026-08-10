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
import { templateSlugCandidates, templateSlugFor } from './runs';

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

  it('prefers an entity-specific template, then falls back to the shared one', () => {
    expect(templateSlugCandidates('onboarding', 'ENT-SIGNENT')).toEqual([
      'signent-onboarding-v1',
      'r619-onboarding-v1',
    ]);
    expect(templateSlugCandidates('onboarding', 'ENT-INDA')).toEqual([
      'inda-onboarding-v1',
      'r619-onboarding-v1',
    ]);
    expect(templateSlugCandidates('offboarding', 'ENT-FIRM')).toEqual([
      'firm-offboarding-v1',
      'r619-offboarding-v1',
    ]);
  });

  it('does not duplicate the slug for R619, whose template IS the shared one', () => {
    expect(templateSlugCandidates('onboarding', 'ENT-R619')).toEqual([
      'r619-onboarding-v1',
    ]);
  });

  it('normalizes the legacy Instant NDA code', () => {
    expect(templateSlugCandidates('onboarding', 'ENT-002')).toEqual(
      templateSlugCandidates('onboarding', 'ENT-INDA'),
    );
  });

  it('still resolves an unknown entity to the shared template', () => {
    expect(templateSlugCandidates('onboarding', 'ENT-NEWCO')).toEqual([
      'r619-onboarding-v1',
    ]);
  });
});

describe('phase72 access + manager filter', () => {
  it('limits compensation visibility', async () => {
    const { canViewHrisCompensation, isManagerOwnedStep, filterManagerVisibleSteps } =
      await import('./access');
    expect(canViewHrisCompensation('visionary')).toBe(true);
    expect(canViewHrisCompensation('associate')).toBe(false);
    expect(
      isManagerOwnedStep({ owner_role: 'Hiring Manager' }),
    ).toBe(true);
    expect(isManagerOwnedStep({ owner_role: 'Human Resources' })).toBe(false);
    const steps = filterManagerVisibleSteps([
      {
        id: '1',
        run_id: 'r',
        step_key: 'a',
        title: 'A',
        category: 'c',
        sort_order: 1,
        owner_role: 'Hiring Manager',
        timing_anchor: 'start_date',
        offset_days: 0,
        due_at: null,
        status: 'pending',
        evidence_required: false,
        evidence_note: '',
        evidence_url: null,
        automation: 'manual',
        destructive: false,
        optional_for_audience: false,
        system_hook: null,
        blocker: false,
        escalated_ticket_id: null,
        completed_at: null,
        notes: '',
      },
      {
        id: '2',
        run_id: 'r',
        step_key: 'b',
        title: 'B',
        category: 'c',
        sort_order: 2,
        owner_role: 'IT',
        timing_anchor: 'start_date',
        offset_days: 0,
        due_at: null,
        status: 'pending',
        evidence_required: false,
        evidence_note: '',
        evidence_url: null,
        automation: 'assist',
        destructive: false,
        optional_for_audience: false,
        system_hook: 'graph_provision',
        blocker: false,
        escalated_ticket_id: null,
        completed_at: null,
        notes: '',
      },
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0].owner_role).toBe('Hiring Manager');
  });

  it('redacts compensation for managers', async () => {
    const { redactEmployeeComp } = await import('./employees');
    const redacted = redactEmployeeComp({
      id: '1',
      employee_key: 'k',
      full_name: 'Test',
      work_email: 't@x.com',
      personal_email: '',
      phone: '',
      entity_id: 'ENT-R619',
      role_title: 'Rep',
      department: '',
      location: '',
      manager_employee_id: null,
      manager_name: 'Boss',
      manager_profile_id: null,
      status: 'onboarding',
      start_date: null,
      end_date: null,
      offer_accepted_at: null,
      onboarding_status: 'in_progress',
      offboarding_status: 'none',
      onboarding_pct: 10,
      offboarding_pct: 0,
      comp_amount: 120000,
      comp_currency: 'USD',
      comp_basis: 'salary',
      pay_frequency: 'annual',
      bonus_amount: 2500,
      bonus_currency: 'USD',
      bonus_frequency: 'quarterly',
      bonus_type: 'mbo',
      bonus_notes: 'MBOs per offer letter',
      profile_id: null,
      entra_object_id: null,
      upn: null,
      identity_status: 'unknown',
      recruit_assignment: {},
      notes: 'secret',
      created_at: '',
      updated_at: '',
    });
    expect(redacted.comp_amount).toBeNull();
    expect(redacted.notes).toBe('');
    // Variable comp is just as sensitive as base pay.
    expect(redacted.bonus_amount).toBeNull();
    expect(redacted.bonus_frequency).toBe('none');
    expect(redacted.bonus_notes).toBe('');
  });
});

describe('phase72 sql + docs presence', () => {
  it('ships deepen migration and graph docs', async () => {
    const { readFileSync, existsSync } = await import('fs');
    const { resolve } = await import('path');
    const sql = resolve(process.cwd(), 'supabase/phase72_hris_deepen.sql');
    const docs = resolve(process.cwd(), 'docs/OS_PHASE72_HRIS.md');
    const graph = resolve(process.cwd(), 'docs/MS_GRAPH_HRIS.md');
    expect(existsSync(sql)).toBe(true);
    expect(existsSync(docs)).toBe(true);
    expect(existsSync(graph)).toBe(true);
    const body = readFileSync(sql, 'utf8');
    expect(body).toContain('os_hris_documents');
    expect(body).toContain('graph_provision');
    expect(body).toContain('hris-private');
    expect(body).toContain('comp_amount');
  });
});

describe('phase77 vault RLS + manager picker', () => {
  it('parses entity-scoped and legacy storage paths', async () => {
    const { parseHrisStorageEmployeeId } = await import('./access');
    const emp = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    expect(
      parseHrisStorageEmployeeId(`ENT-R619/${emp}/file.pdf`),
    ).toBe(emp);
    expect(parseHrisStorageEmployeeId(`${emp}/file.pdf`)).toBe(emp);
    expect(parseHrisStorageEmployeeId('garbage/path')).toBeNull();
    expect(parseHrisStorageEmployeeId('ENT-R619/only')).toBeNull();
  });

  it('denies cross-manager and unauthorized vault access', async () => {
    const { canAccessHrisEmployeeVault } = await import('./access');
    const mgrA = '11111111-1111-4111-8111-111111111111';
    const mgrB = '22222222-2222-4222-8222-222222222222';
    expect(
      canAccessHrisEmployeeVault({
        role: 'associate',
        profileId: mgrA,
        employeeManagerProfileId: mgrA,
        canAccessEntity: false,
      }),
    ).toBe(true);
    expect(
      canAccessHrisEmployeeVault({
        role: 'associate',
        profileId: mgrB,
        employeeManagerProfileId: mgrA,
        canAccessEntity: false,
      }),
    ).toBe(false);
    expect(
      canAccessHrisEmployeeVault({
        role: 'partner',
        profileId: mgrB,
        employeeManagerProfileId: null,
        canAccessEntity: true,
      }),
    ).toBe(false);
    expect(
      canAccessHrisEmployeeVault({
        role: 'service_lead',
        profileId: mgrB,
        employeeManagerProfileId: null,
        canAccessEntity: true,
      }),
    ).toBe(true);
    expect(
      canAccessHrisEmployeeVault({
        role: 'visionary',
        profileId: mgrB,
        employeeManagerProfileId: null,
        canAccessEntity: false,
      }),
    ).toBe(true);
  });

  it('ships phase77 SQL without dropping store snapshots', async () => {
    const { readFileSync, existsSync } = await import('fs');
    const { resolve } = await import('path');
    const sql = resolve(process.cwd(), 'supabase/phase77_hris_vault_rls.sql');
    expect(existsSync(sql)).toBe(true);
    const body = readFileSync(sql, 'utf8');
    expect(body).toContain('is_hris_employee_accessible');
    expect(body).toContain('can_access_hris_storage_path');
    expect(body).toContain('manager_profile_id');
    expect(body).toContain('is_visionary_role');
    expect(body).not.toMatch(/drop\s+table/i);
    expect(body).toMatch(/Does NOT drop os_store_snapshots/);
  });

  it('documents vault RLS in MS_GRAPH_HRIS', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const graph = readFileSync(
      resolve(process.cwd(), 'docs/MS_GRAPH_HRIS.md'),
      'utf8',
    );
    expect(graph).toContain('Document vault RLS');
    expect(graph).toContain('people picker');
  });
});
