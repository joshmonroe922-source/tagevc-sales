import { describe, expect, it } from 'vitest';
import {
  entityDisplayName,
  entityDisplayNameFromId,
  normalizeEntityId,
} from '@/lib/entities/display-name';
import { MAIN_NAV, flattenNavItems } from '@/lib/nav';

describe('entity display names', () => {
  it('prefers company name fields over entity ids', () => {
    expect(
      entityDisplayName({
        entity_id: 'ENT-R619',
        canonical_name: 'Recruit 619',
      }),
    ).toBe('Recruit 619');
    expect(entityDisplayNameFromId('ENT-INDA')).toBe('Instant NDA');
    expect(entityDisplayNameFromId('ENT-002')).toBe('Instant NDA');
    expect(entityDisplayName('ENT-FIRM')).toBe('Tage Venture Capital');
  });

  it('never returns blank', () => {
    expect(entityDisplayName(null)).toBe('Unknown company');
    expect(entityDisplayName({ entity_id: 'ENT-UNKNOWN' })).toBe(
      'Unknown company',
    );
  });

  it('normalizes legacy Instant NDA alias', () => {
    expect(normalizeEntityId('ENT-002')).toBe('ENT-INDA');
  });
});

describe('main nav IA', () => {
  it('matches the executive information architecture', () => {
    const labels = MAIN_NAV.map((i) => i.label);
    expect(labels).toEqual([
      'Home',
      'Dashboard',
      'Firm',
      'Business Development',
      'Entities',
      'Command Center',
      'Shared Services',
      'Document Library',
      'Message Center',
      'Activity',
      'Help Desk',
      'Admin',
    ]);

    const bd = MAIN_NAV.find((i) => i.label === 'Business Development');
    expect(bd?.children?.map((c) => c.label)).toEqual([
      'Lead Intake',
      'Deal Flow',
    ]);
  });

  it('does not expose separate VC/M&A/RE or Recruit Rollup nav items', () => {
    const flat = flattenNavItems();
    const flatLabels = flat.map((i) => i.label);
    expect(flatLabels).not.toContain('Deal Flow · VC');
    expect(flatLabels).not.toContain('Deal Flow · M&A');
    expect(flatLabels).not.toContain('Deal Flow · RE');
    expect(flatLabels).not.toContain('Recruit 619 Rollup');
    expect(flat.some((i) => i.href === '/deal-flow')).toBe(true);
    expect(flat.some((i) => i.href === '/entities')).toBe(true);
  });
});
