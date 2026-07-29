import { describe, expect, it } from 'vitest';
import { MAIN_NAV } from '@/lib/nav';
import {
  applyRoleNavTransforms,
  filterNavForRole,
  isMultiCompanyAssetsNavItem,
} from '@/lib/nav/role-visibility';

describe('Assets + COO / Subsidiary Leader nav gates', () => {
  it('hides Visionary-only IA when Role Switcher is COO', () => {
    const items = filterNavForRole(MAIN_NAV, {
      role: 'coo',
      realRole: 'visionary',
      entityId: 'ENT-FIRM',
    });
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain('C-Suite');
    expect(labels).not.toContain('Command Center');
    expect(labels).not.toContain('Firm');
    expect(labels).not.toContain('Business Development');
    expect(labels).toContain('Assets');
    expect(labels).toContain('Home');
    expect(labels).toContain('Dashboard');

    const assets = items.find((i) => i.label === 'Assets');
    const childLabels = assets?.children?.map((c) => c.label) ?? [];
    expect(childLabels).toEqual(['Businesses', 'Real Estate']);
  });

  it('replaces Assets with led entity for Subsidiary Leader (not multi-company)', () => {
    const items = filterNavForRole(MAIN_NAV, {
      role: 'sub_lead',
      realRole: 'visionary',
      entityId: 'ENT-FIRM',
    });
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain('C-Suite');
    expect(labels).not.toContain('Command Center');
    expect(labels).not.toContain('Assets');
    expect(labels).not.toContain('Portfolio');
    expect(labels).toContain('Recruit 619');

    const company = items.find((i) => i.label === 'Recruit 619');
    expect(company?.href).toBe('/entities/ENT-R619');
    expect(company?.children).toBeUndefined();
  });

  it('keeps Visionary Investments / Net Worth under Assets', () => {
    const assets = filterNavForRole(MAIN_NAV, {
      role: 'visionary',
      realRole: 'visionary',
      entityId: 'ENT-FIRM',
    }).find((i) => i.label === 'Assets');
    const childLabels = assets?.children?.map((c) => c.label) ?? [];
    expect(childLabels).toEqual([
      'Net Worth',
      'Businesses',
      'Real Estate',
      'Investments',
    ]);
  });

  it('isMultiCompanyAssetsNavItem matches Assets / Portfolio groups only', () => {
    expect(
      isMultiCompanyAssetsNavItem({
        module: 'portfolio',
        label: 'Assets',
        children: [
          { module: 'portfolio', href: '/entities', label: 'Businesses' },
        ],
      }),
    ).toBe(true);
    expect(
      isMultiCompanyAssetsNavItem({
        module: 'portfolio',
        href: '/dashboard',
        label: 'Dashboard',
      }),
    ).toBe(false);
  });

  it('applyRoleNavTransforms replaces Assets for sub_lead only', () => {
    const before = MAIN_NAV.filter((i) => i.label === 'Assets');
    const transformed = applyRoleNavTransforms(before, {
      role: 'sub_lead',
      realRole: 'sub_lead',
      entityId: 'ENT-FIRM',
    });
    expect(transformed).toEqual([
      {
        module: 'portfolio',
        href: '/entities/ENT-R619',
        label: 'Recruit 619',
        description: 'Your company overview',
      },
    ]);
    expect(
      applyRoleNavTransforms(before, { role: 'coo', realRole: 'coo' }),
    ).toEqual(before);
  });

  it('Visionary / Think Tank / Partner BD children are Lead Intake + Deal Flow only', () => {
    for (const role of ['visionary', 'think_tank', 'partner'] as const) {
      const items = filterNavForRole(MAIN_NAV, {
        role,
        realRole: 'visionary',
        entityId: 'ENT-FIRM',
      });
      const bd = items.find((i) => i.label === 'Business Development');
      expect(bd?.children?.map((c) => c.label)).toEqual([
        'Lead Intake',
        'Deal Flow',
      ]);
      const flat = items.flatMap((i) => [
        i.label,
        ...(i.children?.map((c) => c.label) ?? []),
      ]);
      expect(flat).not.toContain('VC Sourcing');
      expect(flat).not.toContain('M&A Sourcing');
      expect(flat).not.toContain('Sourcing Platform');
    }
  });

  it('hides C-Suite / Command Center / Assets and keeps BD VC+M&A for associate', () => {
    const items = filterNavForRole(MAIN_NAV, {
      role: 'associate',
      realRole: 'visionary',
      entityId: 'ENT-FIRM',
    });
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain('C-Suite');
    expect(labels).not.toContain('Command Center');
    expect(labels).not.toContain('Firm');
    expect(labels).not.toContain('Assets');
    expect(labels).not.toContain('M&A Activities');
    expect(labels).not.toContain('Sourcing Platform');
    expect(labels).toContain('Business Development');
    expect(labels).toContain('Home');

    const bd = items.find((i) => i.label === 'Business Development');
    expect(bd?.href).toBeUndefined();
    const childLabels = bd?.children?.map((c) => c.label) ?? [];
    expect(childLabels).toEqual(['VC Sourcing', 'M&A Sourcing']);
    expect(bd?.children?.map((c) => c.href)).toEqual([
      '/deal-flow/vc',
      '/deal-flow/ma',
    ]);
  });

  it('hides C-Suite / Command Center and surfaces M&A Activities for ma_associate', () => {
    const items = filterNavForRole(MAIN_NAV, {
      role: 'ma_associate',
      realRole: 'visionary',
      entityId: 'ENT-FIRM',
    });
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain('C-Suite');
    expect(labels).not.toContain('Command Center');
    expect(labels).not.toContain('Firm');
    expect(labels).not.toContain('Business Development');
    expect(labels).not.toContain('Assets');
    expect(labels).toContain('M&A Activities');
    expect(labels).toContain('Home');

    const ma = items.find((i) => i.label === 'M&A Activities');
    expect(ma?.href).toBe('/deal-flow/ma');
    expect(ma?.module).toBe('deal_flow_ma');
    expect(ma?.children).toBeUndefined();
  });

  it('hides C-Suite / Command Center and surfaces Sourcing Platform for Sourcer', () => {
    const items = filterNavForRole(MAIN_NAV, {
      role: 're_sourcer',
      realRole: 'visionary',
      entityId: 'ENT-FIRM',
    });
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain('C-Suite');
    expect(labels).not.toContain('Command Center');
    expect(labels).not.toContain('Firm');
    expect(labels).not.toContain('Business Development');
    expect(labels).not.toContain('Assets');
    expect(labels).not.toContain('Recruit 619');
    expect(labels).toContain('Sourcing Platform');
    expect(labels).toContain('Home');

    const sourcing = items.find((i) => i.label === 'Sourcing Platform');
    expect(sourcing?.href).toBe('/deal-flow/re');
    expect(sourcing?.module).toBe('deal_flow_re');
    expect(sourcing?.children).toBeUndefined();
  });

  it('keeps Document Library under Admin for roles without SSC module', () => {
    const items = filterNavForRole(MAIN_NAV, {
      role: 'associate',
      realRole: 'associate',
    });
    const ssc = items.find((i) => i.label === 'Shared Services');
    expect(ssc).toBeTruthy();
    const admin = ssc?.children?.find((c) => c.label === 'Admin');
    expect(admin?.href).toBeUndefined();
    expect(
      admin?.children?.some(
        (c) => c.label === 'Document Library' && c.href === '/documents',
      ),
    ).toBe(true);
    expect(items.some((i) => i.label === 'Document Library')).toBe(false);
    expect(ssc?.children?.some((c) => c.label === 'Document Library')).toBe(
      false,
    );
  });

  it('surfaces Tage VC A&F Accounting + Finance + Audit + Controls for Visionary and Finance SSC', () => {
    const visionarySsc = filterNavForRole(MAIN_NAV, {
      role: 'visionary',
      realRole: 'visionary',
      entityId: 'ENT-FIRM',
    }).find((i) => i.label === 'Shared Services');
    const af = visionarySsc?.children?.find((c) => c.label === 'Tage VC A&F');
    expect(af?.href).toBe('/shared-services/af');
    expect(af?.children?.map((c) => c.label)).toEqual([
      'Accounting',
      'Finance',
      'Audit',
      'Controls, Security & Governance',
    ]);
    expect(af?.children?.map((c) => c.href)).toEqual([
      '/shared-services/af/accounting',
      '/shared-services/af/finance',
      '/shared-services/af/audit',
      '/shared-services/af/controls',
    ]);

    const financeSsc = filterNavForRole(MAIN_NAV, {
      role: 'ssc_finance',
      realRole: 'visionary',
      entityId: 'ENT-FIRM',
    }).find((i) => i.label === 'Shared Services');
    expect(
      financeSsc?.children?.some((c) => c.label === 'Tage VC A&F'),
    ).toBe(true);
    expect(financeSsc?.children?.some((c) => c.label === 'HR')).toBe(false);

    const hrSsc = filterNavForRole(MAIN_NAV, {
      role: 'ssc_hr',
      realRole: 'visionary',
      entityId: 'ENT-FIRM',
    }).find((i) => i.label === 'Shared Services');
    expect(hrSsc?.children?.some((c) => c.label === 'Tage VC A&F')).toBe(
      false,
    );
  });

  it('hides firm IA for Admin and keeps ops tools + Dashboard', () => {
    const items = filterNavForRole(MAIN_NAV, {
      role: 'admin',
      realRole: 'visionary',
      entityId: 'ENT-FIRM',
    });
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain('C-Suite');
    expect(labels).not.toContain('Command Center');
    expect(labels).not.toContain('Firm');
    expect(labels).not.toContain('Business Development');
    expect(labels).not.toContain('Assets');
    expect(labels).not.toContain('Portfolio');
    expect(labels).toContain('Home');
    expect(labels).toContain('Dashboard');
    expect(labels).toContain('To Do List');
    expect(labels).toContain('Shared Services');
    expect(labels).toContain('Message Center');
    expect(labels).not.toContain('Help Desk');

    const ssc = items.find((i) => i.label === 'Shared Services');
    const childLabels = ssc?.children?.map((c) => c.label) ?? [];
    expect(childLabels).toEqual(['Ticket Portal', 'Admin']);
    const admin = ssc?.children?.find((c) => c.label === 'Admin');
    expect(admin?.href).toBe('/admin');
    expect(admin?.children?.map((c) => c.label)).toEqual([
      'Org Chart',
      'Hire impact',
      'Document Library',
      'DocuSign',
      'Email analytics',
    ]);
  });
});
