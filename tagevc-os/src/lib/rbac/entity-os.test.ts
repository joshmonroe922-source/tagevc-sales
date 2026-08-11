import { describe, expect, it } from 'vitest';
import {
  canSwitchEntityOs,
  entityOsLabel,
  entityOsShortLabel,
  FIRM_OS_ENTITY_ID,
  isEntityOsScoped,
  listEntityOsOptions,
  parseEntityOsId,
} from '@/lib/rbac/entity-os';
import {
  canAccessEntityId,
  canAccessPipelineEntity,
  isFirmWideAccess,
} from '@/lib/rbac/entity-scope';

describe('entity OS options', () => {
  it('lists the parent OS first, then subsidiaries in canonical order', () => {
    const ids = listEntityOsOptions().map((o) => o.entityId);
    expect(ids[0]).toBe(FIRM_OS_ENTITY_ID);
    expect(ids).toEqual([
      'ENT-FIRM',
      'ENT-R619',
      'ENT-SIGNENT',
      'ENT-INDA',
    ]);
  });

  it('never surfaces a raw entity code as a label', () => {
    for (const option of listEntityOsOptions()) {
      expect(option.label).not.toMatch(/^ENT-/);
      expect(option.shortLabel).not.toMatch(/^ENT-/);
    }
  });

  it('uses the compact brand line for the sidebar', () => {
    expect(entityOsShortLabel('ENT-FIRM')).toBe('Tage VC');
    expect(entityOsShortLabel(null)).toBe('Tage VC');
    expect(entityOsShortLabel('ENT-R619')).toBe('Recruit 619');
    expect(entityOsLabel('ENT-FIRM')).toBe('Tage Venture Capital');
  });
});

describe('parseEntityOsId', () => {
  it('accepts known subsidiaries', () => {
    expect(parseEntityOsId('ENT-R619')).toBe('ENT-R619');
    expect(parseEntityOsId('ENT-INDA')).toBe('ENT-INDA');
  });

  it('collapses the legacy Instant NDA alias', () => {
    expect(parseEntityOsId('ENT-002')).toBe('ENT-INDA');
  });

  it('treats the parent OS as "no lock"', () => {
    expect(parseEntityOsId('ENT-FIRM')).toBeNull();
  });

  it('rejects unknown, empty, and malformed values', () => {
    expect(parseEntityOsId('ENT-NOPE')).toBeNull();
    expect(parseEntityOsId('')).toBeNull();
    expect(parseEntityOsId(null)).toBeNull();
    expect(parseEntityOsId('ENT-R619; drop table')).toBeNull();
  });
});

describe('canSwitchEntityOs', () => {
  it('is Visionary-only', () => {
    expect(canSwitchEntityOs({ realRole: 'visionary' })).toBe(true);
    for (const role of [
      'think_tank',
      'coo',
      'partner',
      'admin',
      'sub_lead',
      'ssc_finance',
    ] as const) {
      expect(canSwitchEntityOs({ realRole: role })).toBe(false);
    }
  });

  it('stands down while another identity override is active', () => {
    expect(
      canSwitchEntityOs({ realRole: 'visionary', impersonatingAs: 'coo' }),
    ).toBe(false);
    expect(
      canSwitchEntityOs({ realRole: 'visionary', liveLookActive: true }),
    ).toBe(false);
  });
});

describe('entity scope under an OS lock', () => {
  it('narrows a firm-wide Visionary to the selected OS', () => {
    expect(isFirmWideAccess('visionary', 'ENT-FIRM')).toBe(true);
    expect(isFirmWideAccess('visionary', 'ENT-R619', 'ENT-R619')).toBe(false);
    expect(isFirmWideAccess('visionary', 'ENT-FIRM', 'ENT-FIRM')).toBe(true);
    expect(isFirmWideAccess('visionary', 'ENT-FIRM', null)).toBe(true);
  });

  it('still allows rows inside the selected OS', () => {
    expect(
      canAccessEntityId('visionary', 'ENT-R619', 'ENT-R619', undefined, 'ENT-R619'),
    ).toBe(true);
  });

  it('blocks rows from other entities while locked', () => {
    expect(
      canAccessEntityId('visionary', 'ENT-R619', 'ENT-INDA', undefined, 'ENT-R619'),
    ).toBe(false);
    expect(
      canAccessPipelineEntity(
        'visionary',
        'ENT-R619',
        'ENT-INDA',
        undefined,
        'hide',
        'ENT-R619',
      ),
    ).toBe(false);
  });

  it('keeps children of the selected OS visible', () => {
    const parents = new Map([['ENT-CHILD', 'ENT-R619']]);
    expect(
      canAccessEntityId('visionary', 'ENT-R619', 'ENT-CHILD', parents, 'ENT-R619'),
    ).toBe(true);
  });

  it('leaves single-OS roles untouched', () => {
    expect(isFirmWideAccess('sub_lead', 'ENT-R619')).toBe(false);
    expect(isFirmWideAccess('coo', null)).toBe(true);
  });
});

describe('isEntityOsScoped', () => {
  it('is false for the parent OS and empty values', () => {
    expect(isEntityOsScoped(null)).toBe(false);
    expect(isEntityOsScoped('')).toBe(false);
    expect(isEntityOsScoped('ENT-FIRM')).toBe(false);
    expect(isEntityOsScoped('ENT-R619')).toBe(true);
  });
});
