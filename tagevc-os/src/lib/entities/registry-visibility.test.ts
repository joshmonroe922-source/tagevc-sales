import { describe, expect, it } from 'vitest';
import {
  isHiddenActiveCompany,
  isHiddenRegistryEntity,
  toVisibleCompanySelectOptions,
} from '@/lib/entities/registry-visibility';

describe('Firm registry visibility', () => {
  it('hides sample + legacy entities from the Registry list', () => {
    expect(isHiddenRegistryEntity({ entity_id: 'ENT-001' })).toBe(true); // Sample Closed Co
    expect(isHiddenRegistryEntity({ entity_id: 'ENT-002' })).toBe(true); // legacy Instant NDA
    expect(isHiddenRegistryEntity({ entity_id: 'ENT-003' })).toBe(true); // Sample Indy SFR
    expect(isHiddenRegistryEntity({ entity_id: 'ENT-RE-001' })).toBe(true);
    expect(
      isHiddenRegistryEntity({
        entity_id: 'ENT-XXX',
        canonical_name: 'Instant NDA (Legacy ENT-002)',
      }),
    ).toBe(true);
    expect(
      isHiddenRegistryEntity({ canonical_name: 'Sample Indy SFR' }),
    ).toBe(true);
  });

  it('keeps real operating subsidiaries in the Registry list', () => {
    expect(isHiddenRegistryEntity({ entity_id: 'ENT-R619' })).toBe(false);
    expect(isHiddenRegistryEntity({ entity_id: 'ENT-INDA' })).toBe(false);
    expect(isHiddenRegistryEntity({ entity_id: 'ENT-FIRM' })).toBe(false);
    expect(isHiddenRegistryEntity({ entity_id: 'ENT-SIGNENT' })).toBe(false);
    expect(
      isHiddenRegistryEntity({
        entity_id: 'ENT-INDA',
        canonical_name: 'Instant NDA',
      }),
    ).toBe(false);
  });

  it('hides only sample companies from Active companies (keeps Instant NDA)', () => {
    expect(isHiddenActiveCompany({ entity_id: 'ENT-001' })).toBe(true);
    expect(
      isHiddenActiveCompany({
        entity_id: 'PF-001',
        company_name: 'Sample Closed Co',
      }),
    ).toBe(true);
    // Legacy Instant NDA portfolio row must NOT be hidden from Active list.
    expect(
      isHiddenActiveCompany({
        entity_id: 'ENT-002',
        company_name: 'Instant NDA',
      }),
    ).toBe(false);
    expect(
      isHiddenActiveCompany({
        entity_id: 'ENT-INDA',
        company_name: 'Instant NDA',
      }),
    ).toBe(false);
    expect(
      isHiddenActiveCompany({
        entity_id: 'ENT-R619',
        company_name: 'Recruit 619',
      }),
    ).toBe(false);
  });

  it('Dashboard company options keep ENT-INDA and drop legacy ENT-002 duplicate', () => {
    const opts = toVisibleCompanySelectOptions([
      { entity_id: 'ENT-002', company_name: 'Instant NDA' },
      { entity_id: 'ENT-FIRM', name: 'Tage Venture Capital' },
      { entity_id: 'ENT-R619', name: 'Recruit 619' },
      { entity_id: 'ENT-INDA', name: 'Instant NDA' },
      {
        entity_id: 'ENT-XXX',
        canonical_name: 'Instant NDA (Legacy ENT-002)',
      },
      { entity_id: 'ENT-001', company_name: 'Sample Closed Co' },
    ]);
    expect(opts.map((o) => o.entity_id)).toEqual([
      'ENT-FIRM',
      'ENT-R619',
      'ENT-INDA',
    ]);
    expect(opts.filter((o) => o.name === 'Instant NDA')).toHaveLength(1);
    expect(opts.find((o) => o.entity_id === 'ENT-INDA')?.name).toBe(
      'Instant NDA',
    );
  });
});
