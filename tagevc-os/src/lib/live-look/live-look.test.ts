import { describe, expect, it } from 'vitest';
import {
  canUseLiveLook,
  isLiveLookOperator,
  LIVE_LOOK_OPERATOR_EMAIL,
} from '@/lib/live-look/access';
import { LIVE_LOOK_BLOCK_MESSAGE, LIVE_LOOK_COOKIE } from '@/lib/live-look/cookie';
import { VISIONARY_MAILBOX_STEP_KEY } from '@/lib/hris/visionary-mailbox';
import { flattenNavItems, MAIN_NAV } from '@/lib/nav';
import { applyLiveLookToProfile } from '@/lib/live-look/server';
import type { Profile } from '@/lib/types';

describe('phase71 live look + nav + mailbox', () => {
  it('exposes Live Look cookie + read-only block message', () => {
    expect(LIVE_LOOK_COOKIE).toBe('tagevc_live_look_user');
    expect(LIVE_LOOK_BLOCK_MESSAGE).toMatch(/read-only/i);
  });

  it('gates Live Look to joshmonroe@tagevc.com Visionary only', () => {
    expect(LIVE_LOOK_OPERATOR_EMAIL).toBe('joshmonroe@tagevc.com');
    expect(
      canUseLiveLook({
        email: 'joshmonroe@tagevc.com',
        realRole: 'visionary',
        effectiveRole: 'visionary',
      }),
    ).toBe(true);
    expect(
      canUseLiveLook({
        email: 'JoshMonroe@TageVC.com',
        realRole: 'visionary',
        effectiveRole: 'visionary',
      }),
    ).toBe(true);
    // Other Visionary accounts denied
    expect(
      canUseLiveLook({
        email: 'other@tagevc.com',
        realRole: 'visionary',
        effectiveRole: 'visionary',
      }),
    ).toBe(false);
    // Role Switcher impersonation denied
    expect(
      canUseLiveLook({
        email: 'joshmonroe@tagevc.com',
        realRole: 'visionary',
        effectiveRole: 'ssc_legal',
        impersonatingAs: 'ssc_legal',
      }),
    ).toBe(false);
    expect(
      isLiveLookOperator({
        email: 'joshmonroe@tagevc.com',
        realRole: 'visionary',
      }),
    ).toBe(true);
    expect(
      isLiveLookOperator({
        email: 'other@tagevc.com',
        realRole: 'visionary',
      }),
    ).toBe(false);
  });

  it('renames Portfolio to Assets and removes Instant NDA SaaS nav', () => {
    const labels = MAIN_NAV.map((n) => n.label);
    expect(labels).toContain('Assets');
    expect(labels).not.toContain('Portfolio');
    expect(labels).not.toContain('Entities');
    expect(labels).not.toContain('Instant NDA SaaS');
    expect(
      flattenNavItems(MAIN_NAV).some(
        (n) => n.href === '/admin/audit' && n.visionaryOnly,
      ),
    ).toBe(true);
    const assets = MAIN_NAV.find((n) => n.label === 'Assets');
    expect(
      assets?.children?.some(
        (c) => c.href === '/portfolio/net-worth' && c.visionaryOnly,
      ),
    ).toBe(true);
    expect(
      assets?.children?.some(
        (c) => c.href === '/portfolio/investments' && c.visionaryOnly,
      ),
    ).toBe(true);
    const csuite = MAIN_NAV.find((n) => n.label === 'C-Suite');
    expect(csuite?.visionaryOnly).toBe(true);
    expect(csuite?.hideDuringLiveLook).toBe(true);
    expect(csuite?.hiddenForRoles).toContain('sub_lead');
  });

  it('applies Live Look target role/entity without swapping viewer id', () => {
    const real: Profile = {
      id: '11111111-1111-1111-1111-111111111111',
      email: 'josh@tagevc.com',
      full_name: 'Josh',
      role: 'visionary',
      entity_id: 'ENT-FIRM',
      avatar_url: null,
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const next = applyLiveLookToProfile(real, {
      profileId: '22222222-2222-2222-2222-222222222222',
      email: 'dennis@recruit619.com',
      fullName: 'Dennis',
      role: 'sub_lead',
      entityId: 'ENT-R619',
    });
    expect(next.id).toBe(real.id);
    expect(next.role).toBe('sub_lead');
    expect(next.entity_id).toBe('ENT-R619');
  });

  it('keeps visionary mailbox onboarding step key stable', () => {
    expect(VISIONARY_MAILBOX_STEP_KEY).toBe('bs.visionary_mailbox_access');
  });
});
