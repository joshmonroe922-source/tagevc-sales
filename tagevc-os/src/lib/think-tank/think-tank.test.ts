import { describe, expect, it } from 'vitest';

import { thinkTankEntityOs } from '@/lib/platform/think-tank/scope';
import { thinkTankRoleBand } from '@/lib/think-tank/prompts';
import { xaiConfigured } from '@/lib/think-tank/llm';

describe('tage think-tank', () => {
  it('maps roles to bands', () => {
    expect(thinkTankRoleBand('visionary')).toBe('leadership');
    expect(thinkTankRoleBand('counsel_ops')).toBe('operator');
    expect(thinkTankRoleBand('associate')).toBe('deal');
    expect(thinkTankRoleBand('admin')).toBe('admin');
  });

  it('reports xai config without throwing', () => {
    expect(typeof xaiConfigured()).toBe('boolean');
  });

  it('keeps Tage Entity OS threads off the R619 portal key', () => {
    expect(
      thinkTankEntityOs({
        portalKey: 'tage',
        activeEntityOs: 'ENT-R619',
        profileEntityId: 'ENT-FIRM',
      }),
    ).toBe('ENT-R619');
    expect(
      thinkTankEntityOs({
        portalKey: 'r619',
        activeEntityOs: 'ENT-R619',
        profileEntityId: 'ENT-FIRM',
      }),
    ).toBe('ENT-R619');
  });
});
