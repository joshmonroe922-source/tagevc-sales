import { describe, expect, it } from 'vitest';
import {
  buildAutofillTabs,
  tabsToDocuSignTextTabs,
} from '@/lib/docusign/autofill';

describe('docusign autofill', () => {
  it('maps employee fields to merge tabs', () => {
    const r = buildAutofillTabs({
      kind: 'employee',
      entityId: 'ENT-R619',
      fields: {
        full_name: 'Ada Lovelace',
        email: 'ada@recruit619.com',
        title: 'Engineer',
        company: 'Recruit 619',
      },
    });
    expect(r.tabs.FullName).toBe('Ada Lovelace');
    expect(r.tabs.Email).toBe('ada@recruit619.com');
    expect(r.tabs.EntityName).toBe('Recruit 619');
    expect(tabsToDocuSignTextTabs(r.tabs).length).toBeGreaterThan(2);
  });
});
