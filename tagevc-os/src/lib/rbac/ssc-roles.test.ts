import { describe, expect, it } from 'vitest';
import { MAIN_NAV } from '@/lib/nav';
import { filterNavForRole } from '@/lib/nav/role-visibility';
import { listRoleSwitcherRoles } from '@/lib/rbac/impersonation';
import {
  landingPathForRole,
  SSC_FUNCTION_ROLES,
  SSC_OPERATOR_ROLES,
} from '@/lib/rbac/ssc-roles';
import { APP_ROLE_LABELS, type AppRole } from '@/lib/types/roles';

function navLabelsFor(role: AppRole): string[] {
  return filterNavForRole(MAIN_NAV, {
    role,
    realRole: 'visionary',
    entityId: 'ENT-FIRM',
  }).map((i) => i.label);
}

function sscChildrenFor(role: AppRole): string[] {
  const items = filterNavForRole(MAIN_NAV, {
    role,
    realRole: 'visionary',
    entityId: 'ENT-FIRM',
  });
  const ssc = items.find((i) => i.label === 'Shared Services');
  return ssc?.children?.map((c) => c.label) ?? [];
}

function adminChildrenFor(role: AppRole): string[] {
  const items = filterNavForRole(MAIN_NAV, {
    role,
    realRole: 'visionary',
    entityId: 'ENT-FIRM',
  });
  const ssc = items.find((i) => i.label === 'Shared Services');
  const admin = ssc?.children?.find((c) => c.label === 'Admin');
  return admin?.children?.map((c) => c.label) ?? [];
}

describe('SSC Role Switcher + nav scope', () => {
  it('lists Counsel/Ops and all SSC function roles in the switcher', () => {
    const roles = listRoleSwitcherRoles();
    expect(roles).toContain('counsel_ops');
    for (const role of SSC_FUNCTION_ROLES) {
      expect(roles).toContain(role);
      expect(APP_ROLE_LABELS[role]).toBeTruthy();
    }
    expect(roles.indexOf('ssc_finance')).toBeGreaterThan(
      roles.indexOf('counsel_ops'),
    );
  });

  it('lands each SSC role on its function home', () => {
    expect(landingPathForRole('counsel_ops')).toBe('/shared-services/legal');
    expect(landingPathForRole('ssc_legal')).toBe('/shared-services/legal');
    expect(landingPathForRole('ssc_finance')).toBe('/shared-services/af/finance');
    expect(landingPathForRole('ssc_hr')).toBe('/shared-services/hr');
    expect(landingPathForRole('ssc_it')).toBe('/shared-services/it/assets');
    expect(landingPathForRole('ssc_marketing')).toBe(
      '/shared-services/marketing',
    );
    expect(landingPathForRole('service_lead')).toBe('/shared-services/af/finance');
  });

  it('lands desk roles on their pipeline homes', () => {
    expect(landingPathForRole('associate')).toBe('/deal-flow/vc');
    expect(landingPathForRole('ma_associate')).toBe('/deal-flow/ma');
    expect(landingPathForRole('re_sourcer')).toBe('/deal-flow/re');
    expect(APP_ROLE_LABELS.associate).toBe('Associate / VC Sourcer');
    expect(APP_ROLE_LABELS.re_sourcer).toBe('Sourcer');
  });

  it('lands Admin on ops KPI dashboard', () => {
    expect(landingPathForRole('admin')).toBe('/dashboard');
  });

  it('lands M&A Associate on assigned M&A pipeline', () => {
    expect(landingPathForRole('ma_associate')).toBe('/deal-flow/ma');
  });

  it.each([...SSC_OPERATOR_ROLES])(
    'hides C-Suite, BD, Command Center, Assets, Firm for %s',
    (role) => {
      const labels = navLabelsFor(role);
      expect(labels).not.toContain('C-Suite');
      expect(labels).not.toContain('Business Development');
      expect(labels).not.toContain('Command Center');
      expect(labels).not.toContain('Assets');
      expect(labels).not.toContain('Firm');
      expect(labels).not.toContain('Dashboard');
      expect(labels).toContain('Shared Services');
      // Messaging lives in the sidebar brand header, not the left nav.
      expect(labels).not.toContain('Message Center');
      expect(labels).toContain('Home');
    },
  );

  it('scopes Counsel/Ops and Legal to Legal SSC + Admin docs/DocuSign + tickets', () => {
    for (const role of ['counsel_ops', 'ssc_legal'] as const) {
      const children = sscChildrenFor(role);
      expect(children).toContain('Legal');
      expect(children).toContain('Admin');
      expect(children).toContain('Ticket Portal');
      expect(children).not.toContain('Document Library');
      expect(children).not.toContain('Finance');
      expect(children).not.toContain('HR');
      expect(children).not.toContain('IT');
      expect(children).not.toContain('Marketing');
      expect(adminChildrenFor(role)).toEqual([
        'Document Library',
        'DocuSign',
        'Period Checklists',
        'Audits',
      ]);
    }
  });

  it('scopes each function role to its SSC home + Admin docs + tickets', () => {
    expect(sscChildrenFor('ssc_finance')).toEqual(
      expect.arrayContaining(['Tage VC A&F', 'Admin', 'Ticket Portal']),
    );
    expect(sscChildrenFor('ssc_finance')).not.toContain('Legal');
    expect(adminChildrenFor('ssc_finance')).toEqual([
      'Document Library',
      'Period Checklists',
      'Audits',
    ]);
    expect(sscChildrenFor('ssc_hr')).toEqual(
      expect.arrayContaining(['Human Resources', 'Admin', 'Ticket Portal']),
    );
    expect(adminChildrenFor('ssc_hr')).toEqual([
      'Document Library',
      'Period Checklists',
      'Audits',
    ]);
    expect(sscChildrenFor('ssc_it')).toEqual(
      expect.arrayContaining(['Technology', 'Admin', 'Ticket Portal']),
    );
    expect(adminChildrenFor('ssc_it')).toEqual([
      'Document Library',
      'Period Checklists',
      'Audits',
    ]);
    expect(sscChildrenFor('ssc_marketing')).toEqual(
      expect.arrayContaining(['Marketing', 'Admin', 'Ticket Portal']),
    );
    expect(adminChildrenFor('ssc_marketing')).toEqual([
      'Document Library',
      'Period Checklists',
      'Audits',
    ]);
  });

  it('shows IT Activity log for Technology; Visionary Audit log only for Visionary', () => {
    const visionarySsc = filterNavForRole(MAIN_NAV, {
      role: 'visionary',
      realRole: 'visionary',
      entityId: 'ENT-FIRM',
    }).find((i) => i.label === 'Shared Services');
    const visionaryIt = visionarySsc?.children?.find(
      (c) => c.label === 'Technology',
    );
    expect(visionaryIt?.children?.map((c) => c.label)).toEqual([
      'Partner stack',
      'Mobile launch',
      'Activity log',
      'Audit log',
    ]);
    expect(
      visionarySsc?.children?.find((c) => c.label === 'Admin')?.children?.map(
        (c) => c.label,
      ),
    ).toEqual(
      expect.arrayContaining(['Document Library', 'DocuSign']),
    );

    const itSsc = filterNavForRole(MAIN_NAV, {
      role: 'ssc_it',
      realRole: 'visionary',
      entityId: 'ENT-FIRM',
    }).find((i) => i.label === 'Shared Services');
    const itDesk = itSsc?.children?.find((c) => c.label === 'Technology');
    expect(itDesk?.children?.map((c) => c.label)).toEqual([
      'Partner stack',
      'Mobile launch',
      'Activity log',
    ]);
    expect(itDesk?.children?.[0]?.href).toBe(
      '/shared-services/it/technology-stack',
    );
    expect(itSsc?.children?.some((c) => c.label === 'Audit log')).toBe(false);
  });

  it('scopes Service Lead to led SSC function only (Finance default)', () => {
    const children = sscChildrenFor('service_lead');
    expect(children).toEqual(
      expect.arrayContaining(['Tage VC A&F', 'Admin', 'Ticket Portal']),
    );
    expect(adminChildrenFor('service_lead')).toEqual([
      'Document Library',
      'Period Checklists',
      'Audits',
    ]);
    expect(children).not.toContain('Human Resources');
    expect(children).not.toContain('Technology');
    expect(children).not.toContain('Marketing');
    expect(children).not.toContain('Legal');
  });

  it('exposes human labels for each SSC desk in the switcher', () => {
    expect(APP_ROLE_LABELS.ssc_finance).toBe('Accounting / Finance');
    expect(APP_ROLE_LABELS.ssc_hr).toBe('Human Resources');
    expect(APP_ROLE_LABELS.ssc_legal).toBe('Legal');
    expect(APP_ROLE_LABELS.ssc_it).toBe('Technology');
    expect(APP_ROLE_LABELS.ssc_marketing).toBe('Marketing');
  });
});
