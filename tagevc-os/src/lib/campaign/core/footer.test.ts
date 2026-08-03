import { describe, expect, it } from 'vitest';
import { buildComplianceFooter, injectFooter, marketingHeaders } from './footer';

describe('compliance footer', () => {
  it('always includes unsub + prefs', () => {
    const html = buildComplianceFooter({
      physicalAddress: '123 Main St',
      unsubscribeUrl: 'https://x/u',
      preferencesUrl: 'https://x/p',
      lifecycle: 'Active',
    });
    expect(html).toContain('Unsubscribe');
    expect(html).toContain('https://x/u');
    expect(injectFooter('<p>hi</p>', html)).toContain('data-ecc-footer');
  });

  it('sets RFC8058 headers', () => {
    const h = marketingHeaders({
      unsubscribeUrl: 'https://x/u',
      listId: 'campaigns.ent.tage',
      campaignId: 'c1',
      entityId: 'ENT-FIRM',
    });
    expect(h['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
});
