import { describe, expect, it } from 'vitest';
import {
  AF_HUB_PATH,
  AF_SECTIONS,
  afHubLabel,
  buildAfNavBranch,
  buildAfNavFlat,
} from '@/lib/platform/af';

describe('platform A&F spine', () => {
  it('defines four sibling sections in platform order', () => {
    expect(AF_SECTIONS.map((s) => s.id)).toEqual([
      'accounting',
      'finance',
      'audit',
      'controls',
    ]);
    expect(AF_SECTIONS.map((s) => s.path)).toEqual([
      '/shared-services/af/accounting',
      '/shared-services/af/finance',
      '/shared-services/af/audit',
      '/shared-services/af/controls',
    ]);
    expect(AF_HUB_PATH).toBe('/shared-services/af');
  });

  it('brands the hub as {Entity} A&F', () => {
    const tree = buildAfNavBranch('Recruit 619');
    expect(tree.href).toBe(AF_HUB_PATH);
    expect(tree.label).toBe(afHubLabel('Recruit 619'));
    expect(tree.children).toHaveLength(4);
    expect(tree.children.map((c) => c.label)).toEqual([
      'Accounting',
      'Finance',
      'Audit',
      'Controls, Security & Governance',
    ]);
  });

  it('flattens hub + four sections for non-nested sidebars', () => {
    const flat = buildAfNavFlat('Instant NDA');
    expect(flat[0]?.label).toBe('Instant NDA A&F');
    expect(flat).toHaveLength(5);
  });
});
