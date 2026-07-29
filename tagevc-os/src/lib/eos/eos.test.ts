import { describe, expect, it } from 'vitest';

import { resolveEosScope } from '@/lib/eos/dashboard';
import {
  EOS_SCOPE_ENTITIES,
  eosOperatingSystemNavLabel,
} from '@/lib/eos/types';
import { MAIN_NAV, flattenNavItems } from '@/lib/nav';

describe('eosOperatingSystemNavLabel', () => {
  it('uses shortened Tage VC label and full subsidiary names', () => {
    expect(eosOperatingSystemNavLabel('ENT-FIRM')).toBe(
      'Tage VC Operating System',
    );
    expect(eosOperatingSystemNavLabel('ENT-R619')).toBe(
      'Recruit 619 Operating System',
    );
    expect(eosOperatingSystemNavLabel('ENT-INDA')).toBe(
      'Instant NDA Operating System',
    );
    expect(eosOperatingSystemNavLabel('ENT-SIGNENT')).toBe(
      'Signent HR Operating System',
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
  it('exposes standalone Tage VC Operating System and HR nested link', () => {
    expect(MAIN_NAV.some((n) => n.label === 'Tage VC Operating System')).toBe(
      true,
    );
    expect(
      MAIN_NAV.find((n) => n.label === 'Tage VC Operating System')?.href,
    ).toBe('/eos');
    const flat = flattenNavItems(MAIN_NAV);
    const hrOs = flat.filter((i) => i.href === '/eos');
    expect(hrOs.length).toBeGreaterThanOrEqual(2);
  });
});
