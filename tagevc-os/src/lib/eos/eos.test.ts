import { describe, expect, it } from 'vitest';

import { resolveEosScope } from '@/lib/eos/dashboard';
import {
  EOS_SCOPE_ENTITIES,
  eosOperatingSystemNavLabel,
} from '@/lib/eos/types';
import { MAIN_NAV, flattenNavItems } from '@/lib/nav';

describe('eosOperatingSystemNavLabel', () => {
  it('uses company-qualified Performance Management labels on Tage', () => {
    expect(eosOperatingSystemNavLabel('ENT-FIRM')).toBe(
      'Tage VC Performance Management',
    );
    expect(eosOperatingSystemNavLabel('ENT-R619')).toBe(
      'Recruit 619 Performance Management',
    );
    expect(eosOperatingSystemNavLabel('ENT-INDA')).toBe(
      'Instant NDA Performance Management',
    );
    expect(eosOperatingSystemNavLabel('ENT-SIGNENT')).toBe(
      'Signent HR Performance Management',
    );
  });
});

describe('resolveEosScope', () => {
  it('defaults to consolidated rollup of all operating entities', () => {
    const scope = resolveEosScope(null);
    expect(scope.isConsolidated).toBe(true);
    expect(scope.scope).toBe('consolidated');
    expect(scope.entityIds).toEqual([
      'ENT-FIRM',
      'ENT-R619',
      'ENT-SIGNENT',
      'ENT-INDA',
    ]);
  });

  it('scopes to a single entity when selected', () => {
    const scope = resolveEosScope('ENT-R619');
    expect(scope.isConsolidated).toBe(false);
    expect(scope.entityIds).toEqual(['ENT-R619']);
  });

  it('normalizes legacy Instant NDA alias', () => {
    const scope = resolveEosScope('ENT-002');
    expect(scope.entityIds).toEqual(['ENT-INDA']);
  });
});

describe('EOS_SCOPE_ENTITIES', () => {
  it('lists Consolidated then Tage VC then subsidiaries', () => {
    expect(EOS_SCOPE_ENTITIES.map((e) => e.label)).toEqual([
      'Consolidated',
      'Tage VC',
      'Recruit 619',
      'Signent HR',
      'Instant NDA',
    ]);
  });
});

describe('EOS nav', () => {
  it('exposes Grow → Tage VC Performance Management + HR nested link + Training', () => {
    const grow = MAIN_NAV.find((n) => n.label === 'Grow');
    expect(grow).toBeTruthy();
    expect(
      grow?.children?.some(
        (c) =>
          c.label === 'Tage VC Performance Management' && c.href === '/eos',
      ),
    ).toBe(true);
    expect(
      grow?.children?.some(
        (c) =>
          c.label === 'Training & Development' && c.href === '/training',
      ),
    ).toBe(true);
    expect(
      MAIN_NAV.some((n) => n.label === 'Tage VC Performance Management'),
    ).toBe(false);
    const flat = flattenNavItems(MAIN_NAV);
    const hrOs = flat.filter((i) => i.href === '/eos');
    expect(hrOs.length).toBeGreaterThanOrEqual(2);
    expect(
      flat.some(
        (i) =>
          i.href === '/eos' && i.label === 'Performance cycle',
      ),
    ).toBe(true);
  });
});
