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
  it('expands to Finance/HR/IT/Marketing/Legal/Ticket Portal/Admin in order', () => {
    const ssc = MAIN_NAV.find((i) => i.label === 'Shared Services');
    expect(ssc?.href).toBeUndefined();
    expect(ssc?.children?.map((c) => c.label)).toEqual([
      'Finance',
      'HR',
      'IT',
      'Marketing',
      'Legal',
      'Ticket Portal',
      'Admin',
    ]);
    const legal = ssc?.children?.find((c) => c.label === 'Legal');
    expect(legal?.href).toBe('/shared-services/legal');
    expect(MAIN_NAV.some((i) => i.label === 'Document Library')).toBe(false);
    const ticketPortal = ssc?.children?.find((c) => c.label === 'Ticket Portal');
    expect(ticketPortal?.href).toBe('/activity');
    const admin = ssc?.children?.find((c) => c.label === 'Admin');
    expect(admin?.href).toBe('/admin');
    expect(admin?.module).toBe('admin');
    expect(admin?.children?.map((c) => c.label)).toEqual([
      'Document Library',
      'DocuSign',
      'Email analytics',
    ]);
    expect(admin?.children?.[0]?.href).toBe('/documents');
    expect(admin?.children?.[0]?.module).toBe('documents');
    expect(admin?.children?.[1]?.href).toBe(
      '/shared-services/legal/docusign',
    );
  });

  it('nests Screening under HR (not as SSC sibling)', () => {
    const ssc = MAIN_NAV.find((i) => i.label === 'Shared Services');
    const hr = ssc?.children?.find((c) => c.label === 'HR');
    expect(hr?.href).toBe('/shared-services/hr');
    expect(hr?.children?.map((c) => c.label)).toEqual(['Screening']);
    expect(hr?.children?.[0]?.href).toBe('/shared-services/hr/screening');
    expect(ssc?.children?.some((c) => c.label === 'Screening')).toBe(false);
  });

  it('nests Activity log + Visionary Audit log under IT / Technology (not Admin)', () => {
    const ssc = MAIN_NAV.find((i) => i.label === 'Shared Services');
    const it = ssc?.children?.find((c) => c.label === 'IT');
    expect(it?.href).toBe('/shared-services/it/assets');
    expect(it?.children?.map((c) => c.label)).toEqual([
      'Activity log',
      'Audit log',
    ]);
    expect(it?.children?.[0]?.href).toBe('/shared-services/it/activity');
    expect(it?.children?.[0]?.requiredPermission).toBe('read:it_assets');
    expect(it?.children?.[0]?.visionaryOnly).toBeUndefined();
    expect(it?.children?.[1]?.href).toBe('/admin/audit');
    expect(it?.children?.[1]?.visionaryOnly).toBe(true);
    const admin = ssc?.children?.find((c) => c.label === 'Admin');
    expect(admin?.children?.map((c) => c.label)).toEqual([
      'Document Library',
      'DocuSign',
      'Email analytics',
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
  it('places Assets under Home, then C-Suite before Dashboard; To Do + Firm + CC top-level', () => {
    const labels = MAIN_NAV.map((i) => i.label);
    expect(labels.indexOf('Home')).toBe(0);
    expect(labels.indexOf('Assets')).toBe(1);
    expect(labels.indexOf('C-Suite')).toBe(2);
    expect(labels.indexOf('Dashboard')).toBe(3);
    expect(labels.indexOf('To Do List')).toBe(4);
    expect(labels.indexOf('Firm')).toBe(5);
    expect(labels.indexOf('Business Development')).toBe(6);
    expect(labels.indexOf('Command Center')).toBe(7);
    expect(labels).not.toContain('Portfolio');
    expect(labels).not.toContain('Entities');
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
