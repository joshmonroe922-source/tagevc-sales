import { describe, expect, it } from 'vitest';
import {
  entityBrandPresenceOrder,
  linkedInCompanyUrlForEntity,
  listEntityBrandPresence,
  summarizePresenceHealth,
} from '@/lib/shared-services/entity-brand-presence';

describe('entity brand presence', () => {
  it('orders Consolidated priority entities', () => {
    expect(entityBrandPresenceOrder()).toEqual([
      'ENT-FIRM',
      'ENT-R619',
      'ENT-SIGNENT',
      'ENT-INDA',
    ]);
    expect(listEntityBrandPresence().map((r) => r.entity_id)).toEqual(
      entityBrandPresenceOrder(),
    );
  });

  it('stores current Company Page URLs; Instant NDA empty until create', () => {
    expect(linkedInCompanyUrlForEntity('ENT-FIRM')).toMatch(
      /linkedin\.com\/company\//,
    );
    expect(linkedInCompanyUrlForEntity('ENT-R619')).toContain(
      'linkedin.com/company/619-recruiting',
    );
    expect(linkedInCompanyUrlForEntity('ENT-SIGNENT')).toContain(
      'linkedin.com/company/signent-outsourced-hr',
    );
    expect(linkedInCompanyUrlForEntity('ENT-INDA')).toBe('');
  });

  it('summarizes fail-soft health without inventing credentials', () => {
    const rows = summarizePresenceHealth({
      entity_id: 'ENT-FIRM',
      linkedin: {
        external_id: null,
        config: { page_url: 'https://www.linkedin.com/company/tage-global' },
      },
    });
    const li = rows.find((r) => r.kind === 'linkedin_company');
    expect(li?.connected).toBe(true);
    expect(li?.page_url).toContain('linkedin.com/company');
    const ga = rows.find((r) => r.kind === 'google_analytics');
    expect(ga?.connected).toBe(false);
  });

  it('marks Recruit GBP as update-mode copy when unbound', () => {
    const gbp = summarizePresenceHealth({ entity_id: 'ENT-R619' }).find(
      (r) => r.kind === 'google_business',
    );
    expect(gbp?.detail).toMatch(/update existing/i);
  });
});
