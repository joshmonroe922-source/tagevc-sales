import { describe, expect, it } from 'vitest';
import {
  CONSOLIDATED_SELECT_VALUE,
  DEFAULT_COMPANY_SELECT_OPTIONS,
  ENTITY_SELECT_PRIORITY_IDS,
  entitySelectLabel,
  sortEntitiesForSelect,
} from '@/lib/entities/display-order';
import {
  assertNoHtmlInListSelect,
  JOB_LIST_SELECT_COLUMNS,
  SSC_TASK_LIST_SELECT_COLUMNS,
} from '@/lib/content/list-vs-detail';
import {
  sanitizeRichContentOnWrite,
  sanitizeRichHtml,
} from '@/lib/content/sanitize-html';
import { MAIN_NAV, flattenNavItems } from '@/lib/nav';
import { listSscCompanies } from '@/lib/shared-services/ssc-checklist/scope';

/**
 * Nav groups keep gaining siblings. These tests are about *relative* order and
 * presence, so pinning an exhaustive list just breaks on the next feature and
 * teaches everyone to ignore the suite.
 */
function expectOrder(actual: string[] | undefined, expected: string[]) {
  const wanted = new Set(expected);
  expect((actual ?? []).filter((label) => wanted.has(label))).toEqual(expected);
}

describe('sortEntitiesForSelect', () => {
  it('orders Consolidated then Tage Venture Capital → R619 → Signent → Instant NDA then A–Z', () => {
    const mixed = sortEntitiesForSelect([
      { entity_id: 'ENT-INDA', name: 'Instant NDA' },
      { entity_id: 'ENT-ZZZ', name: 'Zebra Co' },
      { entity_id: 'ENT-R619', name: 'Recruit 619' },
      { entity_id: CONSOLIDATED_SELECT_VALUE, name: 'Consolidated' },
      { entity_id: 'ENT-AAA', name: 'Alpha Co' },
      { entity_id: 'ENT-FIRM', name: 'Tage Venture Capital' },
      { entity_id: 'ENT-SIGNENT', name: 'Signent HR' },
    ]);
    expect(mixed.map((e) => e.entity_id)).toEqual([
      CONSOLIDATED_SELECT_VALUE,
      'ENT-FIRM',
      'ENT-R619',
      'ENT-SIGNENT',
      'ENT-INDA',
      'ENT-AAA',
      'ENT-ZZZ',
    ]);
  });

  it('keeps relative priority when Signent is omitted', () => {
    const ids = sortEntitiesForSelect([
      { entity_id: 'ENT-INDA' },
      { entity_id: 'ENT-FIRM' },
      { entity_id: 'ENT-R619' },
    ]).map((e) => e.entity_id);
    expect(ids).toEqual(['ENT-FIRM', 'ENT-R619', 'ENT-INDA']);
  });

  it('exposes canonical priority ids', () => {
    expect([...ENTITY_SELECT_PRIORITY_IDS]).toEqual([
      'ENT-FIRM',
      'ENT-R619',
      'ENT-SIGNENT',
      'ENT-INDA',
    ]);
    expect(entitySelectLabel('ENT-FIRM')).toBe('Tage Venture Capital');
    expect(entitySelectLabel('ENT-SIGNENT')).toBe('Signent HR');
  });

  it('default company options omit sample entities', () => {
    const values = DEFAULT_COMPANY_SELECT_OPTIONS.map((o) => o.value);
    const labels = DEFAULT_COMPANY_SELECT_OPTIONS.map((o) => o.label);
    expect(values).toEqual(['ENT-FIRM', 'ENT-R619', 'ENT-INDA']);
    expect(values).not.toContain('ENT-001');
    expect(values).not.toContain('ENT-003');
    expect(labels.join(' ')).not.toMatch(/Sample Closed|Sample Indy/i);
  });
});

describe('SSC + entity dropdowns use shared order', () => {
  it('listSscCompanies follows Tage Venture Capital → Recruit 619 → Instant NDA', () => {
    const ids = listSscCompanies().map((c) => c.entity_id);
    expect(ids[0]).toBe('ENT-FIRM');
    expect(ids.indexOf('ENT-R619')).toBeLessThan(ids.indexOf('ENT-INDA'));
  });
});

describe('Shared Services nav accordion', () => {
  it('expands to SSC Task List/A&F/Human Resources/Technology/Marketing/Legal/Ticket Portal/Admin in order', () => {
    const ssc = MAIN_NAV.find((i) => i.label === 'Shared Services');
    expect(ssc?.href).toBeUndefined();
    expect(ssc?.children?.map((c) => c.label)).toEqual([
      'SSC Task List',
      'Tage VC A&F',
      'Human Resources',
      'Vendor Management',
      'Technology',
      'Marketing',
      'Partner BI',
      'Legal',
      'Ticket Portal',
      'Admin',
    ]);
    expect(ssc?.children?.[0]?.href).toBe('/to-do');
    expect(ssc?.children?.some((c) => c.href === '/shared-services/finance')).toBe(
      false,
    );
    const legal = ssc?.children?.find((c) => c.label === 'Legal');
    expect(legal?.href).toBe('/shared-services/legal');
    expect(MAIN_NAV.some((i) => i.label === 'Document Library')).toBe(false);
    const ticketPortal = ssc?.children?.find((c) => c.label === 'Ticket Portal');
    expect(ticketPortal?.href).toBe('/activity');
    const admin = ssc?.children?.find((c) => c.label === 'Admin');
    expect(admin?.href).toBe('/admin');
    expect(admin?.module).toBe('admin');
    expectOrder(admin?.children?.map((c) => c.label), [
      'Org Chart',
      'Hire impact',
      'Document Library',
      'DocuSign',
      'Email analytics',
      'Period Checklists',
      'Audits',
    ]);
    const docLibrary = admin?.children?.find(
      (c) => c.label === 'Document Library',
    );
    expect(docLibrary?.href).toBe('/documents');
    expect(docLibrary?.module).toBe('documents');
    expect(admin?.children?.find((c) => c.label === 'DocuSign')?.href).toBe(
      '/shared-services/legal/docusign',
    );
  });

  it('nests Screening under Human Resources (not as SSC sibling)', () => {
    const ssc = MAIN_NAV.find((i) => i.label === 'Shared Services');
    const hr = ssc?.children?.find((c) => c.label === 'Human Resources');
    expect(hr?.href).toBe('/shared-services/hr');
    expect(hr?.children?.map((c) => c.label)).toEqual([
      'Performance cycle',
      'Screening',
    ]);
    expect(hr?.children?.[1]?.href).toBe('/shared-services/hr/screening');
    expect(ssc?.children?.some((c) => c.label === 'Screening')).toBe(false);
  });

  it('keeps Vendor Management as SSC peer; Technology nests Partner stack + Mobile launch + Activity + Audit', () => {
    const ssc = MAIN_NAV.find((i) => i.label === 'Shared Services');
    const vm = ssc?.children?.find((c) => c.label === 'Vendor Management');
    expect(vm?.href).toBe('/shared-services/ops/vendor-management');
    expect(vm?.requiredPermission).toBe('read:shared_services');
    expect(vm?.children?.map((c) => c.label)).toEqual([
      'Vendors',
      'Renewals',
      'People',
      'Hire simulator',
    ]);
    const it = ssc?.children?.find((c) => c.label === 'Technology');
    expect(it?.href).toBe('/shared-services/it/assets');
    expectOrder(it?.children?.map((c) => c.label), [
      'Partner stack',
      'Mobile launch',
      'Activity log',
      'Audit log',
    ]);
    const itChild = (label: string) =>
      it?.children?.find((c) => c.label === label);
    expect(itChild('Partner stack')?.href).toBe(
      '/shared-services/it/technology-stack',
    );
    expect(itChild('Mobile launch')?.href).toBe(
      '/shared-services/it/mobile-launch',
    );
    expect(itChild('Activity log')?.href).toBe('/shared-services/it/activity');
    expect(itChild('Audit log')?.href).toBe('/admin/audit');
    expect(itChild('Audit log')?.visionaryOnly).toBe(true);
    const admin = ssc?.children?.find((c) => c.label === 'Admin');
    expectOrder(admin?.children?.map((c) => c.label), [
      'Org Chart',
      'Hire impact',
      'Document Library',
      'DocuSign',
      'Email analytics',
      'Period Checklists',
      'Audits',
    ]);
    expect(ssc?.children?.some((c) => c.label === 'Audit log')).toBe(false);
    expect(MAIN_NAV.some((i) => i.label === 'Audit log')).toBe(false);
  });
});

describe('list vs detail HTML policy', () => {
  it('job and task list column sets omit description_html', () => {
    expect(JOB_LIST_SELECT_COLUMNS).not.toContain('description_html');
    expect(SSC_TASK_LIST_SELECT_COLUMNS).not.toContain('description_html');
    expect(assertNoHtmlInListSelect(JOB_LIST_SELECT_COLUMNS.join(', '))).toBe(
      true,
    );
    expect(assertNoHtmlInListSelect('id, title, description_html')).toBe(false);
    expect(assertNoHtmlInListSelect('*')).toBe(false);
  });

  it('sanitizes on write and strips script', () => {
    const out = sanitizeRichContentOnWrite(
      '<p>Hello</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>',
    );
    expect(out.description_html).toContain('<p>Hello</p>');
    expect(out.description_html).not.toContain('script');
    expect(out.description_text).toContain('Hello');
    expect(sanitizeRichHtml('<img src=x onerror=alert(1)>')).not.toContain(
      'onerror',
    );
  });
});

describe('main nav IA (post Assets + SSC accordion)', () => {
  it('places Dashboard under Home, then Assets → C-Suite; Firm → BD → SSC → CC → Grow → Personal', () => {
    const labels = MAIN_NAV.map((i) => i.label);
    expectOrder(labels, [
      'Home',
      'Dashboard',
      'Assets',
      'C-Suite',
      'Firm',
      'Business Development',
      'Shared Services',
      'Command Center',
      'Grow',
      'Personal',
    ]);
    expect(labels[0]).toBe('Home');
    expect(labels[1]).toBe('Dashboard');
    // Messaging is the sidebar brand-header control, not a left-nav item.
    expect(labels).not.toContain('Message Center');
    expect(labels).not.toContain('To Do List');
    expect(labels).not.toContain('Portfolio');
    expect(labels).not.toContain('Entities');
    const sscTop = MAIN_NAV.find((i) => i.label === 'Shared Services');
    expect(sscTop?.children?.some((c) => c.label === 'SSC Task List')).toBe(true);
  });

  it('keeps Command Center and Firm as top-level (not nested under C-Suite / BD)', () => {
    const csuite = MAIN_NAV.find((i) => i.label === 'C-Suite');
    expect(csuite?.children?.map((c) => c.label)).not.toContain('Command Center');
    const bd = MAIN_NAV.find((i) => i.label === 'Business Development');
    expect(bd?.children?.map((c) => c.label)).not.toContain('Firm');
    expect(MAIN_NAV.find((i) => i.label === 'Command Center')?.href).toBe(
      '/command-center',
    );
    expect(MAIN_NAV.find((i) => i.label === 'Firm')?.href).toBe('/firm');
    const assets = MAIN_NAV.find((i) => i.label === 'Assets');
    expect(assets?.children?.map((c) => c.label)).toEqual([
      'Net Worth',
      'Businesses',
      'Real Estate',
      'Investments',
    ]);
  });

  it('does not expose separate VC/M&A/RE or Recruit Rollup nav items', () => {
    const flat = flattenNavItems();
    const flatLabels = flat.map((i) => i.label);
    expect(flatLabels).not.toContain('Deal Flow · VC');
    expect(flatLabels).not.toContain('Recruit 619 Rollup');
  });
});
