import { describe, expect, it } from 'vitest';

import {
  isUntitledThinkTank,
  suggestThinkTankTitle,
  thinkTankEntityOs,
  thinkTankLastThreadKey,
} from '@/lib/platform/think-tank/scope';

describe('thinkTankEntityOs', () => {
  it('scopes Tage to the Entity OS lock, else firm', () => {
    expect(
      thinkTankEntityOs({
        portalKey: 'tage',
        activeEntityOs: 'ENT-R619',
        profileEntityId: 'ENT-FIRM',
      }),
    ).toBe('ENT-R619');
    expect(
      thinkTankEntityOs({
        portalKey: 'tage',
        activeEntityOs: null,
        profileEntityId: 'ENT-FIRM',
      }),
    ).toBe('ENT-FIRM');
  });

  it('pins subsidiary portals to their entity even if profile is firm', () => {
    expect(
      thinkTankEntityOs({
        portalKey: 'r619',
        activeEntityOs: null,
        profileEntityId: 'ENT-FIRM',
      }),
    ).toBe('ENT-R619');
    expect(
      thinkTankEntityOs({
        portalKey: 'inda',
        profileEntityId: 'ENT-FIRM',
      }),
    ).toBe('ENT-INDA');
    expect(
      thinkTankEntityOs({
        portalKey: 'signent',
        profileEntityId: 'ENT-FIRM',
      }),
    ).toBe('ENT-SIGNENT');
  });

  it('does not let R619 portal_key resolve to Tage firm OS', () => {
    expect(
      thinkTankEntityOs({
        portalKey: 'r619',
        activeEntityOs: 'ENT-FIRM',
        profileEntityId: 'ENT-FIRM',
      }),
    ).toBe('ENT-R619');
  });
});

describe('think tank titles + last-thread key', () => {
  it('suggests a short label from the first message', () => {
    expect(suggestThinkTankTitle('  Alex weekly  ')).toBe('Alex weekly');
    expect(suggestThinkTankTitle('')).toBe('New thread');
    expect(suggestThinkTankTitle('x'.repeat(80)).endsWith('…')).toBe(true);
  });

  it('treats legacy default titles as untitled', () => {
    expect(isUntitledThinkTank('Think Tank')).toBe(true);
    expect(isUntitledThinkTank('New thread')).toBe(true);
    expect(isUntitledThinkTank('Alex desk')).toBe(false);
  });

  it('keys last-thread storage by portal + entity OS', () => {
    expect(thinkTankLastThreadKey({ portalKey: 'tage', entityOs: 'ENT-FIRM' })).toBe(
      'think-tank:last:tage:ENT-FIRM',
    );
    expect(thinkTankLastThreadKey({ portalKey: 'r619', entityOs: 'ENT-R619' })).toBe(
      'think-tank:last:r619:ENT-R619',
    );
  });
});
