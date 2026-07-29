import { describe, expect, it } from 'vitest';
import {
  canLiveLookTarget,
  canUseLiveLook,
  isJoshMonroeLiveLookEmail,
  isLiveLookOperator,
  LIVE_LOOK_EXCLUDED_EMAIL,
  LIVE_LOOK_OPERATOR_EMAIL,
  liveLookViewerMode,
} from '@/lib/live-look/access';
import { LIVE_LOOK_BLOCK_MESSAGE, LIVE_LOOK_COOKIE } from '@/lib/live-look/cookie';
import { VISIONARY_MAILBOX_STEP_KEY } from '@/lib/hris/visionary-mailbox';
import { flattenNavItems, MAIN_NAV } from '@/lib/nav';
import { applyLiveLookToProfile } from '@/lib/live-look/server';
import { listRoleSwitcherRoles } from '@/lib/rbac/impersonation';
import { APP_ROLE_LABELS } from '@/lib/types/roles';
import { filterNavForRole } from '@/lib/nav/role-visibility';
import {
  canAccessCreditManagement,
  canAccessNetWorthPage,
  canViewBusinessCredit,
  canViewPersonalCredit,
} from '@/lib/net-worth/visibility';
import type { Profile } from '@/lib/types';

describe('phase71 live look + nav + mailbox', () => {
  it('exposes Live Look cookie + read-only block message', () => {
    expect(LIVE_LOOK_COOKIE).toBe('tagevc_live_look_user');
    expect(LIVE_LOOK_BLOCK_MESSAGE).toMatch(/read-only/i);
  });

  it('keeps Visionary Josh Live Look for full tenant', () => {
    expect(LIVE_LOOK_OPERATOR_EMAIL).toBe('joshmonroe@tagevc.com');
    expect(LIVE_LOOK_EXCLUDED_EMAIL).toBe('joshmonroe@tagevc.com');

    expect(
      liveLookViewerMode({
        email: 'joshmonroe@tagevc.com',
        realRole: 'visionary',
        effectiveRole: 'visionary',
      }),
    ).toBe('visionary_full');
    expect(
      canUseLiveLook({
        email: 'joshmonroe@tagevc.com',
        realRole: 'visionary',
        effectiveRole: 'visionary',
      }),
    ).toBe(true);
    expect(
      isLiveLookOperator({
        email: 'joshmonroe@tagevc.com',
        realRole: 'visionary',
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
    expect(
      canLiveLookTarget('dennis@recruit619.com', 'visionary_full'),
    ).toBe(true);
  });

  it('Think Tank Live Look excludes Josh Monroe', () => {
    expect(
      liveLookViewerMode({
        email: 'joshmonroe@tagevc.com',
        realRole: 'visionary',
        effectiveRole: 'think_tank',
        impersonatingAs: 'think_tank',
      }),
    ).toBe('think_tank_scoped');
    expect(
      canUseLiveLook({
        email: 'lauren@tagevc.com',
        realRole: 'think_tank',
        effectiveRole: 'think_tank',
      }),
    ).toBe(true);
    expect(isJoshMonroeLiveLookEmail('joshmonroe@tagevc.com')).toBe(true);
    expect(
      canLiveLookTarget('joshmonroe@tagevc.com', 'think_tank_scoped'),
    ).toBe(false);
    expect(
      canLiveLookTarget('dennis@recruit619.com', 'think_tank_scoped'),
    ).toBe(true);
    // Other Role Switcher personas denied
    expect(
      canUseLiveLook({
        email: 'joshmonroe@tagevc.com',
        realRole: 'visionary',
        effectiveRole: 'ssc_legal',
        impersonatingAs: 'ssc_legal',
      }),
    ).toBe(false);
  });

  it('lists Think Tank in Role Switcher with clean label', () => {
    const roles = listRoleSwitcherRoles();
    expect(roles).toContain('think_tank');
    expect(roles.indexOf('think_tank')).toBeGreaterThan(
      roles.indexOf('visionary'),
    );
    expect(APP_ROLE_LABELS.think_tank).toBe('Think Tank');
  });

  it('Visionary Personal nav includes Credit Management', () => {
    const items = filterNavForRole(MAIN_NAV, {
      role: 'visionary',
      realRole: 'visionary',
      entityId: 'ENT-FIRM',
    });
    const personal = items.find((i) => i.label === 'Personal');
    expect(personal?.children?.map((c) => c.label)).toEqual([
      'Personal Finance',
      'Credit Management',
    ]);
  });

  it('Think Tank keeps Visionary-breadth nav without Personal ▼', () => {
    const items = filterNavForRole(MAIN_NAV, {
      role: 'think_tank',
      realRole: 'visionary',
      entityId: 'ENT-FIRM',
    });
    const labels = items.map((i) => i.label);
    expect(labels).toContain('C-Suite');
    expect(labels).toContain('Assets');
    expect(labels).toContain('Firm');
    expect(labels).toContain('Business Development');
    expect(labels).not.toContain('Personal');
    const bd = items.find((i) => i.label === 'Business Development');
    expect(bd?.children?.map((c) => c.label)).toEqual([
      'Lead Intake',
      'Deal Flow',
    ]);
    const assets = items.find((i) => i.label === 'Assets');
    expect(assets?.children?.map((c) => c.label)).toEqual([
      'Net Worth',
      'Businesses',
      'Real Estate',
      'Investments',
    ]);
    expect(
      canAccessNetWorthPage({ realRole: 'think_tank', liveLookActive: false }),
    ).toBe(true);
    expect(
      canViewPersonalCredit({ realRole: 'think_tank', liveLookActive: false }),
    ).toBe(false);
    expect(canViewBusinessCredit('think_tank')).toBe(false);
    expect(
      canAccessCreditManagement({
        role: 'think_tank',
        realRole: 'visionary',
        liveLookActive: false,
      }),
    ).toBe(false);
    expect(
      canAccessCreditManagement({
        role: 'visionary',
        realRole: 'visionary',
        liveLookActive: false,
      }),
    ).toBe(true);
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
