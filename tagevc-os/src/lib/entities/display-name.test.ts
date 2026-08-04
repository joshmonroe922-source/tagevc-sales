import { describe, expect, it } from 'vitest';
import {
  entityDisplayName,
  entityDisplayNameFromId,
  entityLabel,
  entityLabelOrFirm,
  entityScopeContext,
  normalizeEntityId,
} from '@/lib/entities/display-name';

describe('entity display names', () => {
  it('prefers company name fields over entity ids', () => {
    expect(
      entityDisplayName({
        entity_id: 'ENT-R619',
        canonical_name: 'Recruit 619',
      }),
    ).toBe('Recruit 619');
    expect(
      entityLabel({
        entity_id: 'ENT-R619',
        display_name: 'Recruit 619 Ops',
      }),
    ).toBe('Recruit 619 Ops');
    expect(entityDisplayNameFromId('ENT-INDA')).toBe('Instant NDA');
    expect(entityDisplayNameFromId('ENT-002')).toBe('Instant NDA');
    expect(entityDisplayName('ENT-FIRM')).toBe('Tage Venture Capital');
    expect(entityDisplayNameFromId('ENT-SIGNENT')).toBe('Signent HR');
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

  it('builds scope context and firm fallbacks without ENT-* primary labels', () => {
    expect(entityScopeContext('ENT-R619')).toBe('Entity · Recruit 619');
    expect(entityScopeContext(null)).toBe('Firm-wide');
    expect(entityLabelOrFirm(null)).toBe('firm');
    expect(entityLabelOrFirm('ENT-FIRM')).toBe('Tage Venture Capital');
  });
});
